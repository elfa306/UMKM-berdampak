'use client';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rupiah, rupiahRingkas } from '@/lib/accounting';

export type TitikTren = { tanggal: string; uangMasuk: number; untung: number };

const tgl = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

/** Area = uang masuk, batang = untung (hijau) / rugi (merah). */
export default function TrenChart({ data, tinggi = 220 }: { data: TitikTren[]; tinggi?: number }) {
  if (!data.length) return <p className="muted">Belum ada data</p>;
  return (
    <div style={{ width: '100%', height: tinggi }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 4, left: -14, bottom: 0 }}>
          <defs>
            <linearGradient id="gMasuk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#2563eb" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="tanggal" tickFormatter={tgl} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} minTickGap={22} />
          <YAxis tickFormatter={rupiahRingkas} tick={{ fontSize: 10, fill: '#64748b' }} tickLine={false} axisLine={false} width={46} />
          <Tooltip
            formatter={(v: number, n: string) => [rupiah(v), n]}
            labelFormatter={(l: string) => tgl(l)}
            contentStyle={{ borderRadius: 14, border: 0, boxShadow: '0 10px 30px rgba(0,0,0,.12)', fontSize: 12, fontWeight: 700 }} />
          <Area type="monotone" dataKey="uangMasuk" name="Uang masuk" stroke="#2563eb" strokeWidth={2.5} fill="url(#gMasuk)" isAnimationActive />
          <Bar dataKey="untung" name="Untung" radius={[4, 4, 0, 0]} maxBarSize={14}>
            {data.map((d) => <Cell key={d.tanggal} fill={d.untung >= 0 ? '#10b981' : '#ef4444'} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
