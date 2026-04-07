export type DatasetType = 'hf' | 'pexels' | 's3';
export type DatasetStatus = 'active' | 'requires-preprocessing';

export interface DatasetConfig {
  id: string;
  label: string;
  description: string;
  type: DatasetType;
  status: DatasetStatus;
  /** Hugging Face dataset path (e.g. "TempoFunk/webvid-10M"). Required for type='hf'. */
  hfPath?: string;
  /** Override the video URL field name in HF rows (auto-detected if unset). */
  urlField?: string;
  /** Only shown in UI when status = 'requires-preprocessing' */
  preprocessingNote?: string;
}

export const DATASETS: Record<string, DatasetConfig> = {
  // ── Active HF datasets (direct streamable video URLs) ──────────────────────
  webvid: {
    id: 'webvid',
    label: 'WebVid-10M',
    description: '10.7M stock footage clips · landscape',
    type: 'hf',
    status: 'active',
    hfPath: 'TempoFunk/webvid-10M',
  },
  hdvila: {
    id: 'hdvila',
    label: 'HD-VILA-100M',
    description: '103M HD video clips with ASR transcriptions · diverse web content',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Rows contain YouTube URLs + span_start/span_end timestamps. Download via yt-dlp, trim each segment with ffmpeg, then run preprocess.py --dataset hdvila',
  },

  // ── Live API datasets ───────────────────────────────────────────────────────
  pexels: {
    id: 'pexels',
    label: 'Pexels',
    description: 'Royalty-free clips · portrait & landscape · live API',
    type: 'pexels',
    status: 'active',
  },

  // ── Requires preprocessing (download → trim → encode → upload to S3) ───────
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
  kinetics400: {
    id: 'kinetics400',
    label: 'Kinetics-400',
    description: '306k 10-second action clips · 400 human action classes · DeepMind',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download via: pip install kinetics-downloader && kinetics_downloader --dataset kinetics400, then run preprocess.py --dataset kinetics400',
  },
  kinetics700: {
    id: 'kinetics700',
    label: 'Kinetics-700',
    description: '650k 10-second action clips · 700 human action classes · DeepMind',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download via: pip install kinetics-downloader && kinetics_downloader --dataset kinetics700, then run preprocess.py --dataset kinetics700',
  },
  hmdb51: {
    id: 'hmdb51',
    label: 'HMDB-51',
    description: '6.8k video clips · 51 action categories · Brown University',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from serre-lab.clps.brown.edu/resource/hmdb-a-large-human-motion-database, then run preprocess.py --dataset hmdb51',
  },
  activitynet: {
    id: 'activitynet',
    label: 'ActivityNet v1.3',
    description: '27.8k YouTube videos · 200 activity classes · temporal annotations',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download via yt-dlp using activity_net.v1-3.min.json, then run preprocess.py --dataset activitynet',
  },
  epicktichens: {
    id: 'epicktichens',
    label: 'EPIC-Kitchens 100',
    description: '100h egocentric kitchen video · 90k action segments · 45 kitchens',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Request access at epic-kitchens.github.io, then run preprocess.py --dataset epicktichens',
  },
  charades: {
    id: 'charades',
    label: 'Charades',
    description: '9.8k indoor activity videos · 157 actions · avg 30s clips · crowdsourced',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from prior.allenai.org/projects/charades, then run preprocess.py --dataset charades',
  },
  moments: {
    id: 'moments',
    label: 'Moments in Time',
    description: '3M 3-second clips · 339 action classes · MIT · diverse & dense',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Request access at moments.csail.mit.edu, then run preprocess.py --dataset moments',
  },
  howto100m: {
    id: 'howto100m',
    label: 'HowTo100M',
    description: '136M clips from 1.2M YouTube instructional videos · cooking, crafts, fitness',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download clip list from howto100m.github.io, download via yt-dlp, then run preprocess.py --dataset howto100m',
  },
  internvid: {
    id: 'internvid',
    label: 'InternVid-10M',
    description: '10M curated web video clips · high-quality AI captions · OpenGVLab',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download clip list from huggingface.co/datasets/OpenGVLab/InternVid, download via yt-dlp, then run preprocess.py --dataset internvid',
  },
  msrvtt: {
    id: 'msrvtt',
    label: 'MSR-VTT',
    description: '10k web video clips · 200k captions · 20 categories · video-text retrieval',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from microsoft.com/en-us/research/publication/msr-vtt, then run preprocess.py --dataset msrvtt',
  },
  msvd: {
    id: 'msvd',
    label: 'MSVD',
    description: '1.97k YouTube clips · 80k captions · Microsoft Research video description',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from microsoft.com/en-us/research/project/microsoft-video-description, then run preprocess.py --dataset msvd',
  },
  avabbox: {
    id: 'avabbox',
    label: 'AVA v2.2',
    description: '430 Hollywood films · 80 atomic visual actions · spatiotemporal bounding boxes',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download via research.google.com/ava, then run preprocess.py --dataset avabbox',
  },
  finegym: {
    id: 'finegym',
    label: 'FineGym',
    description: '32.7k gym video clips · 530 fine-grained action classes · gymnastics events',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from sdolivia.github.io/FineGym, then run preprocess.py --dataset finegym',
  },
  ego4d: {
    id: 'ego4d',
    label: 'Ego4D',
    description: '3,670h egocentric video · 931 participants · 74 locations · Meta AI',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Request access at ego4d-data.org, download via ego4d CLI, then run preprocess.py --dataset ego4d',
  },
  coin: {
    id: 'coin',
    label: 'COIN',
    description: '11.8k YouTube videos · 180 tasks · 12 domains · step-level annotations',
    type: 's3',
    status: 'requires-preprocessing',
    preprocessingNote:
      'Download from coin-dataset.github.io, then run preprocess.py --dataset coin',
  },
};

export const DATASET_IDS = Object.keys(DATASETS) as (keyof typeof DATASETS)[];

export function getDataset(id: string): DatasetConfig | null {
  return DATASETS[id] ?? null;
}
