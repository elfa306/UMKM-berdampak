-- CAVA migration v18: ubah inventaris menjadi katalog produk tanpa penghitungan stok.
-- Jalankan setelah migration_v17_cash_balance_flow.sql.
-- Riwayat transaksi, pembelian, mutasi, jurnal, dan batch lama tidak dihapus.
begin;

update public.products set lacak_stok=false,stok=0,stok_minimum=0,updated_at=now()
where jenis_item in ('merchandise','finished_good','service')
  and (lacak_stok is distinct from false or stok<>0 or stok_minimum<>0);

create or replace function public.update_inventory_catalog_product(
 p_product_id uuid,p_name text,p_sku text,p_category text,p_item_type text,p_unit text,p_sale_price numeric,p_unit_cost numeric
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid:=auth.uid();v_product public.products%rowtype;v_sku text;
begin
 if v_user is null then raise exception 'not_authenticated' using errcode='42501';end if;
 if p_name is null or char_length(btrim(p_name))<2 or char_length(btrim(p_name))>100 then raise exception 'invalid_product_name';end if;
 if p_item_type not in ('merchandise','finished_good','service') then raise exception 'invalid_catalog_product_type';end if;
 if p_sale_price is null or p_sale_price<=0 or p_sale_price>100000000000 or round(p_sale_price,0)<>p_sale_price
    or p_unit_cost is null or p_unit_cost<0 or p_unit_cost>100000000000 or round(p_unit_cost,0)<>p_unit_cost then raise exception 'invalid_product_price';end if;
 select * into v_product from public.products where id=p_product_id and user_id=v_user and aktif=true for update;
 if not found then raise exception 'product_not_found';end if;
 v_sku:=nullif(left(btrim(coalesce(p_sku,'')),32),'');
 update public.products set sku=v_sku,nama=btrim(p_name),
  kategori=left(coalesce(nullif(btrim(p_category),''),'Umum'),40),jenis_item=p_item_type,
  satuan=left(coalesce(nullif(btrim(p_unit),''),'pcs'),20),harga=round(p_sale_price,0),
  harga_pokok=round(p_unit_cost,2),lacak_stok=false,stok=0,stok_minimum=0,updated_at=now()
 where id=p_product_id and user_id=v_user returning * into v_product;
 return to_jsonb(v_product);
exception when unique_violation then raise exception 'duplicate_product_sku';
end;
$$;

revoke all on function public.update_inventory_catalog_product(uuid,text,text,text,text,text,numeric,numeric) from public,anon;
grant execute on function public.update_inventory_catalog_product(uuid,text,text,text,text,text,numeric,numeric) to authenticated;
commit;
