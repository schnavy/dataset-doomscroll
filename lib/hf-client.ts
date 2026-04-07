// Migrated from server.js — all Hugging Face API integration lives here.

const HF_BASE = 'https://datasets-server.huggingface.co';
// Fallback dataset when no hfPath is provided (legacy env-var support).
const DEFAULT_DATASET = process.env.HF_DATASET ?? 'TempoFunk/webvid-10M';
const CONFIG_ENV = process.env.HF_CONFIG;
const SPLIT_ENV = process.env.HF_SPLIT;
const URL_FIELD_ENV = process.env.VIDEO_URL_FIELD;

interface SplitInfo {
  config: string;
  split: string;
  size: number;
}

// Per-dataset cache — keyed by dataset path, survives across requests in the same Node process.
const splitInfoCache = new Map<string, SplitInfo>();

async function hfFetch(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    // Next.js fetch cache: re-resolve split info at most once per hour.
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HF error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function resolveSplitInfo(datasetPath: string = DEFAULT_DATASET): Promise<SplitInfo> {
  const cached = splitInfoCache.get(datasetPath);
  if (cached) return cached;

  const splitsUrl = new URL(`${HF_BASE}/splits`);
  splitsUrl.searchParams.set('dataset', datasetPath);
  const data = (await hfFetch(splitsUrl.toString())) as {
    splits: Array<{ config: string; split: string; num_rows?: number }>;
  };

  const config = CONFIG_ENV ?? data.splits?.[0]?.config ?? 'default';
  if (!config) throw new Error('No config available for dataset');

  const splitCandidates = data.splits.filter((s) => s.config === config);
  const split = SPLIT_ENV ?? splitCandidates?.[0]?.split ?? 'train';
  if (!split) throw new Error('No split available for dataset');

  let size = splitCandidates.find((s) => s.split === split)?.num_rows;
  if (!Number.isFinite(size)) {
    const rowsUrl = new URL(`${HF_BASE}/rows`);
    rowsUrl.searchParams.set('dataset', datasetPath);
    rowsUrl.searchParams.set('config', config);
    rowsUrl.searchParams.set('split', split);
    rowsUrl.searchParams.set('offset', '0');
    rowsUrl.searchParams.set('length', '1');
    const rowsData = (await hfFetch(rowsUrl.toString())) as { num_rows_total: number };
    size = rowsData.num_rows_total;
  }
  if (!Number.isFinite(size) || !size) {
    throw new Error('Unable to determine dataset size');
  }

  const info: SplitInfo = { config, split, size };
  splitInfoCache.set(datasetPath, info);
  return info;
}

export function pickUrlField(row: Record<string, unknown>, urlFieldOverride?: string): string | null {
  if (typeof row.contentUrl === 'string') return row.contentUrl;
  if (urlFieldOverride && typeof row[urlFieldOverride] === 'string') {
    return row[urlFieldOverride] as string;
  }
  if (URL_FIELD_ENV && typeof row[URL_FIELD_ENV] === 'string') {
    return row[URL_FIELD_ENV] as string;
  }
  const key = Object.keys(row).find((k) => /url/i.test(k));
  return key && typeof row[key] === 'string' ? (row[key] as string) : null;
}

export async function fetchRowsByIndices(
  indices: number[],
  config: string,
  split: string,
  datasetPath: string = DEFAULT_DATASET,
): Promise<Array<{ rowIndex: number; row: Record<string, unknown> }>> {
  const results: Array<{ rowIndex: number; row: Record<string, unknown> }> = [];

  // Fetch each index individually (HF rows API: offset + length=1).
  // For production with a preprocessed S3 index, replace this with a single lookup.
  await Promise.all(
    indices.map(async (idx) => {
      const url = new URL(`${HF_BASE}/rows`);
      url.searchParams.set('dataset', datasetPath);
      url.searchParams.set('config', config);
      url.searchParams.set('split', split);
      url.searchParams.set('offset', String(idx));
      url.searchParams.set('length', '1');

      const data = (await hfFetch(url.toString())) as {
        rows: Array<{ row_idx: number; row: Record<string, unknown> }>;
      };
      const entry = data.rows?.[0];
      if (entry?.row) {
        results.push({ rowIndex: idx, row: entry.row });
      }
    }),
  );

  return results;
}

// Kept for backward-compat (used in route.ts for the dataset_name field in feed items).
export { DEFAULT_DATASET as DATASET };
