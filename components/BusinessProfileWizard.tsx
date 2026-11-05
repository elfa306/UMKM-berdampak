'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ArrowRight, BriefcaseBusiness, Check, CircleHelp, Factory,
  ShoppingBasket, Store,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { todayISO } from '@/lib/accounting';
import BottomNav from '@/components/BottomNav';

type JenisUsaha = 'retail' | 'manufaktur' | 'jasa' | 'campuran';
type BentukUsaha = 'perorangan' | 'pt_perorangan' | 'cv' | 'pt' | 'koperasi' | 'lainnya';
type MetodePembayaran = 'gopay_macrodroid' | 'belibayar_sandbox_static' | 'belibayar_sandbox_dynamic' | 'manual';
type FormProfil = {
  nama_usaha: string;
  tanggal_mulai_usaha: string;
  hari_buka_per_bulan: string;
  kebutuhan_modal: string;
  jenis_usaha: JenisUsaha | '';
  bentuk_usaha: BentukUsaha | '';
  bidang_usaha: string;
  memiliki_persediaan: 'ya' | 'tidak' | '';
  metode_pembayaran: MetodePembayaran | '';
};
type ProfilTersimpan = {
  user_id: string;
  nama_usaha?: string;
  tanggal_mulai_usaha?: string;
  hari_buka_per_bulan?: number | string;
  kebutuhan_modal?: number | string;
  jenis_usaha?: JenisUsaha | null;
  bentuk_usaha?: BentukUsaha | null;
  bidang_usaha?: string | null;
  memiliki_persediaan?: boolean | null;
  metode_pembayaran?: MetodePembayaran | null;
  onboarding_completed_at?: string | null;
};

type Props = { mode?: 'onboarding' | 'settings' };

const FORM_AWAL: FormProfil = {
  nama_usaha: '',
  tanggal_mulai_usaha: '',
  hari_buka_per_bulan: '26',
  kebutuhan_modal: '',
  jenis_usaha: '',
  bentuk_usaha: '',
  bidang_usaha: '',
  memiliki_persediaan: '',
  metode_pembayaran: '',
};

const JENIS = [
  { id: 'retail', nama: 'Retail / Perdagangan', contoh: 'Warung, toko sembako, toko pakaian, reseller', ikon: Store },
  { id: 'manufaktur', nama: 'Manufaktur / Produksi', contoh: 'Makanan kemasan, keripik, kerajinan, konveksi', ikon: Factory },
  { id: 'jasa', nama: 'Jasa', contoh: 'Barbershop, servis, laundry, jasa desain', ikon: BriefcaseBusiness },
  { id: 'campuran', nama: 'Campuran', contoh: 'Usaha yang memproduksi sekaligus menjual barang', ikon: ShoppingBasket },
] as const;

const BENTUK = [
  { value: 'perorangan', label: 'Usaha perorangan' },
  { value: 'pt_perorangan', label: 'Perseroan perorangan' },
  { value: 'cv', label: 'CV' },
  { value: 'pt', label: 'PT' },
  { value: 'koperasi', label: 'Koperasi' },
  { value: 'lainnya', label: 'Lainnya / belum ditentukan' },
] as const;

const PEMBAYARAN = [
  {
    value: 'gopay_macrodroid',
    title: 'Saya sudah menggunakan GoPay Merchant',
    description: 'Pencatatan pembayaran asli dapat diteruskan melalui notifikasi GoPay Merchant dan MacroDroid.',
    tag: 'Integrasi pembayaran yang sudah tersedia',
  },
  {
    value: 'manual',
    title: 'Pencatatan manual + QRIS contoh',
    description: 'Penjualan dicatat manual. Kasir juga menyediakan pratinjau QRIS statis dan dinamis untuk dicoba; gambar QR tersebut tidak menerima pembayaran.',
    tag: 'Tanpa gateway pembayaran',
  },
] as const;

function sudahLengkap(data: ProfilTersimpan | null) {
  return Boolean(
    data?.jenis_usaha && data?.bentuk_usaha && data?.bidang_usaha?.trim() &&
    data?.memiliki_persediaan !== null && data?.memiliki_persediaan !== undefined &&
    data?.metode_pembayaran && data?.onboarding_completed_at,
  );
}

function keForm(data: ProfilTersimpan | null, namaMetadata = ''): FormProfil {
  if (!data) return { ...FORM_AWAL, nama_usaha: namaMetadata };
  return {
    nama_usaha: String(data.nama_usaha ?? namaMetadata ?? ''),
    tanggal_mulai_usaha: String(data.tanggal_mulai_usaha ?? ''),
    hari_buka_per_bulan: String(data.hari_buka_per_bulan ?? 26),
    kebutuhan_modal: data.kebutuhan_modal == null ? '' : String(data.kebutuhan_modal),
    jenis_usaha: data.jenis_usaha ?? '',
    bentuk_usaha: data.bentuk_usaha ?? '',
    bidang_usaha: String(data.bidang_usaha ?? ''),
    memiliki_persediaan: data.memiliki_persediaan == null ? '' : data.memiliki_persediaan ? 'ya' : 'tidak',
    // Nilai Belibayar lama dinormalisasi ke manual karena gateway tersebut tidak lagi digunakan.
    metode_pembayaran: data.metode_pembayaran === 'gopay_macrodroid' ? 'gopay_macrodroid' : data.metode_pembayaran ? 'manual' : '',
  };
}

export default function BusinessProfileWizard({ mode = 'onboarding' }: Props) {
  const router = useRouter();
  const editMode = mode === 'settings';
  const [form, setForm] = useState<FormProfil>(FORM_AWAL);
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [userId, setUserId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (!user) {
        setUserId('guest');
        setForm({
          nama_usaha: '[Nama Usaha]',
          tanggal_mulai_usaha: '2024-01-15',
          hari_buka_per_bulan: '26',
          kebutuhan_modal: '5000000',
          jenis_usaha: 'campuran',
          bentuk_usaha: 'perorangan',
          bidang_usaha: 'Makanan & Minuman (Kedai Kopi & Roti)',
          memiliki_persediaan: 'ya',
          metode_pembayaran: 'manual',
        });
        setLoading(false);
        return;
      }
      setUserId(user.id);

      const { data, error: profileError } = await supabase
        .from('business_profiles')
        .select('user_id,nama_usaha,tanggal_mulai_usaha,hari_buka_per_bulan,kebutuhan_modal,jenis_usaha,bentuk_usaha,bidang_usaha,memiliki_persediaan,metode_pembayaran,onboarding_completed_at')
        .eq('user_id', user.id)
        .maybeSingle();

      if (profileError) {
        if (profileError.code === '42P01' || profileError.code === 'PGRST205' || /business_profiles|column .* does not exist/i.test(profileError.message)) {
          throw new Error('Struktur profil belum tersedia. Jalankan file supabase/migration_v5.sql melalui Supabase Dashboard → SQL Editor, lalu muat ulang halaman ini.');
        }
        throw profileError;
      }

      const profil = (data ?? null) as ProfilTersimpan | null;
      if (editMode && !profil) {
        setForm({ ...FORM_AWAL, nama_usaha: user.user_metadata?.nama_usaha ?? '[Nama Usaha]' });
        setLoading(false);
        return;
      }
      setForm(keForm(profil, user.user_metadata?.nama_usaha ?? ''));
      if (!editMode && sudahLengkap(profil)) {
        // Profil sudah lengkap: bila belum punya produk, lanjutkan ke pengisian inventaris awal
        const { count } = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('aktif', true);
        router.replace(count === 0 ? '/onboarding/inventaris' : '/kasir');
      }
    } catch (e) {
      setError((e as Error).message || 'Gagal memuat profil usaha.');
    } finally {
      setLoading(false);
    }
  }, [editMode, router]);

  useEffect(() => { void load(); }, [load]);

  const steps = useMemo(() => ['Profil dasar', 'Karakteristik usaha', 'Pembayaran'], []);

  function ubah<K extends keyof FormProfil>(key: K, value: FormProfil[K]) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  function validasiStep(): boolean {
    setError('');
    if (step === 0) {
      const modal = Number(form.kebutuhan_modal);
      const hari = Number(form.hari_buka_per_bulan);
      if (!form.nama_usaha.trim()) return voidError('Nama usaha wajib diisi.');
      if (!form.tanggal_mulai_usaha) return voidError('Tanggal mulai usaha wajib diisi.');
      if (form.tanggal_mulai_usaha > todayISO()) return voidError('Tanggal mulai usaha tidak boleh di masa depan.');
      if (!Number.isInteger(hari) || hari < 1 || hari > 31) return voidError('Hari operasional harus antara 1 sampai 31 hari per bulan.');
      if (!Number.isSafeInteger(modal) || modal <= 0) return voidError('Kebutuhan modal harus berupa bilangan bulat positif.');
    }
    if (step === 1) {
      if (!form.jenis_usaha || !form.bentuk_usaha || !form.bidang_usaha.trim() || form.memiliki_persediaan === '') {
        return voidError('Lengkapi jenis usaha, bentuk usaha, bidang usaha, dan informasi persediaan.');
      }
    }
    if (step === 2 && !form.metode_pembayaran) return voidError('Pilih metode pencatatan pembayaran.');
    return true;
  }

  function voidError(message: string): false {
    setError(message);
    return false;
  }

  function lanjut() {
    if (!validasiStep()) return;
    setStep((s) => Math.min(2, s + 1));
  }

  async function simpan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step !== 2 || !validasiStep()) return;
    if (!userId) { setError('Sesi login tidak ditemukan. Silakan masuk kembali.'); return; }
    if (userId === 'guest') {
      setNotice('Profil usaha berhasil diperbarui (Mode Tamu).');
      if (!editMode) router.replace('/kasir');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        user_id: userId,
        nama_usaha: form.nama_usaha.trim(),
        tanggal_mulai_usaha: form.tanggal_mulai_usaha,
        hari_buka_per_bulan: Number(form.hari_buka_per_bulan),
        kebutuhan_modal: Number(form.kebutuhan_modal),
        jenis_usaha: form.jenis_usaha,
        bentuk_usaha: form.bentuk_usaha,
        bidang_usaha: form.bidang_usaha.trim(),
        memiliki_persediaan: form.memiliki_persediaan === 'ya',
        metode_pembayaran: form.metode_pembayaran,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: saveError } = await supabase
        .from('business_profiles')
        .upsert(payload, { onConflict: 'user_id' });
      if (saveError) throw saveError;

      const { error: metadataError } = await supabase.auth.updateUser({ data: { nama_usaha: payload.nama_usaha } });
      if (metadataError) throw metadataError;

      if (editMode) {
        setNotice('Profil usaha berhasil diperbarui.');
      } else {
        router.replace('/onboarding/inventaris');
      }
    } catch (e) {
      setError((e as Error).message || 'Gagal menyimpan profil usaha.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="min-h-screen bg-slate-50 px-4 py-12"><div className="mx-auto max-w-xl text-center text-sm text-slate-500">Memuat profil usaha…</div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 pb-12">
      <div className="mx-auto grid max-w-2xl gap-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="m-0 text-xs font-bold uppercase tracking-[.16em] text-emerald-700">UMKM BERDAMPAK</p>
            <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{editMode ? 'Pengaturan usaha' : 'Kenali usaha Anda'}</h1>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600">
              {editMode ? 'Perbarui informasi usaha dan metode pencatatan pembayaran.' : 'Lengkapi profil singkat agar pencatatan dan analisis usaha disesuaikan dengan kebutuhan bisnis Anda.'}
            </p>
          </div>
          {editMode && <button type="button" onClick={() => router.push('/lainnya')} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600">Kembali</button>}
        </header>

        {!editMode && (
          <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-900">
            <b>Satu kali pengaturan.</b> Data ini tersimpan khusus untuk akun Anda. Anda dapat mengubahnya kapan saja melalui menu Pengaturan Usaha.
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 grid grid-cols-3 gap-2">
            {steps.map((label, i) => (
              <div key={label} className="grid gap-2">
                <div className={`h-1.5 rounded-full ${i <= step ? 'bg-emerald-500' : 'bg-slate-100'}`} />
                <span className={`text-[11px] font-bold ${i === step ? 'text-emerald-700' : 'text-slate-400'}`}>{i + 1}. {label}</span>
              </div>
            ))}
          </div>

          {error && <div role="alert" className="mb-4 rounded-xl border border-red-100 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}

          <form onSubmit={simpan} className="grid gap-5">
            {step === 0 && (
              <div className="grid gap-4">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Profil dasar usaha</h2>
                  <p className="text-sm text-slate-500">Informasi dasar yang juga digunakan pada laporan dan rekomendasi modal.</p>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  Nama usaha
                  <input value={form.nama_usaha} onChange={(e) => ubah('nama_usaha', e.target.value)} required maxLength={100} placeholder="Contoh: Warung Makan Berkah" className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500" />
                </label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Mulai menjalankan usaha
                    <input type="date" max={todayISO()} value={form.tanggal_mulai_usaha} onChange={(e) => ubah('tanggal_mulai_usaha', e.target.value)} required className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                    Hari operasional per bulan
                    <input type="number" min={1} max={31} step={1} value={form.hari_buka_per_bulan} onChange={(e) => ubah('hari_buka_per_bulan', e.target.value)} required className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  Perkiraan kebutuhan modal (Rp)
                  <input type="number" min={1} step={1} inputMode="numeric" value={form.kebutuhan_modal} onChange={(e) => ubah('kebutuhan_modal', e.target.value)} required placeholder="Contoh: 5000000" className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500" />
                  <span className="text-xs font-normal text-slate-500">Masukkan angka bulat tanpa titik atau simbol rupiah.</span>
                </label>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Karakteristik usaha</h2>
                  <p className="text-sm text-slate-500">Jenis aktivitas bisnis menentukan cara pencatatan stok dan biaya.</p>
                </div>
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-semibold text-slate-700">Jenis usaha</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {JENIS.map((item) => {
                      const Icon = item.ikon;
                      const selected = form.jenis_usaha === item.id;
                      return (
                        <button key={item.id} type="button" onClick={() => setForm((old) => ({ ...old, jenis_usaha: item.id, memiliki_persediaan: item.id === 'jasa' ? 'tidak' : old.memiliki_persediaan || 'ya' }))}
                          className={`rounded-xl border p-3 text-left transition ${selected ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200' : 'border-slate-200 bg-white hover:border-slate-300'}`} aria-pressed={selected}>
                          <div className="flex items-center gap-2"><Icon size={19} className={selected ? 'text-emerald-700' : 'text-slate-500'} /><span className="text-sm font-bold text-slate-800">{item.nama}</span>{selected && <Check size={16} className="ml-auto text-emerald-700" />}</div>
                          <p className="mb-0 mt-1 text-xs leading-relaxed text-slate-500">{item.contoh}</p>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  Bentuk usaha
                  <select value={form.bentuk_usaha} onChange={(e) => ubah('bentuk_usaha', e.target.value as BentukUsaha)} className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500">
                    <option value="">Pilih bentuk usaha</option>
                    {BENTUK.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <span className="text-xs font-normal text-slate-500">Pilih bentuk yang paling sesuai dengan kondisi usaha Anda.</span>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-slate-700">
                  Bidang usaha
                  <input value={form.bidang_usaha} onChange={(e) => ubah('bidang_usaha', e.target.value)} maxLength={100} required placeholder="Contoh: sembako, makanan ringan, konveksi" className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none focus:border-emerald-500" />
                </label>
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-semibold text-slate-700">Apakah usaha memiliki persediaan barang?</legend>
                  <div className="grid grid-cols-2 gap-2">
                    {([{ value: 'ya', label: 'Ya, memiliki stok' }, { value: 'tidak', label: 'Tidak ada stok' }] as const).map((item) => (
                      <button key={item.value} type="button" onClick={() => ubah('memiliki_persediaan', item.value)} aria-pressed={form.memiliki_persediaan === item.value}
                        className={`rounded-xl border p-3 text-sm font-semibold ${form.memiliki_persediaan === item.value ? 'border-emerald-500 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600'}`}>{item.label}</button>
                    ))}
                  </div>
                  {form.jenis_usaha === 'jasa' && <p className="m-0 text-xs text-slate-500">Usaha jasa biasanya dapat memilih tidak memiliki persediaan, tetapi Anda tetap bisa mengaktifkan stok jika menyediakan barang.</p>}
                </fieldset>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4">
                <div>
                  <h2 className="text-lg font-extrabold text-slate-900">Metode pencatatan pembayaran</h2>
                  <p className="text-sm text-slate-500">Pilih metode yang paling sesuai. Pengaturan ini dapat diubah kemudian.</p>
                </div>
                <div className="grid gap-2">
                  {PEMBAYARAN.map((item) => {
                    const active = form.metode_pembayaran === item.value;
                    return (
                      <button key={item.value} type="button" onClick={() => ubah('metode_pembayaran', item.value)} aria-pressed={active}
                        className={`rounded-xl border p-3 text-left transition ${active ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-200' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                        <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-bold text-slate-800">{item.title}</span>{active && <Check size={16} className="text-emerald-700" />}</div>
                        <p className="mb-1 mt-1 text-xs leading-relaxed text-slate-500">{item.description}</p>
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{item.tag}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
                  <b>Catatan penting:</b> QRIS statis dan dinamis di kasir adalah gambar contoh yang tidak menerima pembayaran. Untuk pencatatan pembayaran QRIS sungguhan, akun GoPay Merchant tetap dapat menggunakan integrasi MacroDroid.
                </div>
              </div>
            )}

            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
              <button type="button" disabled={step === 0 || saving} onClick={() => { setError(''); setStep((s) => Math.max(0, s - 1)); }}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 disabled:opacity-40">
                <ArrowLeft size={16}/> Kembali
              </button>
              {step < 2 ? (
                <button type="button" onClick={lanjut} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white">
                  Lanjut <ArrowRight size={16}/>
                </button>
              ) : (
                <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                  {saving ? 'Menyimpan…' : editMode ? 'Simpan perubahan' : 'Selesaikan pengaturan'} <Check size={16}/>
                </button>
              )}
            </div>
          </form>
        </section>

        <div className="flex items-start gap-2 rounded-xl bg-slate-100 p-3 text-xs leading-relaxed text-slate-600">
          <CircleHelp size={17} className="mt-0.5 shrink-0" />
          <p className="m-0">Informasi ini dipakai untuk menyesuaikan fitur UMKM Berdampak. Pilihan bentuk usaha bukan pemeriksaan legalitas dan metode pembayaran tidak mengaktifkan layanan pihak ketiga secara otomatis.</p>
        </div>
        {!editMode && <p className="m-0 text-center text-xs text-slate-400">Profil dapat diperbarui kapan saja melalui menu Pengaturan Usaha.</p>}
        {editMode && <BottomNav />}
      </div>
    </main>
  );
}
