'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import type { FeedItem, PoolSlot, PoolSlotState } from '@/types/feed';

const POOL_SIZE = 5;
const PREFETCH_BEHIND = 1;
const PREFETCH_AHEAD = 3;
const MIN_DURATION = 0.5;

function generateSeed(datasetId: string): number {
  const key = `feed_seed_${datasetId}`;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) return parseInt(stored, 10);
  } catch {
    // SSR guard
  }
  const seed = Math.floor(Math.random() * 0xffffffff);
  try {
    sessionStorage.setItem(key, String(seed));
  } catch {
    // ignore
  }
  return seed;
}

function makePool(): PoolSlot[] {
  return Array.from({ length: POOL_SIZE }, (_, i) => ({
    index: i,
    videoEl: null,
    state: 'idle' as PoolSlotState,
    feedIndex: null,
  }));
}

export function useVideoFeed(datasetId: string) {
  const seed = useRef<number>(0);
  const cursor = useRef<number>(0);
  const feedItems = useRef<FeedItem[]>([]);
  const activePos = useRef<number>(0);
  const abortMap = useRef<Map<number, AbortController>>(new Map());
  const pool = useRef<PoolSlot[]>(makePool());
  const lastAdvanceAt = useRef<number>(0);
  // Tracks the active datasetId inside async callbacks to detect stale calls.
  const currentDatasetId = useRef<string>(datasetId);

  const [activeSlotIndex, setActiveSlotIndex] = useState<number>(0);
  const [ready, setReady] = useState<boolean>(false);

  const slotFor = (feedPos: number) => feedPos % POOL_SIZE;

  // ── Fetch more items ───────────────────────────────────────────────────────
  const fetchMoreItems = useCallback(
    async (fromCursor: number, dsId: string) => {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(
            `/api/feed?dataset=${dsId}&seed=${seed.current}&cursor=${fromCursor}`,
          );
          if (!res.ok) throw new Error(`Feed ${res.status}`);
          const data = await res.json() as { items: FeedItem[]; next_cursor: number };
          // Discard result if dataset changed while we were fetching.
          if (currentDatasetId.current !== dsId) return;
          feedItems.current.push(...data.items);
          cursor.current = data.next_cursor;
          return;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      throw lastError;
    },
    [],
  );

  // ── Load one feed position into its pool slot ──────────────────────────────
  const loadSlot = useCallback(
    async (feedPos: number, dsId: string): Promise<void> => {
      const existing = abortMap.current.get(feedPos);
      if (existing) {
        existing.abort();
        abortMap.current.delete(feedPos);
      }

      while (feedItems.current.length <= feedPos) {
        if (currentDatasetId.current !== dsId) return;
        await fetchMoreItems(cursor.current, dsId);
      }

      if (currentDatasetId.current !== dsId) return;

      const item = feedItems.current[feedPos];
      const slotIdx = slotFor(feedPos);
      const slot = pool.current[slotIdx];

      if (slot.feedIndex === feedPos && slot.state !== 'idle') return;

      const video = slot.videoEl;
      if (!video) return;

      slot.feedIndex = feedPos;
      slot.state = 'loading';

      const ac = new AbortController();
      abortMap.current.set(feedPos, ac);

      video.src = item.video_url;
      video.load();

      try {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            video.removeEventListener('canplaythrough', onReady);
            video.removeEventListener('error', onError);
          };
          const onReady = () => {
            cleanup();
            if (video.duration > 0 && video.duration < MIN_DURATION) {
              reject(new Error('clip too short'));
            } else {
              resolve();
            }
          };
          const onError = () => { cleanup(); reject(new Error('video load error')); };
          ac.signal.addEventListener('abort', () => { cleanup(); reject(new Error('aborted')); });
          video.addEventListener('canplaythrough', onReady, { once: true });
          video.addEventListener('error', onError, { once: true });
        });

        slot.state = 'ready';
        abortMap.current.delete(feedPos);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (msg === 'aborted') { slot.state = 'idle'; return; }
        // Broken or too-short clip — skip forward silently.
        slot.state = 'idle';
        slot.feedIndex = null;
        abortMap.current.delete(feedPos);
        if (currentDatasetId.current === dsId) {
          await loadSlot(feedPos + 1, dsId);
        }
      }
    },
    [fetchMoreItems],
  );

  // ── Cancel stale loads ─────────────────────────────────────────────────────
  const cancelAll = useCallback(() => {
    for (const ac of abortMap.current.values()) ac.abort();
    abortMap.current.clear();
    for (const slot of pool.current) {
      if (slot.videoEl) {
        slot.videoEl.pause();
        slot.videoEl.src = '';
      }
      slot.state = 'idle';
      slot.feedIndex = null;
    }
  }, []);

  const cancelStale = useCallback((centerPos: number) => {
    const keep = new Set<number>();
    for (let i = centerPos - PREFETCH_BEHIND; i <= centerPos + PREFETCH_AHEAD; i++) {
      if (i >= 0) keep.add(i);
    }
    for (const [pos, ac] of abortMap.current.entries()) {
      if (!keep.has(pos)) {
        ac.abort();
        abortMap.current.delete(pos);
        const slot = pool.current[slotFor(pos)];
        if (slot.feedIndex === pos) { slot.state = 'idle'; slot.feedIndex = null; }
      }
    }
  }, []);

  // ── Advance ────────────────────────────────────────────────────────────────
  const advance = useCallback(
    (dir: 1 | -1) => {
      const newPos = activePos.current + dir;
      if (newPos < 0) return;
      const dsId = currentDatasetId.current;

      activePos.current = newPos;
      cancelStale(newPos);

      const newSlotIdx = slotFor(newPos);
      setActiveSlotIndex(newSlotIdx);
      pool.current[newSlotIdx].state = 'active';
      pool.current[newSlotIdx].videoEl?.play().catch(() => {});

      for (let i = newPos - PREFETCH_BEHIND; i <= newPos + PREFETCH_AHEAD; i++) {
        if (i >= 0 && i !== newPos) loadSlot(i, dsId).catch(() => {});
      }
    },
    [cancelStale, loadSlot],
  );

  // ── Init / reset on dataset change ────────────────────────────────────────
  useEffect(() => {
    currentDatasetId.current = datasetId;

    // Full reset.
    cancelAll();
    feedItems.current = [];
    activePos.current = 0;
    cursor.current = 0;
    seed.current = generateSeed(datasetId);
    setActiveSlotIndex(0);
    setReady(false);

    const init = async () => {
      await fetchMoreItems(0, datasetId);
      if (currentDatasetId.current !== datasetId) return;

      await Promise.all(
        Array.from({ length: PREFETCH_AHEAD + 1 }, (_, i) => loadSlot(i, datasetId)),
      );
      if (currentDatasetId.current !== datasetId) return;

      pool.current[0].state = 'active';
      activePos.current = 0;
      setActiveSlotIndex(0);
      setReady(true);
    };

    init().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId]);

  return { pool: pool.current, activeSlotIndex, ready, advance, lastAdvanceAt };
}
