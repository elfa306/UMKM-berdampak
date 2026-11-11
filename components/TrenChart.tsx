'use client';
import { Area, Bar, CartesianGrid, Cell, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { rupiah, rupiahRingkas } from '@/lib/accounting';

export type TitikTren = { tanggal: string; uangMasuk: number; untung: number };

const tgl = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });

/** Area = uang masuk (teal), batang = untung (Mughal Green) / rugi (merah tua). */
export default function TrenChart({ data, tinggi = 220 }: { data: TitikTren[]; tinggi?: number }) {
  if (!data.length) return <p className="muted">Belum ada data</p>;
  return (
    <div style={{ width: '100%', height: tinggi }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gMasuk" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#307B8E" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#307B8E" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#D5E4DC" strokeDasharray="3 3" />
          <XAxis dataKey="tanggal" tickFormatter={tgl} tick={{ fontSize: 10, fill: '#4F6B7C' }} tickLine={false} axisLine={false} minTickGap={22} />
          <YAxis tickFormatter={rupiahRingkas} tick={{ fontSize: 10, fill: '#4F6B7C' }} tickLine={false} axisLine={false} width={48} />
          <Tooltip
            formatter={(v: number, n: string) => [rupiah(v), n]}
            labelFormatter={(l: string) => tgl(l)}
            contentStyle={{ borderRadius: 14, border: 0, boxShadow: '0 10px 30px rgba(16,58,87,.18)', color: '#103A57', fontSize: 12, fontWeight: 700 }} />
          <Area type="monotone" dataKey="uangMasuk" name="Uang masuk" stroke="#307B8E" strokeWidth={2.5} fill="url(#gMasuk)" isAnimationActive />
          <Bar dataKey="untung" name="Untung" radius={[4, 4, 0, 0]} maxBarSize={14}>
            {data.map((d) => <Cell key={d.tanggal} fill={d.untung >= 0 ? '#366B2B' : '#991B1B'} />)}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
