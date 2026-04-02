'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import { useVideoFeed } from '@/hooks/useVideoFeed';
import VideoPlayer from './VideoPlayer';
import DatasetSelector from './DatasetSelector';

const SCROLL_COOLDOWN_MS = 400;
const POOL_SIZE = 5;

export default function VideoFeed() {
  const [datasetId, setDatasetId] = useState<string>('webvid');
  const { pool, activeSlotIndex, ready, advance, lastAdvanceAt } = useVideoFeed(datasetId);
  const containerRef = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);

  // Reset "started" when switching datasets so the tap-to-watch gate re-appears.
  const handleDatasetChange = useCallback((id: string) => {
    setStarted(false);
    setDatasetId(id);
  }, []);

  // ── Scroll helpers ─────────────────────────────────────────────────────────
  const tryAdvance = useCallback(
    (dir: 1 | -1) => {
      const now = Date.now();
      if (now - lastAdvanceAt.current < SCROLL_COOLDOWN_MS) return;
      lastAdvanceAt.current = now;
      advance(dir);
    },
    [advance, lastAdvanceAt],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > 10) tryAdvance(e.deltaY > 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: true });
    return () => el.removeEventListener('wheel', onWheel);
  }, [tryAdvance]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    let startY = 0;
    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 1) startY = e.touches[0].clientY; };
    const onTouchMove = (e: TouchEvent) => {
      if (!startY) return;
      const delta = startY - e.touches[0].clientY;
      if (Math.abs(delta) > 40) { startY = 0; tryAdvance(delta > 0 ? 1 : -1); }
    };
    const onTouchEnd = () => { startY = 0; };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, [tryAdvance]);

  // ── Start gate ─────────────────────────────────────────────────────────────
  const handleStart = useCallback(() => {
    setStarted(true);
    pool[activeSlotIndex].videoEl?.play().catch(() => {});
  }, [pool, activeSlotIndex]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <DatasetSelector selected={datasetId} onChange={handleDatasetChange} />

      <div ref={containerRef} className="feed-container">
        {Array.from({ length: POOL_SIZE }, (_, i) => {
          let offset = i - activeSlotIndex;
          if (offset > Math.floor(POOL_SIZE / 2)) offset -= POOL_SIZE;
          if (offset < -Math.floor(POOL_SIZE / 2)) offset += POOL_SIZE;
          return (
            <VideoPlayer
              key={i}
              slot={pool[i]}
              offset={offset}
              playing={started && i === activeSlotIndex}
            />
          );
        })}

        {(!ready || !started) && (
          <div
            className="feed-start-overlay"
            onClick={ready ? handleStart : undefined}
          >
            {ready ? 'Tap to watch' : 'Loading…'}
          </div>
        )}
      </div>
    </>
  );
}
