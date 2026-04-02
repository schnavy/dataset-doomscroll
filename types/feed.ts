export interface FeedItem {
  id: string;           // `${config}:${split}:${rowIndex}`
  video_url: string;
  duration: number | null;
  dataset_name: string;
  caption: string | null;
}

export interface FeedResponse {
  items: FeedItem[];
  next_cursor: number;
}

export type PoolSlotState = 'idle' | 'loading' | 'ready' | 'active';

export interface PoolSlot {
  index: number;
  videoEl: HTMLVideoElement | null;
  state: PoolSlotState;
  feedIndex: number | null;
}
