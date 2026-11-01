'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

const HALAMAN_PUBLIK = ['/login', '/reset-password', '/onboarding', '/pengaturan-usaha', '/demo'];

/** Mengarahkan akun yang belum menyelesaikan profil usaha ke onboarding. */
export default function BusinessProfileGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (HALAMAN_PUBLIK.some((path) => pathname === path || pathname.startsWith(`${path}/`))) return;

    let batal = false;
    async function periksa() {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (batal || authError || !user) return;

      const { data, error } = await supabase
        .from('business_profiles')
        .select('jenis_usaha,bentuk_usaha,bidang_usaha,memiliki_persediaan,metode_pembayaran,onboarding_completed_at')
        .eq('user_id', user.id)
        .maybeSingle();

      // Jika migration belum diterapkan, jangan membuat redirect berulang.
      // Halaman onboarding akan menampilkan petunjuk migration kepada pengguna.
      if (batal || error) return;

      const lengkap = Boolean(
        data?.jenis_usaha && data?.bentuk_usaha && data?.bidang_usaha?.trim() &&
        data?.memiliki_persediaan !== null && data?.memiliki_persediaan !== undefined &&
        data?.metode_pembayaran && data?.onboarding_completed_at,
      );
      if (!lengkap) router.replace('/onboarding');
    }

    void periksa();
    return () => { batal = true; };
  }, [pathname, router]);

  return null;
}
