-- Hapus produk (soft delete) untuk pemilik akun.
-- Produk tidak dihapus fisik karena riwayat transaksi, mutasi stok, dan resep masih mengacu padanya
-- (foreign key bersifat restrict). Produk dinonaktifkan: hilang dari Kasir, Inventaris, dan Cek Harga,
-- sedangkan riwayat lama tetap utuh. SKU dikosongkan agar bisa dipakai lagi oleh produk baru.
create or replace function public.delete_inventory_product(p_product_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_product public.products%rowtype;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode='42501'; end if;

  select * into v_product
    from public.products
    where id = p_product_id and user_id = v_user and aktif = true
    for update;
  if not found then raise exception 'product_not_found'; end if;

  update public.products
    set aktif = false, sku = null, updated_at = now()
    where id = p_product_id and user_id = v_user
    returning * into v_product;

  return jsonb_build_object('id', v_product.id, 'nama', v_product.nama, 'aktif', v_product.aktif);
end;
$$;

revoke all on function public.delete_inventory_product(uuid) from public, anon;
grant execute on function public.delete_inventory_product(uuid) to authenticated;
