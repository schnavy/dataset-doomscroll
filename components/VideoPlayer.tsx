'use client';

import { useRef, useEffect, CSSProperties } from 'react';
import type { PoolSlot } from '@/types/feed';

interface Props {
  slot: PoolSlot;
  offset: number; // -2=far-back, -1=prev, 0=active, 1=next, 2=far-next
  playing: boolean;
}

const MAX_PLAY_SECONDS = 10;

const videoStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  background: '#000',
  willChange: 'transform',
};

export default function VideoPlayer({ slot, offset, playing }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  // Expose the real HTMLVideoElement to the pool slot so the hook can
  // call .load(), .play(), .pause() directly.
  useEffect(() => {
    slot.videoEl = videoRef.current;
    return () => {
      slot.videoEl = null;
    };
  }, [slot]);

  // Play / pause driven by parent — only the active slot (offset=0) plays.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (playing) {
      video.play().catch(() => {});
    } else {
      video.pause();
      // Reset to start so the slot is ready the moment it becomes active again.
      if (Math.abs(offset) > 1) video.currentTime = 0;
    }
  }, [playing, offset]);

  // IntersectionObserver safety net: pause if scrolled out of view on active slot.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playing) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(video);
    return () => observer.disconnect();
  }, [playing]);

  // Duration clamp: loop back at 10s for videos longer than MAX_PLAY_SECONDS.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const clamp = () => {
      if (video.currentTime >= MAX_PLAY_SECONDS) {
        video.currentTime = 0;
      }
    };
    video.addEventListener('timeupdate', clamp);
    return () => video.removeEventListener('timeupdate', clamp);
  }, []);

  return (
    <video
      ref={videoRef}
      playsInline
      // NO muted — audio must be on when available (core requirement).
      loop
      preload={Math.abs(offset) <= 1 ? 'auto' : 'metadata'}
      style={{
        ...videoStyle,
        transform: `translateY(${offset * 100}%)`,
        // Suppress transition on the active slot to avoid any flash.
        transition: offset === 0 ? 'none' : undefined,
      }}
    />
  );
}
