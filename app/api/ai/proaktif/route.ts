import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin } from '@/lib/ownerApi.server';
import { buildNudges, geserTanggal, type NudgeTx } from '@/lib/cashieNudges';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const RIWAYAT_HARI = 90;
const RIWAYAT_PRODUKSI_HARI = 56;
const MAKS_HALAMAN = 5; // 5 × 1000 transaksi per pengecekan

type TxRow = {
  id: string; jenis: 'penjualan' | 'biaya'; keterangan: string; jumlah: number | string; qty: number | null;
  created_at: string; product_id: string | null;
  daily_sessions: { tanggal: string } | { tanggal: string }[] | null;
};

/**
 * Pesan proaktif Cashie. Hanya membaca data milik pengguna (RLS tetap berlaku) lalu
 * menjalankan aturan deterministik di lib/cashieNudges.ts. Tidak memanggil model AI,
 * jadi cepat, gratis kuota, dan setiap angka berasal dari data aktual.
 */
export async function POST(request: Request) {
  if (!isSafeSameOrigin(request)) return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Silakan masuk ke akun CAVA terlebih dahulu.' }, { status: 401 });

    const sekarang = new Date();
    const hariIni = sekarang.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const [jam, menit] = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Jakarta' })
      .format(sekarang).split(':').map(Number);
    const mulai = geserTanggal(hariIni, -RIWAYAT_HARI);
    const mulaiProduksi = geserTanggal(hariIni, -RIWAYAT_PRODUKSI_HARI);
    const { userClient, user } = ctx;

    const [profilRes, produkRes, produksiRes] = await Promise.all([
      userClient.from('business_profiles').select('jenis_usaha,tanggal_mulai_usaha').eq('user_id', user.id).maybeSingle(),
      userClient.from('products').select('id,nama,jenis_item,aktif').eq('user_id', user.id).limit(500),
      userClient.from('production_batches').select('completed_at').eq('user_id', user.id).eq('status', 'completed')
        .gte('completed_at', `${mulaiProduksi}T00:00:00+07:00`).limit(500),
    ]);

    const tx: NudgeTx[] = [];
    for (let dari = 0; dari < MAKS_HALAMAN * 1000; dari += 1000) {
      const { data, error } = await userClient.from('transactions')
        .select('id,jenis,keterangan,jumlah,qty,created_at,product_id,daily_sessions!inner(tanggal)')
        .eq('user_id', user.id)
        .gte('daily_sessions.tanggal', mulai)
        .lte('daily_sessions.tanggal', hariIni)
        .order('created_at', { ascending: false })
        .range(dari, dari + 999);
      if (error) throw new Error(error.message);
      for (const row of (data ?? []) as unknown as TxRow[]) {
        const sesi = Array.isArray(row.daily_sessions) ? row.daily_sessions[0] : row.daily_sessions;
        if (!sesi?.tanggal) continue;
        tx.push({
          id: row.id, jenis: row.jenis, keterangan: row.keterangan ?? '', jumlah: Number(row.jumlah),
          qty: Number(row.qty) > 0 ? Number(row.qty) : 1, created_at: row.created_at, tanggal: sesi.tanggal, product_id: row.product_id,
        });
      }
      if ((data ?? []).length < 1000) break;
    }

    // Tabel produk/produksi bersifat pelengkap: bila gagal dibaca, aturan yang memerlukannya diam saja.
    const namaProduk: Record<string, string> = {};
    const produkDijual: Record<string, string> = {};
    for (const p of (produkRes.data ?? []) as Array<{ id: string; nama: string; jenis_item: string | null; aktif: boolean | null }>) {
      namaProduk[p.id] = p.nama;
      if (p.aktif !== false && ['finished_good', 'merchandise', 'service', null].includes(p.jenis_item)) produkDijual[p.id] = p.nama;
    }
    const hariProduksi = ((produksiRes.data ?? []) as Array<{ completed_at: string }>)
      .map((b) => new Date(b.completed_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' }));

    const nudges = buildNudges({
      hariIni, jamWIB: jam % 24, menitWIB: menit,
      profil: (profilRes.data as { jenis_usaha: string | null; tanggal_mulai_usaha: string | null } | null) ?? null,
      tx, namaProduk, produkDijual, hariProduksi,
    }).slice(0, 6);

    return NextResponse.json({ nudges, hariIni }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.warn('[CAVA AI] pesan proaktif gagal:', error instanceof Error ? error.message : error);
    // Pesan proaktif hanyalah pelengkap; kegagalan tidak boleh tampil sebagai error ke pemilik usaha.
    return NextResponse.json({ nudges: [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
