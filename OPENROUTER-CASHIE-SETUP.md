# Integrasi OpenRouter Free untuk Cashie

Cashie menggunakan urutan provider **Groq → Gemini → OpenRouter Free** untuk permintaan chat. OpenRouter hanya dipanggil jika Groq dan Gemini tidak berhasil.

## Environment variables

Tambahkan di Vercel → Project Settings → Environment Variables:

```env
OPENROUTER_API_KEY=isi_api_key_openrouter
OPENROUTER_MODEL=openrouter/free
```

`OPENROUTER_MODEL` bersifat opsional karena default kode adalah `openrouter/free`. Gunakan nama model router tersebut untuk tetap meminta model gratis. Jika diganti ke model lain, model itu bisa memiliki harga berbeda.

API key hanya digunakan di server. Jangan menambahkan prefix `NEXT_PUBLIC_`, jangan menaruh key asli di Git, dan jangan mengirimkannya ke browser.

## Cakupan integrasi

- OpenRouter Free menjadi fallback chat terakhir setelah Groq dan Gemini.
- Request menggunakan endpoint Chat Completions yang kompatibel dengan format OpenAI.
- Cashie meminta respons JSON (`response_format: { type: 'json_object' }`) agar alur validasi tindakan yang sudah ada tetap digunakan.
- Transkripsi suara tetap memakai Groq Whisper lalu Gemini.
- Suara balasan tetap memakai ElevenLabs.
- Tidak ada perubahan UI utama, daftar tindakan Cashie, autentikasi, database, atau migration.

## Batas penggunaan

Model gratis memiliki batas penggunaan dan ketersediaannya bisa berubah. OpenRouter mendokumentasikan batas umum untuk varian gratis `:free` sebesar 20 permintaan per menit dan 50 permintaan per hari; model tertentu juga dapat memiliki batas dari penyedianya. Respons HTTP 429 berarti batas tercapai atau model sedang sibuk. Lihat halaman resmi untuk ketentuan terbaru:

- https://openrouter.ai/collections/free-models
- https://openrouter.ai/docs/guides/routing/routers/free

## Pengujian setelah mengatur Vercel

1. Tambahkan `OPENROUTER_API_KEY` dan `OPENROUTER_MODEL=openrouter/free` pada environment Production (tambahkan Preview juga bila diperlukan).
2. Simpan lalu lakukan redeploy agar environment baru terbaca.
3. Groq dan Gemini tetap akan diprioritaskan. OpenRouter hanya terpanggil jika keduanya gagal.
4. Untuk memeriksa fallback, lihat Vercel Runtime Logs dengan label `[CAVA AI] chat openrouter` dan `[CAVA AI] OpenRouter model=`.
5. Bila terlihat HTTP 429, tunggu batas penggunaan pulih atau coba lagi nanti.

