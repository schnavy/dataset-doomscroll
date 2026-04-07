import { NextRequest, NextResponse } from 'next/server';
import { resolveSplitInfo, fetchRowsByIndices, pickUrlField, DATASET } from '@/lib/hf-client';
import { getBatch } from '@/lib/seeded-shuffle';
import { fetchPexelsBatch } from '@/lib/pexels-client';
import { getDataset } from '@/lib/datasets';
import type { FeedItem, FeedResponse } from '@/types/feed';

const HF_BATCH_SIZE = 10;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const params = req.nextUrl.searchParams;
  const datasetId = params.get('dataset') ?? 'webvid';
  const seed = parseInt(params.get('seed') ?? '0', 10);
  const cursor = parseInt(params.get('cursor') ?? '0', 10);

  if (!Number.isFinite(seed) || !Number.isFinite(cursor) || cursor < 0) {
    return NextResponse.json({ error: 'Invalid params' }, { status: 400 });
  }

  const datasetConfig = getDataset(datasetId);
  if (!datasetConfig) {
    return NextResponse.json({ error: `Unknown dataset: ${datasetId}` }, { status: 400 });
  }
  if (datasetConfig.status === 'requires-preprocessing') {
    return NextResponse.json(
      { error: 'Dataset requires preprocessing. Run scripts/preprocess.py first.' },
      { status: 503 },
    );
  }

  try {
    let response: FeedResponse;

    if (datasetConfig.type === 'pexels') {
      response = await fetchPexelsBatch(seed, cursor, HF_BATCH_SIZE);
    } else {
      // HF-backed dataset
      const hfPath = datasetConfig.hfPath ?? DATASET;
      const { config, split, size } = await resolveSplitInfo(hfPath);
      const rowIndices = getBatch(seed, cursor, HF_BATCH_SIZE, size);
      const rows = await fetchRowsByIndices(rowIndices, config, split, hfPath);

      const items: FeedItem[] = rows.flatMap(({ rowIndex, row }) => {
        const video_url = pickUrlField(row, datasetConfig.urlField);
        if (!video_url) return [];
        return [
          {
            id: `${config}:${split}:${rowIndex}`,
            video_url,
            duration: typeof row.duration === 'number' ? row.duration : null,
            dataset_name: hfPath,
            caption:
              typeof row.caption === 'string'
                ? row.caption
                : typeof row.name === 'string'
                  ? row.name
                  : null,
          },
        ];
      });

      response = { items, next_cursor: cursor + HF_BATCH_SIZE };
    }

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
