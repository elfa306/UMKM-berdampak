'use client';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import BottomNav from '@/components/BottomNav';

const HEADER = 'x-webhook-token';
const TIPE = 'application/json';
const BODY = '{"title":"{not_title}","text":"{notification}","ts":"{not_timestamp}"}';

const sha256hex = async (s: string) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
};

function Bagian({ no, judul, children }: { no: number; judul: string; children: ReactNode }) {
  return (
    <div className="glass-card">
      <span className="label">Bagian {no}</span>
      <h3 style={{ margin: '2px 0 6px', fontSize: '1.05rem' }}>{judul}</h3>
      {children}
    </div>
  );
}

const Langkah = ({ children }: { children: ReactNode }) => (
  <ol style={{ paddingLeft: 20, margin: '8px 0', display: 'grid', gap: 10, fontSize: '.88rem', lineHeight: 1.6 }}>{children}</ol>
);

const Tip = ({ children, warna = '#fef3c7' }: { children: ReactNode; warna?: string }) => (
  <div style={{ background: warna, borderRadius: 12, padding: '10px 12px', fontSize: '.8rem', lineHeight: 1.55, margin: '8px 0' }}>{children}</div>
);

// Baris teks yang bisa disalin dengan satu ketukan
function Isi({ label, nilai, siap = true, kosong }: { label: string; nilai: string; siap?: boolean; kosong?: string }) {
  const [ok, setOk] = useState(false);
  async function salin() {
    try { await navigator.clipboard.writeText(nilai); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* abaikan */ }
  }
  return (
    <div style={{ margin: '8px 0' }}>
      <span className="muted">{label}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
        <code style={{ flex: 1, background: '#f1f5f9', borderRadius: 10, padding: '8px 10px', fontSize: '.72rem', wordBreak: 'break-all' }}>
          {siap ? nilai : kosong}
        </code>
        <button className="btn-pill" disabled={!siap} onClick={salin}>{ok ? 'Tersalin ✓' : 'Salin'}</button>
      </div>
    </div>
  );
}

const Tanya = ({ q, children }: { q: string; children: ReactNode }) => (
  <details style={{ borderTop: '1px solid #e2e8f0', padding: '10px 0', fontSize: '.85rem', lineHeight: 1.6 }}>
    <summary style={{ fontWeight: 800, cursor: 'pointer' }}>{q}</summary>
    <div style={{ marginTop: 6 }}>{children}</div>
  </details>
);

export default function Integrasi() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [aktif, setAktif] = useState(false);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [terakhir, setTerakhir] = useState<{ waktu: string; jumlah: number } | null | undefined>(undefined);

  const cekStatus = useCallback(async () => {
    const { data } = await supabase.from('qris_inbox').select('received_at,jumlah').order('received_at', { ascending: false }).limit(1).maybeSingle();
    setTerakhir(data ? { waktu: new Date(data.received_at).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' }), jumlah: Number(data.jumlah) } : null);
  }, []);

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/gopay`);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return router.replace('/login');
      const { data } = await supabase.from('webhook_tokens').select('user_id').maybeSingle();
      setAktif(!!data);
      await cekStatus();
      setReady(true);
    })();
    const t = setInterval(() => { if (!document.hidden) cekStatus(); }, 15000);
    return () => clearInterval(t);
  }, [router, cekStatus]);

  async function buat() {
    if (aktif && !confirm('Token lama akan berhenti berlaku dan MacroDroid harus diisi ulang dengan token baru. Lanjutkan?')) return;
    setErr('');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return router.replace('/login');
    const baru = Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, '0')).join('');
    const { error } = await supabase.from('webhook_tokens').upsert({ user_id: user.id, token_hash: await sha256hex(baru) });
    if (error) return setErr(error.message);
    setToken(baru); setAktif(true);
  }

  if (!ready) return <div className="wrap"><div className="header-app"><p>Memuat…</p></div></div>;

  return (
    <div className="wrap">
      <div className="header-app"><h1>Hubungkan <span>QRIS</span></h1><p>Pembayaran GoPay Merchant tercatat otomatis</p></div>
      {err && <p className="err">{err}</p>}

      <div className="glass-card">
        <span className="label">Status sambungan</span>
        {terakhir === null && <p className="muted">Belum ada pembayaran yang masuk lewat sambungan ini. Ikuti panduan di bawah, lalu lakukan tes pembayaran kecil.</p>}
        {terakhir && <p style={{ margin: '6px 0', fontWeight: 800, color: '#059669' }}>✅ Tersambung. Sinyal terakhir: {terakhir.waktu} (Rp {terakhir.jumlah.toLocaleString('id-ID')})</p>}
        <button className="btn-soft" onClick={cekStatus}>Cek lagi</button>
      </div>

      <div className="glass-card">
        <span className="label">Apa ini?</span>
        <p style={{ fontSize: '.88rem', lineHeight: 1.6, margin: '6px 0' }}>
          Setiap ada uang masuk ke GoPay Merchant, HP Anda menerima notifikasi. Aplikasi bantu bernama <b>MacroDroid</b> membaca notifikasi itu dan mengirimkannya ke aplikasi Kasir ini, sehingga penjualan QRIS tercatat sendiri tanpa diketik. Panduan ini dibuat untuk pemula. Siapkan sekitar 15 sampai 20 menit dan ikuti urutannya.
        </p>
      </div>

      <Bagian no={1} judul="Sebelum mulai">
        <Langkah>
          <li><b>Harus HP Android.</b> iPhone tidak bisa, karena iPhone tidak mengizinkan aplikasi lain membaca notifikasi.</li>
          <li>Pakai <b>HP yang sama</b> dengan yang terpasang aplikasi <b>GoPay Merchant</b> dan menerima notifikasi pembayaran.</li>
          <li>Pastikan HP terhubung internet (Wi-Fi atau paket data).</li>
          <li><b>Buka halaman ini di HP tersebut.</b> Dengan begitu tombol “Salin” di bawah bisa langsung ditempel ke MacroDroid tanpa mengetik.</li>
        </Langkah>
        <Tip>Satu HP untuk satu usaha. Kalau ada dua usaha dengan GoPay Merchant berbeda, tiap usaha memerlukan HP dan akun Kasir sendiri.</Tip>
      </Bagian>

      <Bagian no={2} judul="Pasang aplikasi MacroDroid">
        <Langkah>
          <li>Buka <b>Google Play Store</b> (ikon segitiga warna-warni) di HP.</li>
          <li>Ketuk kolom pencarian di bagian atas, ketik <b>MacroDroid</b>, lalu ketuk ikon cari (kaca pembesar) di keyboard.</li>
          <li>Pilih <b>MacroDroid - Device Automation</b> (pembuatnya ArloSoft). Ikonnya berwarna biru dengan gambar robot kecil.</li>
          <li>Ketuk tombol hijau <b>Instal</b>. Tunggu sampai selesai, lalu ketuk <b>Buka</b>.</li>
          <li>Saat pertama dibuka, MacroDroid menampilkan beberapa layar sambutan. Ketuk <b>Lanjut</b> atau <b>Next</b> sampai selesai. Kalau ada pertanyaan izin, ketuk <b>Izinkan</b>.</li>
          <li>Kalau muncul tawaran berlangganan atau “Pro”, abaikan saja. Versi gratis sudah cukup (boleh membuat sampai 5 makro).</li>
        </Langkah>
      </Bagian>

      <Bagian no={3} judul="Beri izin MacroDroid membaca notifikasi">
        <p className="muted">Ini langkah yang paling sering terlewat. Tanpa izin ini, MacroDroid tidak bisa melihat notifikasi GoPay Merchant.</p>
        <Langkah>
          <li>Buka <b>Pengaturan</b> HP (ikon roda gigi).</li>
          <li>Ketuk kolom <b>cari</b> di bagian atas Pengaturan, lalu ketik <b>akses notifikasi</b>. Kalau tidak ketemu, cari tulisan <b>Notifikasi</b>, lalu <b>Akses notifikasi</b> (nama bisa sedikit berbeda di tiap merek HP).</li>
          <li>Cari <b>MacroDroid</b> di daftar, ketuk saklarnya sampai menyala, lalu ketuk <b>Izinkan</b> atau <b>OK</b>.</li>
          <li>Kembali ke Pengaturan, cari <b>Baterai</b>, lalu <b>Penggunaan baterai aplikasi</b> atau <b>Optimalisasi baterai</b>. Pilih <b>MacroDroid</b> dan ubah menjadi <b>Tanpa batasan</b> (atau <b>Tidak dioptimalkan</b>). Ini mencegah HP mematikan MacroDroid diam-diam.</li>
          <li>Di HP merek Oppo, Realme, Vivo, atau Xiaomi: buka <b>Pengaturan → Aplikasi → MacroDroid</b>, lalu aktifkan <b>Mulai otomatis</b> (Autostart) dan izinkan <b>aktivitas latar belakang</b>.</li>
          <li>Pastikan notifikasi aplikasi <b>GoPay Merchant</b> tidak dimatikan: Pengaturan → Notifikasi → GoPay Merchant → <b>Izinkan notifikasi</b>.</li>
        </Langkah>
      </Bagian>

      <Bagian no={4} judul="Buat token (kunci rahasia akun Anda)">
        <p style={{ fontSize: '.88rem', lineHeight: 1.6, margin: '6px 0' }}>
          Token adalah kata sandi panjang yang membuat pembayaran dari HP Anda masuk ke akun Kasir Anda sendiri, bukan ke akun orang lain.
        </p>
        <Langkah>
          <li>Ketuk tombol <b>{aktif ? 'BUAT ULANG TOKEN' : 'BUAT TOKEN'}</b> di bawah.</li>
          <li>Token muncul dan <b>hanya tampil sekali</b>. Jangan tutup halaman ini dulu.</li>
          <li>Anda akan menyalin token di Bagian 5. Kalau halaman sempat tertutup atau lupa, cukup buat token baru.</li>
        </Langkah>
        {token && <Isi label="Token akun Anda" nilai={token} />}
        {!token && aktif && <p className="muted">Token sudah pernah dibuat dan tidak bisa ditampilkan lagi. Untuk memasang di MacroDroid, buat token baru.</p>}
        <button className="btn-main" onClick={buat}>{aktif ? 'BUAT ULANG TOKEN' : 'BUAT TOKEN'}</button>
        <Tip warna="#fee2e2"><b>Rahasiakan token.</b> Jangan kirim ke orang lain atau foto dan unggah ke media sosial. Orang yang memegang token bisa menambahkan catatan pembayaran palsu ke akun Anda. Kalau bocor, buat ulang token.</Tip>
      </Bagian>

      <Bagian no={5} judul="Buat aturan otomatis (makro) di MacroDroid">
        <p className="muted">“Makro” adalah aturan: <i>kalau ada notifikasi GoPay Merchant, kirim ke aplikasi Kasir</i>. Tampilan MacroDroid bisa sedikit berbeda dari tulisan di sini. Cari tulisan yang paling mirip.</p>

        <h4 style={{ margin: '14px 0 2px' }}>A. Buat makro baru dan pasang pemicu</h4>
        <Langkah>
          <li>Buka <b>MacroDroid</b>. Di layar utama, ketuk tombol <b>+</b> (Tambah Makro), biasanya di pojok kanan bawah.</li>
          <li>Layar “makro baru” punya tiga bagian: <b>Pemicu</b> (Triggers), <b>Aksi</b> (Actions), dan <b>Batasan</b> (Constraints). Kita hanya mengisi Pemicu dan Aksi.</li>
          <li>Ketuk tanda <b>+ di bagian Pemicu</b> (biasanya berwarna merah atau oranye).</li>
          <li>Pilih kelompok <b>Aplikasi</b>, lalu ketuk <b>Notifikasi Diterima</b>.</li>
          <li>Ketuk <b>Pilih aplikasi</b>, cari dan centang <b>GoPay Merchant</b>, lalu ketuk <b>OK</b>.</li>
          <li>Kolom pencocokan isi notifikasi <b>biarkan kosong</b> atau pilih <b>semua notifikasi</b>. Server Kasir yang akan memilah mana yang uang masuk.</li>
          <li>Ketuk <b>OK</b> atau tanda centang untuk menyimpan pemicu.</li>
        </Langkah>

        <h4 style={{ margin: '14px 0 2px' }}>B. Pasang aksi pengiriman</h4>
        <Langkah>
          <li>Ketuk tanda <b>+ di bagian Aksi</b> (biasanya berwarna biru).</li>
          <li>Pilih kelompok <b>Konektivitas</b>, lalu ketuk <b>Permintaan HTTP</b> (HTTP Request).</li>
          <li>Isi kolom-kolom berikut. Gunakan tombol <b>Salin</b>, lalu tempel (tahan jari di kolom isian, pilih <b>Tempel</b>).</li>
        </Langkah>

        <Isi label="URL (alamat tujuan)" nilai={endpoint} />
        <p className="muted" style={{ margin: '2px 0 8px' }}>Metode (Method / Request type): pilih <b>POST</b>.</p>
        <Isi label="Tipe konten (Content type)" nilai={TIPE} />
        <Isi label="Isi (Body / Content body)" nilai={BODY} />
        <Tip warna="#e0f2fe">Tanda kurung kurawal <b>{'{not_title}'}</b>, <b>{'{notification}'}</b>, dan <b>{'{not_timestamp}'}</b> memang harus ditulis apa adanya. MacroDroid akan menggantinya sendiri dengan judul, isi, dan waktu notifikasi. Kalau lebih nyaman, ketuk tombol <b>{'{…}'}</b> di kolom isi dan pilih variabelnya dari daftar.</Tip>

        <p style={{ fontSize: '.88rem', lineHeight: 1.6, margin: '10px 0 0' }}><b>Header (kunci pengaman).</b> Cari bagian <b>Header</b> lalu ketuk <b>Tambah header</b>.</p>
        <Isi label="Nama header" nilai={HEADER} />
        <Isi label="Nilai header (token akun Anda)" nilai={token} siap={!!token} kosong="Buat token di Bagian 4 dulu" />
        <p className="muted">Kalau MacroDroid hanya menyediakan satu kolom teks untuk header, tulis satu baris: <b>x-webhook-token: </b> lalu token Anda. Tidak boleh ada spasi di awal atau akhir token dan jangan memakai tanda kutip.</p>

        <h4 style={{ margin: '14px 0 2px' }}>C. Simpan dan aktifkan</h4>
        <Langkah>
          <li>Ketuk <b>OK</b> atau tanda centang untuk menyimpan aksi.</li>
          <li>Ketuk kolom nama makro dan beri nama, misalnya <b>Kasir QRIS</b>.</li>
          <li>Ketuk <b>Simpan</b> (ikon centang). Kembali ke daftar makro, pastikan saklar di samping makro itu <b>menyala (hijau)</b>.</li>
        </Langkah>
      </Bagian>

      <Bagian no={6} judul="Uji coba">
        <h4 style={{ margin: '6px 0 2px' }}>A. Uji pengiriman</h4>
        <Langkah>
          <li>Buka makro Anda, ketuk aksi <b>Permintaan HTTP</b>, lalu cari tombol <b>Uji aksi</b> (Test Actions).</li>
          <li>Buka log: di layar utama MacroDroid ketuk menu <b>☰</b> (garis tiga), lalu pilih <b>Log sistem</b> atau <b>Catatan log sistem</b>.</li>
          <li>Cari baris <b>HTTP response code</b> dan cocokkan angkanya dengan tabel di bawah.</li>
        </Langkah>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', fontSize: '.78rem', borderCollapse: 'collapse' }}>
            <tbody>
              {[
                ['200', 'Berhasil terkirim.'],
                ['401', 'Token salah. Salin ulang token, atau buat token baru lalu isi ulang header.'],
                ['404', 'Alamat (URL) salah. Salin ulang alamat dari Bagian 5.'],
                ['500', 'Ada gangguan di server. Coba lagi nanti atau hubungi pengelola aplikasi.'],
                ['Gagal / failed', 'Internet HP bermasalah. Cek Wi-Fi atau paket data, lalu coba lagi.'],
              ].map(([k, v]) => (
                <tr key={k} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '6px 8px 6px 0', fontWeight: 800, whiteSpace: 'nowrap' }}>{k}</td>
                  <td style={{ padding: '6px 0' }}>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Tip>Pada uji aksi, kode <b>200</b> sudah berarti benar, walaupun belum ada pembayaran yang tercatat. Itu karena uji aksi tidak membawa isi notifikasi asli.</Tip>

        <h4 style={{ margin: '14px 0 2px' }}>B. Uji dengan pembayaran sungguhan</h4>
        <Langkah>
          <li>Di halaman <b>Kasir</b>, pastikan hari ini sudah menekan <b>MULAI BERJUALAN</b>.</li>
          <li>Minta teman atau gunakan HP lain untuk membayar <b>Rp1.000</b> ke QRIS GoPay Merchant Anda.</li>
          <li>Tunggu notifikasi pembayaran muncul di HP Anda.</li>
          <li>Dalam sekitar 20 detik, pembayaran itu muncul di <b>Transaksi terakhir</b> di halaman Kasir dan kotak “Status sambungan” di atas halaman ini berubah menjadi hijau.</li>
          <li>Hapus transaksi tes dengan menekan <b>Batalkan transaksi terakhir</b> di halaman Kasir, atau lewat halaman <b>Riwayat</b>.</li>
        </Langkah>
        <Tip warna="#dcfce7">Selesai. Mulai sekarang setiap pembayaran QRIS masuk akan tercatat otomatis. Pembayaran yang sama tidak akan tercatat dobel.</Tip>
      </Bagian>

      <div className="glass-card">
        <span className="label">Jika ada masalah</span>
        <Tanya q="Saya bayar, tapi tidak ada baris apa pun di log MacroDroid">
          Berarti MacroDroid tidak melihat notifikasinya. Cek ulang Bagian 3 (izin akses notifikasi dan baterai), pastikan saklar makro menyala, dan pastikan aplikasi GoPay Merchant memang memunculkan notifikasi di HP. Setelah mengubah izin, restart HP lalu coba lagi.
        </Tanya>
        <Tanya q="Log menunjukkan 200, tapi pembayaran tidak muncul di Kasir">
          Pertama, pastikan hari ini sudah menekan MULAI BERJUALAN. Kalau belum, pembayaran disimpan dulu dan masuk ke Kasir setelah hari dimulai (hanya untuk pembayaran di hari yang sama). Kedua, sistem hanya mengenali notifikasi yang memuat tulisan “Rp” dan kata seperti “diterima” atau “masuk”. Kalau notifikasi Anda berbeda, foto notifikasinya dan kirim ke pengelola aplikasi.
        </Tanya>
        <Tanya q="Log menunjukkan 401">
          Token atau nama header tidak cocok. Nama header harus persis <b>x-webhook-token</b>. Buat token baru di Bagian 4, salin, lalu isi ulang di header MacroDroid.
        </Tanya>
        <Tanya q="Kadang pembayaran terlewat">
          Hampir selalu karena HP mematikan MacroDroid saat layar mati. Ulangi pengaturan baterai dan Mulai otomatis di Bagian 3. Di beberapa HP, MacroDroid juga perlu dikunci di layar aplikasi terbaru (ketuk lama kartunya, pilih Kunci).
        </Tanya>
        <Tanya q="Saya ganti HP atau menghapus MacroDroid">
          Ulangi Bagian 2 sampai 5 di HP baru dan buat token baru. Token lama otomatis berhenti berlaku.
        </Tanya>
        <Tanya q="Bagaimana kalau token bocor?">
          Tekan BUAT ULANG TOKEN di Bagian 4. Token lama langsung tidak berlaku, lalu isi token baru di MacroDroid.
        </Tanya>
      </div>
      <BottomNav />
    </div>
  );
}
