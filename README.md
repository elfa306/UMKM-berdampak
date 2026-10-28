# UMKM Kasir (Next.js + Supabase + SerpApi + Moota)

1. `npm install`
2. Salin `.env.local.example` menjadi `.env.local`, isi nilainya
3. Supabase SQL Editor: jalankan `supabase/schema.sql`, lalu `supabase/migration_v2.sql`
4. `npm run dev` lalu buka http://localhost:3000

## Halaman
- `/` Kasir: laba real time mulai dari minus modal harian
- `/riwayat` rekap per hari, cari, hapus transaksi, unduh Excel per hari
- `/statistik` donut penjualan/biaya, tunai vs QRIS, tren laba harian
- `/harga` pembanding harga bahan baku

## QRIS otomatis (Moota)
- Deploy aplikasi (mis. Vercel), isi env, lalu di dashboard Moota buat webhook ke `https://DOMAINANDA/api/moota`
- Isi secret token yang sama dengan `MOOTA_SECRET`
- Pembayaran masuk (CR) otomatis tercatat sebagai penjualan QRIS pada sesi hari itu
