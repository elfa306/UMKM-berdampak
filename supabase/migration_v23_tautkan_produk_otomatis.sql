-- Migration v23: biaya bahan otomatis terhubung ke produk katalog saat dicatat.
-- Setiap jalur pencatatan (form manual, Cashie, atau lainnya) cukup mengirim produk_terkait (nama) atau produk_terkait_id.
-- Trigger mengisi produk_terkait_id dari nama bila cocok dengan tepat satu produk milik pengguna yang sama,
-- dan menyamakan teks produk_terkait dengan nama produk di katalog.
-- Prasyarat: migration v21 dan v22. Aman dijalankan ulang. Jalankan di Supabase Dashboard -> SQL Editor.

create or replace function public.transactions_link_related_product()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_product_id uuid;
  v_nama text;
begin
  -- Hanya biaya bahan produksi yang boleh terkait produk.
  if new.jenis <> 'biaya' or new.kategori_biaya is distinct from 'bahan_produksi' then
    new.produk_terkait_id := null;
    new.produk_terkait := null;
    return new;
  end if;

  if new.produk_terkait_id is not null then
    -- Relasi harus ke produk milik pengguna yang sama; selain itu dilepas.
    select nama into v_nama from public.products where id = new.produk_terkait_id and user_id = new.user_id;
    if v_nama is null then
      new.produk_terkait_id := null;
    else
      new.produk_terkait := left(v_nama, 100);
    end if;
  end if;

  if new.produk_terkait_id is null and nullif(btrim(coalesce(new.produk_terkait, '')), '') is not null then
    v_product_id := public.resolve_product_by_name(new.user_id, new.produk_terkait);
    if v_product_id is not null then
      select nama into v_nama from public.products where id = v_product_id;
      new.produk_terkait_id := v_product_id;
      new.produk_terkait := left(v_nama, 100);
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.transactions_link_related_product() from public, anon, authenticated;

drop trigger if exists transactions_link_related_product on public.transactions;
create trigger transactions_link_related_product
  before insert or update of jenis, kategori_biaya, produk_terkait, produk_terkait_id on public.transactions
  for each row execute function public.transactions_link_related_product();
