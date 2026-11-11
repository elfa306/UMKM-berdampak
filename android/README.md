# CAVA Android – prototipe pembaca notifikasi

Proyek Kotlin ini merupakan tahap awal aplikasi CAVA. Website tetap dijalankan melalui WebView. NotificationListenerService menguji apakah notifikasi dari aplikasi yang dipilih dapat diterima dan nominalnya bisa diekstrak.

## Status prototipe
- WebView membuka website CAVA produksi.
- Layanan Android mengamati nama paket sumber dan waktu notifikasi.
- Sebelum pengguna memilih aplikasi target, teks notifikasi tidak dibaca atau disimpan.
- Setelah pengguna memilih GoPay Merchant, parser membaca judul/teks sementara di memori, lalu hanya menyimpan nominal, status parsing, nama paket, dan waktu secara lokal.
- Belum ada pengiriman data ke API atau Supabase.
- Package name GoPay Merchant belum di-hardcode karena harus diverifikasi dari HP uji.

## Build
Persyaratan: Android Studio yang mendukung Android Gradle Plugin 8.10.x, JDK 17, Android SDK Platform 36, dan Build Tools 35.0.0.

Buka folder `android/` sebagai proyek Android Studio, sinkronkan Gradle, lalu pilih **Build > Build Bundle(s) / APK(s) > Build APK(s)**.

Alternatif command line setelah Gradle 8.11.1 tersedia:

```bash
gradle -p android testDebugUnitTest assembleDebug
```

APK debug: `android/app/build/outputs/apk/debug/app-debug.apk`.

URL website default adalah `https://www.umkmberdampak.my.id`. URL dapat diganti dengan properti Gradle `-PcavaWebUrl=https://domain-kamu.example`.

## Uji pada HP
1. Instal APK debug dan pastikan website CAVA berhasil dimuat.
2. Buka tab **Integrasi GoPay**.
3. Aktifkan Notification Access melalui pengaturan Android.
4. Kembali ke CAVA dan segarkan daftar setelah notifikasi dari aplikasi muncul.
5. Pilih aplikasi GoPay Merchant dari daftar sumber yang terdeteksi.
6. Periksa hasil pembacaan notifikasi berikutnya.

Prototipe ini belum mengirim data ke server. Tahap pertama hanya membuktikan package name dan format notifikasi nyata. Notifikasi bukan bukti settlement resmi.

## Tahap berikutnya
Setelah prototipe lolos uji perangkat nyata, tambahkan pengiriman HTTPS ke API CAVA dengan autentikasi perangkat, sumber `gopay_android`, deduplikasi, dan antrean offline. Migration SQL harus dibuat terpisah dan diterapkan manual di Supabase. MacroDroid tetap dipertahankan selama masa transisi.
