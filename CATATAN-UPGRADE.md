# Catatan upgrade (modern web guidance)

## Menjalankan di localhost
```bash
npm install
cp .env.local.example .env.local   # isi nilai Supabase, dll.
npm run dev                        # http://localhost:3000
npm run typecheck                  # opsional
```

## Yang berubah
- Modal: 8 overlay custom diganti `<dialog>` native lewat `components/Modal.tsx`
  (fokus terkunci, Escape, backdrop, fokus kembali ke pemicu, scroll lock, animasi masuk).
- `confirm()` bawaan browser (6 titik) diganti `useConfirm()` di `components/ConfirmDialog.tsx`;
  fokus awal pada tombol Batal.
- Form: `components/FormA11y.tsx` menyelaraskan `aria-invalid` dengan `:user-invalid` + live region;
  input tanpa label diberi `aria-label`; tombol tutup berikon diberi `aria-label`.
- Gambar: logo CAVA jadi WebP (`public/*.webp`), atribut width/height/decoding, `fetchPriority`.
  `qris-contoh.png` tidak diubah karena dirujuk API/DB.
- CSS: `font-size-adjust: from-font`, `100dvh` / `min-h-dvh`, gaya `:user-invalid`.
- Repo: `tsconfig.tsbuildinfo` tidak lagi di-track, dua file env example digabung ke `.env.local.example`,
  skrip `typecheck` ditambahkan.

## Tidak dikerjakan
- Dark mode (warna brand ditulis langsung di banyak komponen; perlu keputusan desain).
- Animasi keluar dialog (hanya animasi masuk).
- `next/font` (tidak bisa diuji di lingkungan tanpa akses Google Fonts).
