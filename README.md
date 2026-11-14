# UMKM Kasir (Next.js + Supabase + Vercel)

## Pasang
1. `npm install`
2. Salin `.env.local.example` menjadi `.env.local`, lalu isi URL/key Supabase dan API key layanan yang dipakai (Groq/Gemini opsional untuk Voice Assistant)
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


## CAVA Voice Assistant — Cashie

Cashie adalah asisten suara dengan tombol V: ketuk singkat membuka Catat Manual, sedangkan tekan-tahan merekam perintah dan lepaskan untuk mengirim. Jawaban dibacakan melalui ElevenLabs, disertai teks yang tampil bertahap mengikuti audio. Saat merekam, gelombang mikrofon mengikuti volume suara dan maskot Cashie ditampilkan pada kartu respons.

### Keterampilan Cashie

- Menjawab pertanyaan dan membaca ringkasan keuangan dari data akun yang sedang login.
- Membuka halaman operasional CAVA dan halaman demo yang diizinkan secara langsung tanpa konfirmasi karena navigasi tidak mengubah data; login, onboarding, dan reset password tidak dapat dibuka melalui Cashie. Pertanyaan baca-saja seperti melihat laporan, memeriksa saldo, dan mencari produk juga dijawab langsung. Perubahan data tetap memerlukan konfirmasi pemilik.
- Mengunduh laporan akuntansi juga langsung dijalankan atas permintaan pemilik karena hanya membaca data dan menghasilkan file lokal.
- Membuka form Catat Manual dengan pilihan pemasukan, pengeluaran, atau modal.
- Mencatat beberapa transaksi penjualan/pengeluaran dalam satu permintaan (maksimal lima rincian) setelah pemilik menyetujui ringkasannya.
- Menambahkan produk katalog, mengubah produk katalog yang didukung, dan menonaktifkan produk dari katalog aktif. Riwayat transaksi lama tetap dipertahankan. Pengelolaan stok barang dagangan/produk jual tidak ditambahkan karena katalog CAVA v18 memang tidak melacak stok untuk jenis tersebut.
- Membuat resep produksi dan menyelesaikan batch produksi. Sistem memeriksa produk hasil, bahan yang melacak stok, dan kecukupan bahan sebelum menyelesaikan batch.
- Memperbarui field profil usaha yang didukung, mencatat setoran modal/pengambilan pribadi/pembayaran pemasok/tenaga kerja/overhead, membatalkan transaksi yang teridentifikasi secara tepat, menetapkan saldo awal satu kali, membuka aktivitas harian, dan mengunduh laporan akuntansi.

### Pola izin dan batasan keamanan

Setiap tindakan yang diminta lewat suara—termasuk navigasi, membuka form, dan perubahan data—dibacakan ulang sebagai ringkasan. Cashie hanya melanjutkan setelah jawaban eksplisit `ya/iya/oke`; jawaban `tidak/batal` membatalkan, dan jawaban yang tidak jelas akan diminta ulang. Perubahan data memakai proposal HMAC yang terikat ke pemilik, kedaluwarsa setelah tiga menit, dan hanya bisa dieksekusi sekali. Server tidak memberi AI akses SQL bebas; setiap tindakan menggunakan daftar action yang diizinkan, validasi data, pemeriksaan kepemilikan, dan RPC CAVA yang sesuai.

Cashie bukan akses tanpa batas ke seluruh komputer atau semua fungsi eksternal. Cashie hanya bisa menjalankan tindakan yang secara eksplisit sudah dihubungkan. Aksi yang belum tersedia di action registry tetap harus dilakukan melalui antarmuka CAVA biasa atau ditambahkan lewat pengembangan terpisah.

### Konfigurasi API

Tambahkan API key ke `.env.local` (jangan gunakan awalan `NEXT_PUBLIC_` untuk secret):

```env
GROQ_API_KEY=isi_api_key_groq
GROQ_MODEL=openai/gpt-oss-20b
GROQ_TRANSCRIPTION_MODEL=whisper-large-v3-turbo
GEMINI_API_KEY=isi_api_key_gemini
GEMINI_MODEL=gemini-2.5-flash
GEMINI_TRANSCRIPTION_MODEL=gemini-2.5-flash
ELEVENLABS_API_KEY=isi_api_key_elevenlabs
ELEVENLABS_VOICE_ID=isi_voice_id_elevenlabs
ELEVENLABS_TTS_MODEL=eleven_v4
CAVA_ACTION_SECRET=secret_acak_minimal_32_karakter
```

Groq adalah provider utama untuk chat/transkripsi; Gemini menjadi fallback. ElevenLabs membuat suara bahasa Indonesia melalui voice/model yang dipilih pada akunmu. Pastikan Voice ID dan hak akses API aktif pada akun ElevenLabs.

### Migration wajib Cashie

Untuk database yang sudah memakai v18, jalankan `supabase/migration_v19_cashie_action_confirmations.sql` melalui Supabase Dashboard → SQL Editor. Migration ini menyiapkan nonce konfirmasi sekali pakai. File ZIP tidak menjalankan migration ke Supabase secara otomatis. `SUPABASE_SERVICE_ROLE_KEY` harus tersedia di server (sudah dipakai oleh `ownerApi.server.ts`); `CAVA_ACTION_SECRET` boleh diisi dengan secret acak khusus.

### Menjalankan lokal

1. Ekstrak ZIP.
2. Salin `.env.local` dari proyek yang sekarang agar kredensial Supabase, Groq, Gemini, ElevenLabs, serta integrasi lain tetap ada.
3. Jalankan `npm install`.
4. Setelah migration v19 dijalankan di Supabase, jalankan `npm run dev`.
5. Buka `http://localhost:3000`. Untuk mikrofon, gunakan localhost atau HTTPS.

