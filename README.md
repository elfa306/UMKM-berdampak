# UMKM Kasir (Next.js + Supabase + Vercel)

## Pasang
1. `npm install`
2. Salin `.env.local.example` menjadi `.env.local`, isi nilainya (tidak ada variabel baru di versi ini)
3. Supabase SQL Editor: untuk database baru, jalankan `schema.sql`, kemudian seluruh file `migration_v2.sql` sampai migrasi terbaru secara berurutan sesuai nomor versinya. Untuk database yang sudah berjalan, cukup jalankan migrasi yang belum diterapkan.
4. `npm run dev` lalu buka http://localhost:3000

## Saldo awal dan pembukaan hari (migration v17)

Untuk database yang sudah menjalankan migrasi sebelumnya sampai `migration_v16_hapus_produk.sql`, jalankan file `supabase/migration_v17_cash_balance_flow.sql` melalui Supabase Dashboard → SQL Editor.

Setelah migrasi diterapkan:
- Saat pertama kali membuka Kasir, pemilik mengonfirmasi saldo kas tunai dan saldo bank/QRIS yang benar-benar tersedia. Langkah ini hanya satu kali per akun.
- Pada hari berikutnya, saldo penutupan dari jurnal otomatis menjadi saldo pembuka. Form tidak lagi meminta modal harian setiap hari.
- Tambahan uang dari pemilik dicatat lewat Catat Transaksi → Setor modal. Pencatatan ini masuk ke ekuitas, bukan pendapatan penjualan.
- Pengeluaran dapat memilih sumber pembayaran Tunai atau Bank/QRIS agar saldo akun yang berkurang sesuai metode.

Saldo berjalan dihitung dari jurnal transaksi. Karena itu, saldo yang dibawa ke hari berikutnya mengikuti transaksi yang tercatat di CAVA; cocokkan secara berkala dengan uang tunai dan mutasi rekening sebenarnya.

## Katalog produk tanpa pengelolaan stok (migration v18)

Untuk database yang sudah menjalankan migration v17, jalankan `supabase/migration_v18_katalog_produk_tanpa_stok.sql` melalui Supabase Dashboard → SQL Editor.

- Inventaris menjadi katalog produk/menu: nama, kategori, satuan, harga beli/HPP referensi, dan harga jual.
- Produk dagangan, produk sendiri, dan jasa tidak lagi melacak atau membatasi jumlah stok pada kasir.
- Harga beli pada katalog menjadi acuan biaya dan estimasi selisih harga; pembelian yang benar-benar dibayar tetap dicatat sebagai pengeluaran. Harga katalog tidak otomatis diposting sebagai jurnal HPP.
- Pelacakan stok produk jual dinonaktifkan tanpa menghapus riwayat transaksi, pembelian, mutasi, atau batch produksi yang sudah tersimpan.

## Halaman
- `/` Beranda (Bento Grid). Pengguna yang sudah login otomatis diarahkan ke `/kasir`
- `/kasir` Kasir: saldo kas dan bank/QRIS, laba harian berbasis jurnal, QRIS real-time, grafik 7 hari
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
