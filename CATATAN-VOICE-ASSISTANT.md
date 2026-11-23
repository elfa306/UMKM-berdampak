# CAVA Voice Assistant — uji coba lokal

## Ringkasan perubahan versi ini

- Tombol V pada navigasi bawah dan sidebar punya dua fungsi: ketuk singkat membuka pencatatan manual; tekan dan tahan 280 ms mulai merekam, lalu lepaskan untuk mengirim. Event klik dari gesture panjang diabaikan agar tidak membuka/menutup modal manual secara tidak sengaja.
- Cashie adalah maskot/asisten suara CAVA. Saat merekam, Cashie menampilkan gelombang mikrofon real-time.
- Tidak ada ruang chat atau riwayat percakapan yang dibuka. CAVA langsung menjawab melalui suara dan kartu respons kecil di atas navigasi.
- Jawaban umum dibuat singkat, langsung pada inti, dan memakai gaya bahasa Indonesia sehari-hari.
- ElevenLabs TTS menghasilkan jawaban suara dengan model default `eleven_v4`. Endpoint menambahkan Audio Tags otomatis sesuai konteks: `[curious]` untuk konfirmasi, `[happy]` untuk keberhasilan, `[calm, reassuring]` untuk kesalahan, dan `[warm, conversational]` untuk jawaban umum. Tag hanya dipakai pada audio dan tidak muncul pada transkrip. Pilih Voice ID dengan pelafalan bahasa Indonesia yang cocok. Suara otomatis dapat dimatikan dan jawaban terakhir bisa diputar ulang.
- Transkripsi suara memakai AssemblyAI Universal-2 dengan deteksi bahasa otomatis, code-switching, dan keyterms dari katalog usaha. Chat tetap memakai Groq sebagai provider utama dan Gemini sebagai fallback saat gangguan sementara.
- AI membaca konteks usaha milik akun yang sedang login: profil, transaksi 30 hari, ringkasan jurnal/saldo bila tersedia, dan katalog produk.
- Tindakan pencatatan transaksi harus dikonfirmasi terlebih dahulu lewat suara atau tombol cadangan di kartu respons.
- Ketuk singkat tombol V membuka pencatatan manual; tombol `+` tambahan dihilangkan. Untuk kontrol aksi Cashie, jalankan migration v19 seperti dijelaskan pada bagian akhir catatan.

## Alur perintah transaksi

1. Pengguna menahan tombol V, mengucapkan perintah, lalu melepaskan tombol.
2. CAVA mengenali perintah dan membuat rancangan transaksi.
3. CAVA membacakan ringkasan transaksi dan bertanya, misalnya: **"Baik, saya catat pengeluaran belanja sayur Rp50.000 dan belanja daging Rp100.000, total Rp150.000. Langsung saya catat?"**
4. Jawaban `ya`, `iya`, `oke`, `setuju`, atau konfirmasi singkat sejenis akan menyimpan transaksi.
5. Jawaban `tidak`, `enggak`, `batal`, atau sejenisnya akan membatalkan rancangan tanpa menyimpan.
6. Jawaban yang tidak jelas tidak akan menjalankan tindakan; CAVA akan meminta konfirmasi ulang.

Jika pengguna menyebut beberapa barang dengan nominal masing-masing, AI diarahkan untuk membuat satu transaksi terpisah per barang. Metode pembayaran yang tidak disebutkan dibiarkan kosong (`null`); skema tabel memang memperbolehkan nilai tersebut.

**Catatan waktu:** versi ini mencatat ke sesi hari ini dan memakai waktu otomatis saat transaksi disimpan. Frasa seperti "tadi pagi" belum mengubah jam transaksi ke waktu lampau.

## Persiapan lokal

1. Ekstrak ZIP dan buka folder proyek.
2. Gunakan file `.env.local` yang sudah dipakai pada proyek lama agar URL Supabase serta API key tetap tersedia.
3. Pastikan `.env.local` memiliki `GROQ_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, dan konfigurasi Supabase.
4. Di dashboard ElevenLabs, pilih suara yang cocok untuk bahasa Indonesia, buka detail suara, lalu salin Voice ID. Isi `ELEVENLABS_API_KEY` dan `ELEVENLABS_VOICE_ID` di `.env.local`. Model default `eleven_v4` dipilih agar Audio Tags berfungsi. Pengaturan lama `eleven_multilingual_v2` otomatis dialihkan ke `eleven_v4`. API key tidak boleh memakai prefix `NEXT_PUBLIC_`.
5. Paket gratis cocok untuk prototipe/pengujian; sebelum dipakai secara komersial, periksa ketentuan lisensi ElevenLabs karena hak komersial dapat memerlukan paket berbayar.
6. Jalankan:

```bash
npm install
npm run typecheck
npm run dev
```

7. Buka `http://localhost:3000`, login, lalu izinkan akses mikrofon.
8. Coba ucapkan: **"Catat uang belanja sayur tadi pagi 50 ribu dan daging 100 ribu."**
9. Setelah CAVA membacakan ringkasannya, tahan tombol V lagi dan jawab **"ya"** untuk menyimpan atau **"tidak"** untuk membatalkan. Ketuk singkat tombol V kapan saja untuk membuka pencatatan manual.

## Catatan teknis

- Pencatatan transaksi memakai tabel `transactions` dan sesi harian yang sudah dipakai CAVA. Migration v19 hanya menambahkan tabel nonce untuk mencegah konfirmasi tindakan dipakai dua kali.
- Penyimpanan tetap menggunakan Supabase Auth dan Row Level Security akun yang login. Aksi hanya dijalankan setelah konfirmasi eksplisit.
- Jika saldo awal atau sesi harian belum dibuka, CAVA tidak akan menyimpan transaksi dan akan memberi tahu pengguna.
- Jika jawaban konfirmasi tidak jelas, tindakan tetap menunggu; aplikasi tidak menganggapnya sebagai persetujuan.
- Rekaman maksimal 35 detik dan ukuran audio maksimal 12 MB. File audio tidak disimpan permanen oleh fitur ini.
- Mikrofon browser membutuhkan HTTPS atau `localhost`. Jika menguji melalui HP dengan alamat IP lokal seperti `http://192.168.x.x:3000`, akses mikrofon mungkin ditolak browser.
- Endpoint `/api/ai/speak` meneruskan teks ke ElevenLabs dari server dan mengirim audio MP3 kembali ke browser; API key tidak pernah dikirim ke client.
- Build Next.js penuh belum dapat dijalankan di lingkungan pembuatan ZIP karena dependensi npm tidak tersedia secara lokal. Tetap jalankan `npm install` dan `npm run typecheck` di laptop sebelum pengujian.

## Troubleshooting ElevenLabs TTS

- `HTTP 402`: kredit/kuota ElevenLabs tidak mencukupi. Periksa Usage/Subscription.
- `HTTP 403`: akun/API key tidak memiliki izin untuk voice atau model. Voice Library tidak tersedia melalui API pada paket Free; gunakan suara milik sendiri yang dibuat melalui Voice Design atau paket yang mendukung aksesnya.
- `HTTP 404`: Voice ID tidak ditemukan; salin ulang ID dari My Voices.
- Pastikan API Key memiliki izin Text to Speech.
- Pada paket Free, gunakan Voice Design untuk membuat suara milik sendiri; jangan menyalin Voice ID komunitas dari Voice Library untuk pemanggilan API.


## Cashie dan visualizer mikrofon

- Asisten suara bernama Cashie dengan ilustrasi maskot `public/cashie-mascot.webp`.
- Saat mikrofon merekam, panel menampilkan waveform 32 bar dari nilai RMS audio aktual yang dibaca melalui Web Audio API `AnalyserNode`.
- Waveform berhenti dan kembali rata saat perekaman berhenti atau dibatalkan.
- Ketukan singkat membuka pencatatan manual pada event click (bukan pointerup), sehingga click yang sama tidak mengenai backdrop modal dan langsung menutupnya.

## Sinkronisasi teks dan suara Cashie
- Jawaban Cashie kini memakai endpoint ElevenLabs `/with-timestamps` untuk mendapatkan audio dan alignment waktu per karakter.
- Teks jawaban disembunyikan selama audio sedang disiapkan, lalu muncul bertahap mengikuti waktu pengucapan dan menyorot kata yang sedang dibacakan.
- Cache audio menyimpan alignment yang sama sehingga tombol Ulangi tetap menampilkan teks tersinkron.
- Jika alignment tidak cocok akibat normalisasi teks, tampilan memakai pembagian waktu proporsional berdasarkan durasi audio sebagai fallback.


## Cashie: kontrol aplikasi dengan konfirmasi pemilik

Cashie kini mendukung tindakan yang memang tersedia di aplikasi CAVA, bukan akses bebas ke database:
- Membuka halaman utama yang diizinkan dan membuka form Catat Manual; tindakan melalui suara meminta persetujuan sebelum navigasi.
- Membuat pemasukan/pengeluaran dan beberapa item transaksi dalam satu konfirmasi.
- Menambah, mengubah, atau menonaktifkan produk katalog. Penonaktifan mempertahankan riwayat transaksi.
- Membuat resep dan menyelesaikan batch produksi; RPC memeriksa komposisi serta ketersediaan bahan.
- Memperbarui profil usaha dan membuat jurnal setoran modal/pengambilan/pembayaran tertentu.
- Membatalkan transaksi terpilih setelah ID, tanggal, jenis, keterangan, dan nominal dicocokkan ulang dengan database pemilik.
- Menetapkan saldo awal satu kali, membuka aktivitas harian, dan mengunduh laporan akuntansi Excel.

Semua mutasi memakai token HMAC yang terikat pada ID pengguna, kedaluwarsa dalam tiga menit, dan memiliki nonce sekali pakai. Server memverifikasi kepemilikan data sebelum pemanggilan RPC; tidak ada SQL arbitrer atau tool eksekusi kode dari model. Navigasi dan ekspor juga menunggu persetujuan lisan/tombol pada kartu Cashie.

### Migration wajib
Jalankan `supabase/migration_v19_cashie_action_confirmations.sql` di Supabase SQL Editor setelah migration v18. Migration membuat tabel nonce konfirmasi sekali pakai. Jika belum dijalankan, tindakan yang memerlukan token akan gagal aman dan tidak mengubah data.

### Batasan cakupan
Cashie hanya mengendalikan rute dan tindakan yang telah didaftarkan. Halaman demo hanya dapat dibuka, bukan diubah oleh Cashie. Login, onboarding, reset password, pengaturan kredensial, dan aksi eksternal tidak bisa dikendalikan oleh AI. Fitur yang belum tersedia di CAVA harus tetap dilakukan melalui antarmuka normal atau dikembangkan sebagai tool baru dengan validasi dan konfirmasi tersendiri.


## Tindakan tambahan pada paket ini

Di luar pencatatan, katalog, resep, produksi, profil, dan jurnal yang disebut di atas, Cashie juga dapat membatalkan transaksi tertentu bila identitas transaksi cocok persis dengan data akun, menetapkan saldo awal (hanya bila belum ada), membuka aktivitas hari ini setelah saldo awal tersedia, dan meminta ekspor laporan akuntansi bulanan. Cashie juga dapat membuka seluruh halaman operasional yang terdaftar serta halaman Ruang Demo; halaman demo hanya dibuka, bukan diubah oleh Cashie. Semua tindakan tersebut meminta konfirmasi pemilik terlebih dahulu.

### Migration v19 wajib

Jalankan `supabase/migration_v19_cashie_action_confirmations.sql` di Supabase SQL Editor setelah migration v18. Migration membuat `cava_action_nonces`, yang mencegah proposal konfirmasi dipakai lebih dari sekali. Jangan menghapus tabel ini selama fitur konfirmasi Cashie digunakan. Pastikan `SUPABASE_SERVICE_ROLE_KEY` tetap hanya di environment server; `CAVA_ACTION_SECRET` opsional dan dapat diisi secret acak minimal 32 karakter.

### Batas cakupan

Cashie menjalankan action yang terdaftar, bukan operasi bebas di seluruh sistem. Halaman login/onboarding/reset password, kredensial, file system, perangkat, dan layanan eksternal tidak dikendalikan. Pembaruan katalog biasa tidak mengubah pelacakan stok bahan; jenis produk jual tetap mengikuti kebijakan katalog tanpa stok v18.
