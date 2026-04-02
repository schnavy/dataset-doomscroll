# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start Next.js dev server (http://localhost:3000)
npm run build    # Production build
npm run start    # Start production server
```

No test runner is configured. TypeScript checking is implicit via Next.js builds.

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `PEXELS_API_KEY` | For Pexels dataset | Pexels API key |
| `HF_DATASET` | No | Override HF dataset (default: `TempoFunk/webvid-10M`) |
| `HF_CONFIG` | No | Override HF config (auto-detected if unset) |
| `HF_SPLIT` | No | Override HF split (auto-detected if unset) |
| `VIDEO_URL_FIELD` | No | Override URL field name in HF rows |

## Architecture

This is a TikTok-style doomscroll video feed built on Next.js 15 / React 19.

### Data flow

1. **API route** (`app/api/feed/route.ts`) — accepts `?dataset=&seed=&cursor=` and returns `FeedResponse` (`items[]` + `next_cursor`). Two backends:
   - **HF** (`lib/hf-client.ts`): calls Hugging Face Datasets Server API, caches split metadata in module-scope memory across requests.
   - **Pexels** (`lib/pexels-client.ts`): calls Pexels search API with interleaved landscape/portrait query lists.

2. **Seeded shuffle** (`lib/seeded-shuffle.ts`) — Feistel-cipher PRNG maps `(seed, position) → row_index` in O(1) without materializing a shuffle array. Same seed + cursor always returns the same rows. Used for both HF index selection and Pexels query ordering.

3. **`useVideoFeed` hook** (`hooks/useVideoFeed.ts`) — manages a circular pool of 5 `<video>` elements (`POOL_SIZE=5`). Prefetches 3 ahead + 1 behind the active position. Uses `AbortController` per slot to cancel stale loads. Resets entirely on dataset change. Seed is generated per-session per-dataset and stored in `sessionStorage`.

4. **`VideoFeed` component** (`components/VideoFeed.tsx`) — root UI component. Handles wheel/touch scroll events with a 400ms cooldown. Shows a "Tap to watch" gate before first play (browser autoplay policy workaround).

5. **`VideoPlayer` component** (`components/VideoPlayer.tsx`) — renders a single `<video>` element. Each player is positioned with `translateY(offset * 100%)` so only the active slot (offset=0) is visible. Clips are capped at 10 seconds via `timeupdate`. Audio is intentionally NOT muted.

### Dataset registry

`lib/datasets.ts` is the single source of truth for available datasets. Each entry has a `type` (`hf` | `pexels` | `s3`) and `status` (`active` | `requires-preprocessing`). Adding a new dataset means adding an entry here; the API route and `DatasetSelector` UI automatically reflect it.

### Preprocessing pipeline

`scripts/preprocess.py` downloads HF dataset videos, trims to ≤10s, encodes to fast-start MP4 (`-movflags +faststart`), and uploads to S3-compatible storage. Outputs a `processed.jsonl` index. Required for `s3`-type datasets (UCF-101, Something-Something V2) before they can be served. Requires `ffmpeg`/`ffprobe` in PATH and `pip install boto3 requests`.
