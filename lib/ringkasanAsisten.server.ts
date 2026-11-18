/**
 * Ringkasan data halaman Cek Harga dan Pembiayaan untuk asisten suara Cashie.
 * Dipakai agar pertanyaan seperti "cek harga bahan hari ini" atau "bagaimana pembiayaan saya"
 * dijawab langsung dari data, bukan dengan membuka halamannya.
 *
 * Semua fungsi tidak pernah melempar error; bila data tidak tersedia, hasilnya { tersedia: false, alasan }.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { BI_RATE } from './config';
import { fetchHari } from './data';
import { buatProfilRekomendasi, type ProfilUsahaDB } from './rekomendasiProfile';
import { BANK_SIMULASI, BATAS_RASIO_CICILAN, hitungRekomendasi, hitungSkorKesehatan } from './rekomendasiModal';

const bulat = (n: number) => Math.round(n);
const satuDesimal = (n: number) => Math.round(n * 10) / 10;
const duaDesimal = (n: number) => Math.round(n * 100) / 100;

function geserHari(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

type SnapshotRow = { bahan: string; tanggal: string; harga_median: number | string; harga_termurah: number | string | null };

/**
 * Harga bahan dari pantauan terakhir yang tersimpan (tabel harga_snapshot, diisi saat halaman Cek Harga dibuka).
 * Tidak memanggil layanan harga eksternal, jadi cepat dan tidak memakai kuota.
 */
export async function ringkasHargaBahan(client: SupabaseClient, userId: string, hariIni: string): Promise<Record<string, unknown>> {
  try {
    const { data, error } = await client.from('harga_snapshot')
      .select('bahan,tanggal,harga_median,harga_termurah')
      .eq('user_id', userId).order('tanggal', { ascending: false }).limit(300);
    if (error) return { tersedia: false, alasan: 'Riwayat harga bahan belum bisa dibaca.' };
    const rows = (data ?? []) as SnapshotRow[];
    if (!rows.length) {
      return { tersedia: false, alasan: 'Belum ada pantauan harga bahan. Harga mulai dipantau setelah halaman Cek Harga dibuka satu kali.' };
    }

    const tanggalData = rows[0].tanggal;
    const perBahan = new Map<string, SnapshotRow[]>();
    for (const row of rows) perBahan.set(row.bahan, [...(perBahan.get(row.bahan) ?? []), row]);

    const bahan = [...perBahan.entries()]
      .filter(([, list]) => list[0].tanggal === tanggalData)
      .map(([nama, list]) => {
        const median = Number(list[0].harga_median);
        const sebelumnya = list.find((row) => row.tanggal < tanggalData);
        const lama = sebelumnya ? Number(sebelumnya.harga_median) : 0;
        return {
          nama,
          hargaMedian: bulat(median),
          hargaTermurah: list[0].harga_termurah === null ? null : bulat(Number(list[0].harga_termurah)),
          perubahanPersen: sebelumnya && lama > 0 ? satuDesimal(((median - lama) / lama) * 100) : null,
          dibandingkanDengan: sebelumnya ? sebelumnya.tanggal : null,
        };
      })
      .sort((a, b) => Math.abs(b.perubahanPersen ?? 0) - Math.abs(a.perubahanPersen ?? 0))
      .slice(0, 12);

    return {
      tersedia: true,
      tanggalData,
      hariIni: tanggalData === hariIni,
      jumlahBahan: bahan.length,
      bahan,
      catatan: 'Harga median toko online dari pantauan terakhir. perubahanPersen = dibanding pantauan sebelumnya (null bila belum ada pembanding).',
    };
  } catch (error) {
    console.warn('[CAVA AI] ringkasan harga bahan gagal:', error instanceof Error ? error.message : error);
    return { tersedia: false, alasan: 'Harga bahan belum bisa dibaca sekarang.' };
  }
}

/** Skor kesehatan finansial dan rekomendasi pembiayaan, dengan rumus yang sama seperti halaman Pembiayaan. */
export async function ringkasPembiayaan(client: SupabaseClient, userId: string, profile: ProfilUsahaDB | null, hariIni: string): Promise<Record<string, unknown>> {
  try {
    if (!profile) return { tersedia: false, alasan: 'Profil usaha belum diisi, jadi rekomendasi pembiayaan belum bisa dihitung.' };
    if (!(Number(profile.kebutuhan_modal) > 0)) return { tersedia: false, alasan: 'Kebutuhan modal belum diisi di Profil Usaha.' };

    // Sama seperti halaman: 30 hari terakhir sampai kemarin (hari ini belum selesai).
    const akhir = geserHari(hariIni, -1);
    const awal = geserHari(akhir, -29);
    const hari = await fetchHari(awal, akhir, { client, userId });
    if (!hari.length) {
      return { tersedia: false, alasan: 'Belum ada catatan kasir dalam 30 hari terakhir (tidak termasuk hari ini), jadi rekomendasi belum bisa dihitung.' };
    }

    const profil = buatProfilRekomendasi(profile, hari, profile.nama_usaha || 'Usaha Saya');
    const skor = hitungSkorKesehatan(profil);
    const hasil = hitungRekomendasi(profil, BANK_SIMULASI, BI_RATE);
    const untungBulan = profil.omzetHarian * profil.marginUntung * profil.hariBukaPerBulan;

    return {
      tersedia: true,
      periode: { mulai: awal, sampai: akhir },
      hariDicatat: profil.hariDicatat30,
      skorKesehatan: { total: skor.total, grade: skor.grade, komponen: skor.komponen.map((k) => `${k.label} ${k.nilai}/${k.maks}`) },
      omzetHarianRataRata: bulat(profil.omzetHarian),
      untungBulananPerkiraan: bulat(untungBulan),
      marginUntungPersen: satuDesimal(profil.marginUntung * 100),
      usiaUsahaBulan: profil.usiaUsahaBulan,
      kebutuhanModal: bulat(profil.kebutuhanModal),
      biRatePersen: BI_RATE,
      batasCicilanAmanPersenDariUntung: BATAS_RASIO_CICILAN * 100,
      // Sudah berurutan: yang layak dan paling cocok lebih dulu.
      pilihan: hasil.map((r) => ({
        lembaga: r.bank.nama,
        jenis: r.bank.jenis,
        layak: r.layak,
        bungaPersenPerTahun: duaDesimal(r.bunga),
        pinjaman: bulat(r.pinjaman),
        tenorBulan: r.bank.tenorBulan,
        cicilanPerBulan: bulat(r.cicilanBulan),
        cicilanPerHari: bulat(r.cicilanHari),
        cicilanPersenDariUntung: bulat(r.rasio * 100),
        agunan: r.bank.agunan,
        prosesHari: r.bank.prosesHari,
        risiko: r.bank.risiko,
        ...(r.layak ? {} : { alasanKurangCocok: r.alasan }),
      })),
      catatan: 'Daftar lembaga, bunga, dan plafon adalah data simulasi, bukan penawaran resmi.',
    };
  } catch (error) {
    console.warn('[CAVA AI] ringkasan pembiayaan gagal:', error instanceof Error ? error.message : error);
    return { tersedia: false, alasan: 'Data pembiayaan belum bisa dihitung sekarang.' };
  }
}
