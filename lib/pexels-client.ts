import type { FeedItem } from '@/types/feed';
import { getBatch } from './seeded-shuffle';

const PEXELS_API_KEY = process.env.PEXELS_API_KEY ?? '';
const PEXELS_BASE = 'https://api.pexels.com/videos';
const PER_PAGE = 15;

// Diverse queries — mix of landscape + portrait-friendly topics.
// Portrait orientation is requested explicitly; these queries also guide
// subject matter so the feed has genuine variety.
const QUERIES_LANDSCAPE = [
  'nature', 'ocean', 'city', 'forest', 'mountains', 'sky', 'rain',
  'fire', 'sunset', 'technology', 'street', 'traffic', 'architecture',
  'space', 'water', 'clouds', 'abstract', 'animals', 'birds', 'sports',
];

const QUERIES_PORTRAIT = [
  'portrait', 'dancing', 'cooking', 'yoga', 'running', 'coffee',
  'flowers', 'food', 'hands', 'music', 'travel', 'fashion', 'art',
  'meditation', 'workout', 'selfie', 'phone', 'reading', 'smile',
];

// Total virtual pool per seed session:
// 20 landscape × 5 pages × 15 = 1,500
// 19 portrait  × 5 pages × 15 = 1,425
// ≈ 2,925 unique clips before cycling
const MAX_PAGES_PER_QUERY = 5;
const ITEMS_PER_QUERY = MAX_PAGES_PER_QUERY * PER_PAGE; // 75

interface PexelsVideoFile {
  id: number;
  quality: string;
  file_type: string;
  width: number;
  height: number;
  link: string;
}

interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  duration: number;
  url: string;
  video_files: PexelsVideoFile[];
  user: { name: string };
}

interface PexelsResponse {
  videos: PexelsVideo[];
  total_results: number;
}

async function pexelsFetch(path: string): Promise<PexelsResponse> {
  if (!PEXELS_API_KEY) {
    throw new Error('PEXELS_API_KEY is not set');
  }
  const res = await fetch(`${PEXELS_BASE}${path}`, {
    headers: { Authorization: PEXELS_API_KEY },
    // Cache Pexels pages for 10 minutes — same page = same clips.
    next: { revalidate: 600 },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Pexels ${res.status}: ${text}`);
  }
  return res.json() as Promise<PexelsResponse>;
}

/** Pick best MP4 quality that isn't 4K (too slow to buffer). */
function pickBestFile(files: PexelsVideoFile[]): PexelsVideoFile | null {
  // Prefer HD (typically 1080p or 720p) over SD; skip UHD.
  const preferred = files
    .filter((f) => f.file_type === 'video/mp4' && f.width <= 1920)
    .sort((a, b) => b.width - a.width);
  return preferred[0] ?? null;
}

function videoToFeedItem(v: PexelsVideo, orientation: 'portrait' | 'landscape'): FeedItem | null {
  const file = pickBestFile(v.video_files);
  if (!file) return null;
  return {
    id: `pexels:${v.id}`,
    video_url: file.link,
    duration: v.duration,
    dataset_name: `Pexels · ${orientation}`,
    caption: null,
  };
}

/**
 * Build all queries in a seed-stable order.
 * Landscape and portrait queries are interleaved so the feed alternates
 * orientations naturally.
 */
function buildQueryList(seed: number): Array<{ query: string; orientation: 'portrait' | 'landscape' }> {
  // Shuffle each group independently using the same Feistel PRNG.
  const shuffleLandscape = getBatch(seed, 0, QUERIES_LANDSCAPE.length, QUERIES_LANDSCAPE.length)
    .map((i) => ({ query: QUERIES_LANDSCAPE[i], orientation: 'landscape' as const }));
  const shufflePortrait = getBatch(seed ^ 0xf0f0f0f0, 0, QUERIES_PORTRAIT.length, QUERIES_PORTRAIT.length)
    .map((i) => ({ query: QUERIES_PORTRAIT[i], orientation: 'portrait' as const }));

  // Interleave: L, P, L, P, ...
  const result: Array<{ query: string; orientation: 'portrait' | 'landscape' }> = [];
  const max = Math.max(shuffleLandscape.length, shufflePortrait.length);
  for (let i = 0; i < max; i++) {
    if (i < shuffleLandscape.length) result.push(shuffleLandscape[i]);
    if (i < shufflePortrait.length) result.push(shufflePortrait[i]);
  }
  return result;
}

/**
 * Fetch a batch of Pexels items starting at `cursor` for this session seed.
 * Maps cursor → (query, page, offset-within-page) deterministically.
 */
export async function fetchPexelsBatch(
  seed: number,
  cursor: number,
  batchSize: number,
): Promise<{ items: FeedItem[]; next_cursor: number }> {
  const queries = buildQueryList(seed);

  const items: FeedItem[] = [];
  let pos = cursor;

  while (items.length < batchSize) {
    const queryIdx = Math.floor(pos / ITEMS_PER_QUERY) % queries.length;
    const posWithinQuery = pos % ITEMS_PER_QUERY;
    const page = Math.floor(posWithinQuery / PER_PAGE) + 1;
    const offsetInPage = posWithinQuery % PER_PAGE;

    const { query, orientation } = queries[queryIdx];
    const searchPath =
      orientation === 'portrait'
        ? `/search?query=${encodeURIComponent(query)}&orientation=portrait&per_page=${PER_PAGE}&page=${page}`
        : `/search?query=${encodeURIComponent(query)}&per_page=${PER_PAGE}&page=${page}`;

    const data = await pexelsFetch(searchPath);

    if (!data.videos || data.videos.length === 0) {
      // Empty page — advance to next query block.
      pos = (Math.floor(pos / ITEMS_PER_QUERY) + 1) * ITEMS_PER_QUERY;
      continue;
    }

    const remaining = data.videos.slice(offsetInPage);
    for (const v of remaining) {
      if (items.length >= batchSize) break;
      const item = videoToFeedItem(v, orientation);
      if (item) items.push(item);
      pos++;
    }

    // If we consumed all of this page without filling batchSize, advance.
    if (remaining.length === 0) {
      pos = (Math.floor(pos / PER_PAGE) + 1) * PER_PAGE;
    }
  }

  return { items, next_cursor: pos };
}
