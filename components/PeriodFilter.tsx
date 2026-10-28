'use client';
import { useState } from 'react';
import { todayISO } from '@/lib/accounting';

export type Periode = { key: '7' | '30' | '365' | 'custom'; start: string; end: string };

export function preset(key: '7' | '30' | '365'): Periode {
  const end = todayISO();
  let start = end.slice(0, 4) + '-01-01';
  if (key !== '365') {
    const d = new Date(end + 'T12:00:00');
    d.setDate(d.getDate() - (Number(key) - 1));
    start = d.toLocaleDateString('en-CA');
  }
  return { key, start, end };
}

const ITEMS: [Periode['key'], string][] = [['7', '7 Hari'], ['30', '30 Hari'], ['365', 'Tahun Ini'], ['custom', 'Kustom']];

export default function PeriodFilter({ value, onChange }: { value: Periode; onChange: (p: Periode) => void }) {
  const [s, setS] = useState(value.start);
  const [e, setE] = useState(value.end);
  return (
    <>
      <div className="filter-pills">
        {ITEMS.map(([k, l]) => (
          <button key={k} className={`btn-pill ${value.key === k ? 'active' : ''}`}
            onClick={() => (k === 'custom' ? onChange({ key: 'custom', start: s, end: e }) : onChange(preset(k)))}>
            {l}
          </button>
        ))}
      </div>
      {value.key === 'custom' && (
        <div className="glass-card">
          <div className="date-row">
            <input type="date" value={s} onChange={(x) => setS(x.target.value)} />
            <span>-</span>
            <input type="date" value={e} onChange={(x) => setE(x.target.value)} />
            <button className="btn-sm" onClick={() => s && e && onChange({ key: 'custom', start: s, end: e })}>OK</button>
          </div>
        </div>
      )}
    </>
  );
}
