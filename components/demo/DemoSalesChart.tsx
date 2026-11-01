'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DemoDailySales } from '@/lib/demoDashboard.server';

function compactRupiah(value: number): string {
  if (value >= 1_000_000) return `Rp${(value / 1_000_000).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (value >= 1_000) return `Rp${(value / 1_000).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return `Rp${value.toLocaleString('id-ID')}`;
}

export default function DemoSalesChart({ data }: { data: DemoDailySales[] }) {
  const hasSales = data.some((point) => point.revenue > 0);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">Tren omzet</p>
          <p className="mt-1 text-xs text-slate-500">Pergerakan penjualan selama 7 hari terakhir</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-[11px] font-extrabold text-emerald-700">7 hari</span>
      </div>

      {hasSales ? (
        <div className="mt-5 h-[250px] w-full" aria-label="Grafik omzet tujuh hari terakhir">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: 2, bottom: 2 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} dy={9} />
              <YAxis width={64} axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={compactRupiah} />
              <Tooltip
                formatter={(value) => [compactRupiah(Number(value) || 0), 'Omzet']}
                labelFormatter={(label) => `Tanggal ${label}`}
                contentStyle={{ borderRadius: 14, border: '1px solid #e2e8f0', fontSize: 12 }}
              />
              <Line type="monotone" dataKey="revenue" name="Omzet" stroke="#059669" strokeWidth={3} dot={{ r: 3, fill: '#059669', strokeWidth: 0 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="mt-5 grid h-[220px] place-items-center rounded-2xl bg-slate-50 px-5 text-center">
          <div>
            <p className="text-sm font-extrabold text-slate-700">Belum ada penjualan</p>
            <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">Grafik akan terisi otomatis setelah transaksi pertama dicatat pada modul kasir.</p>
          </div>
        </div>
      )}
    </section>
  );
}
