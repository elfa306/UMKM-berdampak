import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getOwnerContext, isSafeSameOrigin } from '@/lib/ownerApi.server';
import { verifyAssistantActionToken } from '@/lib/aiActions.server';
import type {
  ProductCreateAction, ProductDeleteAction, ProductUpdateAction,
  ProductionBatchCompleteAction, ProductionRecipeCreateAction, ProfileUpdateAction, AccountingEntryAction,
  TransactionDeleteAction, OpeningBalanceSetupAction, StartDailySessionAction, DailyModalSetAction,
} from '@/lib/aiProvider.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 25;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase('id-ID').replace(/\s+/g, ' ');
}
function rupiahLabel(value: number): string {
  return `Rp${new Intl.NumberFormat('id-ID').format(value)}`;
}

export async function POST(request: Request) {
  if (!isSafeSameOrigin(request)) {
    return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  }

  try {
    const ctx = await getOwnerContext(request);
    if (!ctx) return NextResponse.json({ error: 'Silakan masuk ke akun CAVA terlebih dahulu.' }, { status: 401 });

    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const proposal = verifyAssistantActionToken(body?.actionToken, ctx.user.id);
    if (!proposal) return NextResponse.json({ error: 'Izin tindakan tidak valid atau sudah kedaluwarsa. Ulangi perintahnya.' }, { status: 403 });

    // Persist the nonce before mutation: a confirmed action token can only be executed once.
    const { error: claimError } = await ctx.userClient.from('cava_action_nonces').insert({ user_id: ctx.user.id, nonce: proposal.nonce });
    if (claimError?.code === '23505') {
      return NextResponse.json({ error: 'Konfirmasi ini sudah pernah digunakan. Tidak ada tindakan ganda yang dijalankan.' }, { status: 409 });
    }
    if (claimError) throw new Error('Verifikasi sekali pakai gagal. Pastikan migration Cashie v19 sudah dijalankan.');

    const action = proposal.actions[0];
    if (action.type === 'transaction_delete') {
      const item = action as TransactionDeleteAction;
      const { data: existing, error: readError } = await ctx.userClient.from('transactions')
        .select('id,jenis,keterangan,jumlah,created_at,payment_source,product_id')
        .eq('id', item.transaction_id).eq('user_id', ctx.user.id).maybeSingle();
      if (readError) throw new Error('Transaksi belum dapat diverifikasi. Coba lagi.');
      if (!existing) return NextResponse.json({ error: 'Transaksi tidak ditemukan atau sudah tidak ada.' }, { status: 404 });
      const actualDate = new Date(existing.created_at).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      if (existing.jenis !== item.jenis || normalizeName(existing.keterangan ?? '') !== normalizeName(item.description) || Number(existing.jumlah) !== item.amount || actualDate !== item.date) {
        return NextResponse.json({ error: 'Rincian transaksi berubah sejak konfirmasi disiapkan. Ulangi perintah agar data terbaru digunakan.' }, { status: 409 });
      }
      if (existing.payment_source === 'qris_simulation') {
        const { data, error } = await ctx.userClient.rpc('cancel_qris_payment_simulation', { p_transaction_id: item.transaction_id });
        if (error) throw new Error('Pembatalan pembayaran QRIS simulasi gagal. Tidak ada tindakan lanjutan yang dilakukan.');
        const count = Number(data?.cancelled_count ?? 1);
        return NextResponse.json({ ok: true, message: `Pembayaran QRIS simulasi dibatalkan. ${count} catatan terkait diperbarui.` }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (existing.product_id && existing.payment_source === 'cashier') {
        const { error } = await ctx.userClient.rpc('cancel_inventory_sale', { p_transaction_id: item.transaction_id });
        if (error) throw new Error('Pembatalan penjualan kasir gagal. Stok tidak diubah.');
      } else {
        const { data, error } = await ctx.userClient.from('transactions').delete()
          .eq('id', item.transaction_id).eq('user_id', ctx.user.id).select('id').maybeSingle();
        if (error || !data) throw new Error('Transaksi gagal dihapus. Periksa kembali riwayat transaksi.');
      }
      return NextResponse.json({ ok: true, message: `Transaksi ${existing.keterangan} ${rupiahLabel(Number(existing.jumlah))} tanggal ${actualDate} berhasil dibatalkan.` }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'opening_balance_setup') {
      const item = action as OpeningBalanceSetupAction;
      const { data: existing, error: readError } = await ctx.userClient.from('business_opening_balances')
        .select('user_id').eq('user_id', ctx.user.id).maybeSingle();
      if (readError) throw new Error('Status saldo awal belum dapat diverifikasi.');
      if (existing) return NextResponse.json({ error: 'Saldo awal usaha sudah pernah ditetapkan dan tidak dapat diatur ulang melalui Cashie.' }, { status: 409 });
      const { error } = await ctx.userClient.rpc('set_business_opening_balances', {
        p_cash_amount: item.cash_amount,
        p_bank_amount: item.bank_amount,
      });
      if (error) throw new Error(error.message.includes('opening_balance_already_set') ? 'Saldo awal sudah ditetapkan.' : 'Saldo awal gagal disimpan. Pastikan migration v17 sudah dijalankan.');
      return NextResponse.json({ ok: true, message: `Saldo awal usaha tersimpan: kas ${rupiahLabel(item.cash_amount)} dan bank/QRIS ${rupiahLabel(item.bank_amount)}.` }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'daily_modal_set') {
      const item = action as DailyModalSetAction;
      const todayJakarta = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      if (item.date !== todayJakarta) {
        return NextResponse.json({ error: 'Tanggal modal harian sudah berubah. Ulangi perintah untuk tanggal hari ini.' }, { status: 409 });
      }
      if (!Number.isSafeInteger(item.amount) || item.amount < 0 || item.amount > 100_000_000_000) {
        return NextResponse.json({ error: 'Nominal modal harian tidak valid.' }, { status: 400 });
      }

      const { data: opening, error: openingError } = await ctx.userClient.from('business_opening_balances')
        .select('user_id').eq('user_id', ctx.user.id).maybeSingle();
      if (openingError) throw new Error('Saldo awal usaha belum dapat diverifikasi.');
      if (!opening) return NextResponse.json({ error: 'Saldo awal usaha belum ditetapkan. Lengkapi saldo awal dari Beranda terlebih dahulu.' }, { status: 409 });

      const { data, error } = await ctx.userClient.from('daily_sessions')
        .upsert({ user_id: ctx.user.id, tanggal: todayJakarta, modal_harian: item.amount }, { onConflict: 'user_id,tanggal' })
        .select('id,modal_harian').single();
      if (error || !data) throw new Error('Modal harian gagal disimpan. Periksa koneksi dan izin database CAVA.');

      return NextResponse.json({
        ok: true,
        message: `Modal harian ${rupiahLabel(Number(data.modal_harian))} berhasil disimpan untuk ${todayJakarta}. Saldo kas dan bank tidak berubah.`,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'start_daily_session') {
      const item = action as StartDailySessionAction;
      const todayJakarta = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
      if (item.date !== todayJakarta) return NextResponse.json({ error: 'Tanggal perintah sudah berubah. Ulangi permintaan untuk tanggal hari ini.' }, { status: 409 });
      if (!Number.isSafeInteger(item.modal_harian) || item.modal_harian < 0 || item.modal_harian > 100_000_000_000) {
        return NextResponse.json({ error: 'Nominal modal harian tidak valid. Sebutkan jumlahnya sebelum membuka aktivitas.' }, { status: 400 });
      }
      const { data: opening, error: openingError } = await ctx.userClient.from('business_opening_balances')
        .select('user_id').eq('user_id', ctx.user.id).maybeSingle();
      if (openingError) throw new Error('Saldo awal usaha belum dapat diverifikasi.');
      if (!opening) return NextResponse.json({ error: 'Saldo awal usaha belum ditetapkan. Sebutkan saldo kas dan bank/QRIS terlebih dahulu.' }, { status: 409 });
      const { data: current, error: currentError } = await ctx.userClient.from('daily_sessions')
        .select('id').eq('user_id', ctx.user.id).eq('tanggal', todayJakarta).maybeSingle();
      if (currentError) throw new Error('Status aktivitas harian belum dapat diperiksa.');
      if (current) return NextResponse.json({ ok: true, message: 'Aktivitas harian hari ini memang sudah terbuka.' }, { headers: { 'Cache-Control': 'no-store' } });
      const { data, error } = await ctx.userClient.from('daily_sessions')
        .insert({ user_id: ctx.user.id, tanggal: todayJakarta, modal_harian: item.modal_harian }).select('id').single();
      if (error?.code === '23505') return NextResponse.json({ ok: true, message: 'Aktivitas harian hari ini sudah terbuka.' }, { headers: { 'Cache-Control': 'no-store' } });
      if (error || !data) throw new Error('Aktivitas harian gagal dibuka. Pastikan migration v17 sudah dijalankan.');
      return NextResponse.json({ ok: true, message: `Aktivitas harian ${todayJakarta} berhasil dibuka dengan modal harian ${rupiahLabel(item.modal_harian)}.` }, { headers: { 'Cache-Control': 'no-store' } });
    }


    if (action.type === 'product_create') {
      const item = action as ProductCreateAction;
      const tracksStock = item.jenis_item === 'raw_material' || item.jenis_item === 'work_in_progress';
      const { data, error } = await ctx.userClient.rpc('create_inventory_product', {
        p_sku: item.sku,
        p_name: item.nama,
        p_category: item.kategori,
        p_item_type: item.jenis_item,
        p_unit: item.satuan,
        p_sale_price: item.harga,
        p_unit_cost: item.harga_pokok,
        p_stock: 0,
        p_min_stock: 0,
        p_track_stock: tracksStock,
      });
      if (error) throw new Error(error.message || 'Produk gagal ditambahkan.');
      const typeLabel = tracksStock ? (item.jenis_item === 'raw_material' ? 'bahan baku' : 'barang dalam proses') : 'produk';
      return NextResponse.json({ ok: true, message: `${typeLabel.charAt(0).toUpperCase()}${typeLabel.slice(1)} ${item.nama} berhasil ditambahkan ke katalog.`, product: data }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'product_update' || action.type === 'product_delete') {
      const productId = action.product_id;
      const productName = action.product_name;
      const { data: existing, error: readError } = await ctx.userClient.from('products')
        .select('id,nama,sku,kategori,jenis_item,satuan,harga,harga_pokok,aktif')
        .eq('id', productId).eq('user_id', ctx.user.id).eq('aktif', true).maybeSingle();
      if (readError) throw new Error('Produk belum dapat diverifikasi. Coba lagi.');
      if (!existing) return NextResponse.json({ error: 'Produk tidak ditemukan atau sudah tidak aktif. Tidak ada perubahan yang dilakukan.' }, { status: 404 });
      if (normalizeName(existing.nama) !== normalizeName(productName)) {
        return NextResponse.json({ error: 'Nama produk berubah sejak konfirmasi disiapkan. Ulangi perintah agar rincian diperbarui.' }, { status: 409 });
      }

      if (action.type === 'product_delete') {
        const { error } = await ctx.userClient.rpc('delete_inventory_product', { p_product_id: productId });
        if (error) throw new Error(error.message || 'Produk gagal dinonaktifkan.');
        return NextResponse.json({ ok: true, message: `${existing.nama} berhasil dinonaktifkan dari katalog aktif. Riwayat lama tetap tersimpan.` }, { headers: { 'Cache-Control': 'no-store' } });
      }

      if (!['merchandise', 'finished_good', 'service'].includes(existing.jenis_item)) {
        return NextResponse.json({ error: 'Cashie belum dapat mengubah data bahan baku/barang dalam proses. Tidak ada perubahan.' }, { status: 400 });
      }

      const updateItem = action as ProductUpdateAction;
      const changes = updateItem.changes;
      const name = changes.nama ?? existing.nama;
      const sku = changes.sku !== undefined ? changes.sku : existing.sku;
      const category = changes.kategori ?? existing.kategori ?? 'Umum';
      const itemType = changes.jenis_item ?? existing.jenis_item;
      const unit = changes.satuan ?? existing.satuan ?? 'pcs';
      const salePrice = changes.harga ?? Number(existing.harga ?? 0);
      const unitCost = changes.harga_pokok ?? Number(existing.harga_pokok ?? 0);
      if (!['merchandise', 'finished_good', 'service'].includes(itemType) || name.trim().length < 2 || !Number.isSafeInteger(salePrice) || salePrice <= 0 || !Number.isSafeInteger(unitCost) || unitCost < 0) {
        return NextResponse.json({ error: 'Rincian perubahan produk belum valid. Tidak ada data yang diubah.' }, { status: 400 });
      }
      const { data, error } = await ctx.userClient.rpc('update_inventory_catalog_product', {
        p_product_id: productId,
        p_name: name,
        p_sku: sku,
        p_category: category,
        p_item_type: itemType,
        p_unit: unit,
        p_sale_price: salePrice,
        p_unit_cost: unitCost,
      });
      if (error) throw new Error(error.message || 'Produk gagal diperbarui.');
      return NextResponse.json({ ok: true, message: `Produk ${existing.nama} berhasil diperbarui.`, product: data }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'production_recipe_create') {
      const item = action as ProductionRecipeCreateAction;
      if (!UUID.test(item.output_product_id) || item.items.length < 1 || item.items.length > 30) {
        return NextResponse.json({ error: 'Rincian resep tidak valid. Tidak ada perubahan.' }, { status: 400 });
      }
      const { data: output, error: outputError } = await ctx.userClient.from('products')
        .select('id,nama,jenis_item,aktif')
        .eq('id', item.output_product_id).eq('user_id', ctx.user.id).eq('aktif', true).maybeSingle();
      if (outputError) throw new Error('Produk hasil belum dapat diverifikasi.');
      if (!output || output.jenis_item !== 'finished_good' || normalizeName(output.nama) !== normalizeName(item.output_product_name)) {
        return NextResponse.json({ error: 'Produk hasil harus merupakan produk jadi aktif milik akun ini. Periksa kembali resep.' }, { status: 409 });
      }
      const inputIds = item.items.map((row) => row.product_id);
      if (new Set(inputIds).size !== inputIds.length || inputIds.some((id) => !UUID.test(id)) || inputIds.includes(item.output_product_id)) {
        return NextResponse.json({ error: 'Daftar bahan resep tidak valid atau mengandung duplikasi.' }, { status: 400 });
      }
      const { data: inputs, error: inputsError } = await ctx.userClient.from('products')
        .select('id,nama,jenis_item,satuan,lacak_stok,aktif')
        .eq('user_id', ctx.user.id).eq('aktif', true).in('id', inputIds);
      if (inputsError) throw new Error('Bahan resep belum dapat diverifikasi.');
      const inputMap = new Map((inputs ?? []).map((row) => [row.id, row]));
      for (const requested of item.items) {
        const product = inputMap.get(requested.product_id);
        if (!product || normalizeName(product.nama) !== normalizeName(requested.product_name) || !['raw_material', 'work_in_progress'].includes(product.jenis_item) || product.lacak_stok !== true) {
          return NextResponse.json({ error: `Bahan ${requested.product_name} tidak ditemukan sebagai bahan baku/barang dalam proses yang melacak stok. Tidak ada resep yang dibuat.` }, { status: 409 });
        }
      }
      const { data, error } = await ctx.userClient.rpc('create_production_recipe', {
        p_name: item.name,
        p_output_product_id: item.output_product_id,
        p_output_qty: item.output_qty,
        p_items: item.items.map((row) => ({ productId: row.product_id, qty: row.qty })),
        p_note: item.note,
      });
      if (error) {
        const message = error.message.includes('output_must_be_finished_good') ? 'Produk hasil harus bertipe produk jadi.' : error.message.includes('input_must_be_stocked_material') ? 'Bahan resep harus berupa bahan baku/barang dalam proses yang melacak stok.' : error.message.includes('recipe_name_or_item_already_exists') ? 'Nama resep atau bahan yang sama sudah digunakan.' : 'Resep gagal disimpan. Periksa kembali bahan dan produk hasil.';
        return NextResponse.json({ error: message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, message: `Resep ${item.name} berhasil dibuat.`, result: data }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'production_batch_complete') {
      const item = action as ProductionBatchCompleteAction;
      if (!UUID.test(item.recipe_id) || !Number.isFinite(item.batch_count) || item.batch_count <= 0 || item.batch_count > 10_000 || !Number.isFinite(item.labor_cost) || item.labor_cost < 0 || !Number.isFinite(item.overhead_cost) || item.overhead_cost < 0) {
        return NextResponse.json({ error: 'Jumlah batch atau biaya produksi tidak valid.' }, { status: 400 });
      }
      const { data: recipe, error: recipeError } = await ctx.userClient.from('production_recipes')
        .select('id,nama').eq('id', item.recipe_id).eq('user_id', ctx.user.id).eq('aktif', true).maybeSingle();
      if (recipeError) throw new Error('Resep produksi belum dapat diverifikasi.');
      if (!recipe || normalizeName(recipe.nama) !== normalizeName(item.recipe_name)) {
        return NextResponse.json({ error: 'Resep tidak ditemukan atau sudah berubah. Ulangi perintah agar detail terbaru digunakan.' }, { status: 409 });
      }
      const { data, error } = await ctx.userClient.rpc('complete_production_batch', {
        p_recipe_id: item.recipe_id,
        p_batch_count: item.batch_count,
        p_direct_labor_cost: item.labor_cost,
        p_overhead_cost: item.overhead_cost,
        p_idempotency_key: randomUUID(),
        p_note: item.note,
      });
      if (error) {
        const insufficient = error.message.match(/insufficient_raw_material:([^\n]+)/);
        const message = insufficient ? `Stok bahan baku ${insufficient[1]} tidak mencukupi. Produksi tidak dijalankan.` : error.message.includes('recipe_not_found') ? 'Resep produksi tidak ditemukan.' : error.message.includes('output_product_not_found') ? 'Produk hasil tidak ditemukan.' : 'Produksi gagal diselesaikan. Periksa stok bahan baku dan biaya produksi.';
        return NextResponse.json({ error: message }, { status: 409 });
      }
      return NextResponse.json({ ok: true, message: `Produksi ${item.batch_count} batch resep ${recipe.nama} berhasil diselesaikan.`, result: data }, { headers: { 'Cache-Control': 'no-store' } });
    }


    if (action.type === 'profile_update') {
      const item = action as ProfileUpdateAction;
      const changes = item.changes;
      if (!Object.keys(changes).length) return NextResponse.json({ error: 'Tidak ada perubahan profil yang valid.' }, { status: 400 });
      if (changes.tanggal_mulai_usaha) {
        const date = new Date(`${changes.tanggal_mulai_usaha}T00:00:00Z`);
        const today = new Date();
        const todayJakarta = today.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
        if (Number.isNaN(date.getTime()) || changes.tanggal_mulai_usaha > todayJakarta) {
          return NextResponse.json({ error: 'Tanggal mulai usaha tidak valid atau berada di masa depan.' }, { status: 400 });
        }
      }
      const { data: profile, error: profileReadError } = await ctx.userClient.from('business_profiles')
        .select('user_id').eq('user_id', ctx.user.id).maybeSingle();
      if (profileReadError) throw new Error('Profil usaha belum dapat diverifikasi.');
      if (!profile) return NextResponse.json({ error: 'Profil usaha belum tersimpan. Lengkapi dulu melalui halaman Profil Usaha.' }, { status: 404 });
      const { data, error } = await ctx.userClient.from('business_profiles')
        .update(changes).eq('user_id', ctx.user.id)
        .select('nama_usaha,jenis_usaha,bentuk_usaha,bidang_usaha,tanggal_mulai_usaha,hari_buka_per_bulan,kebutuhan_modal,memiliki_persediaan,metode_pembayaran')
        .single();
      if (error) throw new Error('Profil usaha gagal diperbarui. Periksa kembali isian profil.');
      return NextResponse.json({ ok: true, message: 'Profil usaha berhasil diperbarui.', profile: data }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (action.type === 'accounting_entry') {
      const item = action as AccountingEntryAction;
      const { data, error } = await ctx.userClient.rpc('create_accounting_manual_entry', {
        p_kind: item.kind,
        p_amount: item.amount,
        p_description: item.description,
        p_payment_account: item.payment_account,
      });
      if (error) throw new Error(error.message || 'Jurnal belum berhasil dicatat.');
      const labels: Record<AccountingEntryAction['kind'], string> = {
        capital: 'setoran modal', draw: 'pengambilan pribadi', supplier_payment: 'pembayaran pemasok',
        labor_payment: 'pembayaran tenaga kerja', overhead_payment: 'pembayaran overhead',
      };
      return NextResponse.json({ ok: true, message: `Jurnal ${labels[item.kind]} ${rupiahLabel(item.amount)} berhasil dicatat.`, result: data }, { headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ error: 'Jenis tindakan belum didukung.' }, { status: 400 });
  } catch (error) {
    console.error('Cashie execute action error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cashie belum dapat menjalankan tindakan.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}
