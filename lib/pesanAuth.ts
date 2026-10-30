// Pesan error Supabase Auth diterjemahkan agar mudah dipahami pedagang.
export function pesanAuth(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes('invalid login credentials')) return 'Email atau kata sandi salah. Kalau lupa, tekan "Lupa kata sandi?".';
  if (m.includes('email not confirmed')) return 'Email belum dikonfirmasi. Cek kotak masuk (dan folder spam) untuk tautan konfirmasi.';
  if (m.includes('rate limit') || m.includes('only request this once') || m.includes('too many')) return 'Terlalu sering meminta. Tunggu beberapa menit, lalu coba lagi.';
  if (m.includes('different from the old')) return 'Kata sandi baru harus berbeda dari yang lama.';
  if (m.includes('at least') && m.includes('characters')) return 'Kata sandi terlalu pendek. Gunakan minimal 6 karakter.';
  if (m.includes('already registered')) return 'Email ini sudah terdaftar. Silakan masuk, atau pakai "Lupa kata sandi?".';
  if (m.includes('failed to fetch') || m.includes('network')) return 'Tidak ada koneksi internet. Coba lagi.';
  return msg;
}
