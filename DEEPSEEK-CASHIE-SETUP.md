# Integrasi DeepSeek untuk Cashie

Cashie menggunakan urutan provider **Groq → Gemini → DeepSeek** untuk permintaan chat.

## Environment variables

Tambahkan di `.env.local` (lokal) dan di Vercel → Project Settings → Environment Variables:

```env
DEEPSEEK_API_KEY=isi_api_key_deepseek
DEEPSEEK_MODEL=deepseek-flash
```

Gunakan API key server-side saja. Jangan gunakan prefix `NEXT_PUBLIC_`, jangan masukkan key asli ke Git, dan jangan menaruhnya di file yang dikirim ke browser.

## Cakupan integrasi

- DeepSeek hanya menjadi provider fallback untuk chat Cashie.
- Transkripsi suara tetap memakai Groq Whisper lalu Gemini.
- Suara balasan tetap memakai endpoint TTS yang sudah ada (ElevenLabs).
- Tidak ada perubahan UI, daftar tindakan Cashie, autentikasi, database, atau migration.

## Pengujian

1. Pastikan variabel sudah tersedia di environment lokal atau Vercel.
2. Restart server lokal setelah mengubah `.env.local`.
3. Kirim pesan ke Cashie. Jika Groq dan Gemini berhasil, DeepSeek memang tidak dipanggil.
4. Saat fallback terjadi, periksa log server dengan label `[CAVA AI] chat deepseek`.

Model default adalah `deepseek-flash`; ganti `DEEPSEEK_MODEL` hanya bila model API yang tersedia di akun memang berbeda.
