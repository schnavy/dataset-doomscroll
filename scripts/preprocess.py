#!/usr/bin/env python3
"""
scripts/preprocess.py

Downloads raw videos from a Hugging Face dataset, trims to max 10 seconds,
encodes to fast-start MP4 (moov atom first), and uploads to S3-compatible
object storage.

Dependencies:
  pip install boto3 requests

System:
  ffmpeg + ffprobe in PATH

Usage:
  python scripts/preprocess.py \\
    --dataset TempoFunk/webvid-10M \\
    --config default \\
    --split train \\
    --offset 0 \\
    --count 10000 \\
    --s3-bucket my-bucket \\
    --s3-prefix videos/ \\
    --workers 8

For non-AWS S3 (e.g. Cloudflare R2):
  --s3-endpoint https://<account>.r2.cloudflarestorage.com

Portrait / vertical output (9:16 center crop from landscape source):
  python scripts/preprocess.py ... --vertical --s3-prefix videos/vertical/

  Landscape sources  → center-cropped to 9:16 then scaled to max 1280px tall
  Portrait sources   → passed through, just scaled to max 1280px tall
  Run twice (once without --vertical, once with) to build both orientations.

Outputs:
  processed.jsonl — one JSON line per row: {row_index, status, s3_key, caption}
  This file can be used to build a fast lookup index, replacing HF API calls.
"""

import argparse
import concurrent.futures
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import boto3
import requests

HF_BASE = "https://datasets-server.huggingface.co"
MAX_DURATION = 10.0    # seconds — trim threshold
MIN_DURATION = 0.5     # seconds — skip clips shorter than this
FFMPEG_TIMEOUT = 60    # seconds per encode
DOWNLOAD_TIMEOUT = 30  # seconds
MAX_RETRIES = 3


def hf_fetch_rows(dataset: str, config: str, split: str, offset: int, length: int) -> dict:
    url = f"{HF_BASE}/rows"
    params = {
        "dataset": dataset,
        "config": config,
        "split": split,
        "offset": offset,
        "length": length,
    }
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def pick_url(row: dict) -> str | None:
    """Mirror of lib/hf-client.ts pickUrlField."""
    if "contentUrl" in row and isinstance(row["contentUrl"], str):
        return row["contentUrl"]
    for k, v in row.items():
        if "url" in k.lower() and isinstance(v, str):
            return v
    return None


def probe_video_info(path: str) -> dict | None:
    """Return {duration, width, height} via ffprobe, or None on failure."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                "-select_streams", "v:0",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=10,
        )
        info = json.loads(result.stdout)
        duration = float(info["format"]["duration"])
        stream = info.get("streams", [{}])[0]
        width = int(stream.get("width", 0))
        height = int(stream.get("height", 0))
        return {"duration": duration, "width": width, "height": height}
    except Exception:
        return None


def build_vf(width: int, height: int, vertical: bool) -> str:
    """
    Return the ffmpeg -vf filter string for the given source dimensions.

    Landscape mode (default):
      Scale to max 1280px wide, preserve aspect ratio, even dimensions.

    Vertical mode (--vertical):
      - Source is landscape (w > h): center-crop a 9:16 strip from the middle,
        then scale so the height is at most 1280px.
        The crop takes the full height and a width of h×9/16, centred horizontally.
      - Source is already portrait (h >= w): no crop needed; scale to max 1280px tall.

    In both modes width and height in the output are forced to even numbers (-2).
    """
    if not vertical:
        return "scale='min(1280,iw)':-2"

    if width > height:
        # Landscape → 9:16 center crop.
        # crop=w:h:x:y  where w=ih*9/16, h=ih, x=(iw-w)/2, y=0
        return "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=-2:'min(1280,ih)'"
    else:
        # Already portrait — just cap the height.
        return "scale=-2:'min(1280,ih)'"


def process_video(
    row_index: int,
    row: dict,
    s3_client,
    bucket: str,
    prefix: str,
    dry_run: bool,
    vertical: bool = False,
) -> dict:
    """
    Download, trim, encode, upload one video.
    Returns {row_index, status, s3_key?, caption?}.
    Never raises — all errors are captured in the status field.
    """
    url = pick_url(row)
    if not url:
        return {"row_index": row_index, "status": "skip_no_url"}

    caption = row.get("caption") or row.get("name") or ""

    with tempfile.TemporaryDirectory() as tmpdir:
        raw_path = Path(tmpdir) / "raw.mp4"
        out_path = Path(tmpdir) / "out.mp4"

        # ── Download ──────────────────────────────────────────────────────────
        for attempt in range(MAX_RETRIES):
            try:
                resp = requests.get(url, stream=True, timeout=DOWNLOAD_TIMEOUT)
                resp.raise_for_status()
                with open(raw_path, "wb") as f:
                    for chunk in resp.iter_content(65536):
                        f.write(chunk)
                break
            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    return {
                        "row_index": row_index,
                        "status": "skip_download_failed",
                        "error": str(e),
                    }
                time.sleep(2 ** attempt)

        # ── Probe ─────────────────────────────────────────────────────────────
        info = probe_video_info(str(raw_path))
        if info is None:
            return {"row_index": row_index, "status": "skip_probe_failed"}

        if info["duration"] < MIN_DURATION:
            return {
                "row_index": row_index,
                "status": "skip_too_short",
                "duration": info["duration"],
            }

        vf = build_vf(info["width"], info["height"], vertical)

        # ── ffmpeg encode ─────────────────────────────────────────────────────
        # Key flags:
        #   -t 10                — trim to max 10 seconds
        #   -movflags +faststart — moov atom at file start (critical for streaming)
        #   NO -af loudnorm      — preserve original audio levels (core requirement)
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", str(raw_path),
            "-t", str(MAX_DURATION),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-vf", vf,
            "-movflags", "+faststart",
            "-avoid_negative_ts", "make_zero",
            str(out_path),
        ]

        try:
            subprocess.run(
                ffmpeg_cmd,
                capture_output=True,
                timeout=FFMPEG_TIMEOUT,
                check=True,
            )
        except subprocess.CalledProcessError as e:
            return {
                "row_index": row_index,
                "status": "skip_ffmpeg_failed",
                "stderr": e.stderr.decode(errors="replace")[-500:],
            }
        except subprocess.TimeoutExpired:
            return {"row_index": row_index, "status": "skip_ffmpeg_timeout"}

        if not out_path.exists() or out_path.stat().st_size < 1000:
            return {"row_index": row_index, "status": "skip_empty_output"}

        # Verify output duration
        out_info = probe_video_info(str(out_path))
        if out_info is not None and out_info["duration"] < MIN_DURATION:
            return {
                "row_index": row_index,
                "status": "skip_output_too_short",
                "duration": out_info["duration"],
            }

        # ── S3 upload ─────────────────────────────────────────────────────────
        s3_key = f"{prefix}{row_index:08d}.mp4"
        if not dry_run:
            s3_client.upload_file(
                str(out_path),
                bucket,
                s3_key,
                ExtraArgs={
                    "ContentType": "video/mp4",
                    "Metadata": {
                        "row_index": str(row_index),
                        "source_url": url[:1024],
                        "caption": str(caption)[:1024],
                    },
                },
            )

    return {
        "row_index": row_index,
        "status": "ok",
        "s3_key": s3_key if not dry_run else None,
        "caption": caption,
        "source_url": url,
        "vertical": vertical,
        "source_dimensions": f"{info['width']}x{info['height']}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Preprocess dataset videos for doomscroll")
    parser.add_argument("--dataset",      default="TempoFunk/webvid-10M")
    parser.add_argument("--config",       default="default")
    parser.add_argument("--split",        default="train")
    parser.add_argument("--offset",       type=int, default=0, help="Starting row index")
    parser.add_argument("--count",        type=int, default=1000, help="Number of rows to process")
    parser.add_argument("--s3-bucket",    required=True)
    parser.add_argument("--s3-prefix",    default="videos/")
    parser.add_argument("--s3-endpoint",  default=None, help="S3-compatible endpoint URL (R2, MinIO, etc.)")
    parser.add_argument("--workers",      type=int, default=4)
    parser.add_argument("--hf-batch",     type=int, default=100, help="Rows per HF API request")
    parser.add_argument("--dry-run",      action="store_true", help="Skip S3 upload")
    parser.add_argument("--output-jsonl", default="processed.jsonl")
    parser.add_argument(
        "--vertical",
        action="store_true",
        help=(
            "Crop landscape clips to 9:16 portrait (center crop). "
            "Portrait sources are left uncropped and just scaled. "
            "Tip: use a separate --s3-prefix (e.g. videos/vertical/) "
            "so landscape and portrait outputs don't collide."
        ),
    )
    args = parser.parse_args()

    # ── S3 client ─────────────────────────────────────────────────────────────
    s3_kwargs: dict = {}
    if args.s3_endpoint:
        s3_kwargs["endpoint_url"] = args.s3_endpoint
    s3 = boto3.client("s3", **s3_kwargs)

    processed = 0
    ok = 0
    skipped = 0

    with open(args.output_jsonl, "a", buffering=1) as jsonl_file:
        with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
            for batch_start in range(args.offset, args.offset + args.count, args.hf_batch):
                batch_len = min(args.hf_batch, args.offset + args.count - batch_start)

                try:
                    data = hf_fetch_rows(
                        args.dataset, args.config, args.split, batch_start, batch_len
                    )
                except Exception as e:
                    print(f"[ERROR] HF fetch failed at offset {batch_start}: {e}", file=sys.stderr)
                    continue

                rows = [(r["row_idx"], r["row"]) for r in data.get("rows", [])]

                futures = {
                    executor.submit(
                        process_video,
                        row_index, row, s3, args.s3_bucket, args.s3_prefix,
                        args.dry_run, args.vertical,
                    ): row_index
                    for row_index, row in rows
                }

                for fut in concurrent.futures.as_completed(futures):
                    try:
                        result = fut.result()
                    except Exception as e:
                        result = {"row_index": futures[fut], "status": "error", "error": str(e)}

                    jsonl_file.write(json.dumps(result) + "\n")
                    processed += 1

                    if result["status"] == "ok":
                        ok += 1
                    else:
                        skipped += 1

                    if processed % 100 == 0:
                        print(
                            f"[{processed}/{args.count}] ok={ok} skipped={skipped}",
                            flush=True,
                        )

    print(f"\nDone. {processed} rows processed: {ok} ok, {skipped} skipped.")
    print(f"Results written to {args.output_jsonl}")


if __name__ == "__main__":
    main()
