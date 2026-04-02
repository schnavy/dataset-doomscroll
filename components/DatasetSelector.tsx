'use client';

import { DATASETS } from '@/lib/datasets';

interface Props {
  selected: string;
  onChange: (id: string) => void;
}

export default function DatasetSelector({ selected, onChange }: Props) {
  return (
    <div className="dataset-selector">
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select dataset"
      >
        {Object.values(DATASETS).map((ds) => (
          <option key={ds.id} value={ds.id} disabled={ds.status === 'requires-preprocessing'}>
            {ds.label}{ds.status === 'requires-preprocessing' ? ' (needs preprocessing)' : ''}
          </option>
        ))}
      </select>
      <p className="dataset-description">{DATASETS[selected]?.description}</p>
    </div>
  );
}
