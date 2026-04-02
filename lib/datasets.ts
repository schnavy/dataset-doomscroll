export type DatasetType = 'hf' | 'pexels' | 's3';
export type DatasetStatus = 'active' | 'requires-preprocessing';

export interface DatasetConfig {
  id: string;
  label: string;
  description: string;
  type: DatasetType;
  status: DatasetStatus;
  /** Only shown in UI when status = 'requires-preprocessing' */
  preprocessingNote?: string;
}

export const DATASETS: Record<string, DatasetConfig> = {
  webvid: {
    id: 'webvid',
    label: 'WebVid-10M',
    description: '10.7M stock footage clips · landscape',
    type: 'hf',
    status: 'active',
  },
  pexels: {
    id: 'pexels',
    label: 'Pexels',
    description: 'Royalty-free clips · portrait & landscape · live API',
    type: 'pexels',
    status: 'active',
  },
  ucf101: {
    id: 'ucf101',
    label: 'UCF-101',
    description: '13k action clips · 101 categories · 7.2 GB download',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Run: python scripts/preprocess.py --dataset ucf101 --s3-bucket YOUR_BUCKET',
  },
  smthsmth: {
    id: 'smthsmth',
    label: 'Something-Something V2',
    description: '220k hand-object interaction clips · 19.4 GB download',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from qualcomm.com/developer/software/something-something-v-2-dataset, then run preprocess.py',
  },
};

export const DATASET_IDS = Object.keys(DATASETS) as (keyof typeof DATASETS)[];

export function getDataset(id: string): DatasetConfig | null {
  return DATASETS[id] ?? null;
}
