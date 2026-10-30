# UMKM Kasir (Next.js + Supabase + Vercel)

## Pasang
1. `npm install`
2. Salin `.env.local.example` menjadi `.env.local`, isi nilainya (tidak ada variabel baru di versi ini)
3. Supabase SQL Editor, jalankan berurutan: `schema.sql`, `migration_v2.sql`, `migration_v3.sql`, lalu `migration_v4.sql`
4. `npm run dev` lalu buka http://localhost:3000

## Halaman
- `/` Beranda (Bento Grid). Pengguna yang sudah login otomatis diarahkan ke `/kasir`
- `/kasir` Kasir: target balik modal, QRIS real-time (pop-up + suara Ka-Ching), grafik 7 hari
- `/riwayat` Mutasi per hari, unduh Excel harian/periode, cetak PDF untuk bank
- `/statistik` Donut, tunai vs QRIS, grafik tren (Recharts), cetak PDF
- `/kredit` Rapor usaha dan simulasi cicilan; profil usaha disimpan per akun, perhitungan memakai catatan kasir 30 hari terakhir
- `/rekomendasi` Rekomendasi modal berdasarkan catatan akun; profil awal diisi pada halaman ini
- `/lainnya` Cek harga bahan, hubungkan QRIS

## QRIS otomatis (notifikasi GoPay Merchant via MacroDroid)
- MacroDroid mengirim notifikasi ke `/api/gopay` (tidak berubah). Server menulis ke Supabase.
- Browser mendengarkan lewat Supabase Realtime (`transactions` dan `qris_inbox`), jadi layar bereaksi tanpa refresh.
- Panduan pemasangan MacroDroid ada di halaman `/integrasi`.

## Yang perlu dirawat rutin
- `lib/config.ts`: perbarui `BI_RATE` setelah tiap RDG BI, dan `KUR_BUNGA` bila aturan KUR berubah
- `lib/credit.ts`: ambang penilaian rapor usaha (`SYARAT`)
- `lib/istilah.ts`: seluruh istilah "bahasa pasar"
