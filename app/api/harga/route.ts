import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Hanya pengguna yang login boleh memakai kuota SerpApi
async function authorized(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace('Bearer ', '');
  if (!token) return false;
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data, error } = await sb.auth.getUser(token);
  return !error && !!data.user;
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) return NextResponse.json({ error: 'Belum login' }, { status: 401 });

  const q = req.nextUrl.searchParams.get('q')?.trim();
  if (!q || q.length < 3) return NextResponse.json({ error: 'Kata kunci minimal 3 karakter' }, { status: 400 });
  const key = process.env.SERPAPI_KEY;
  if (!key) return NextResponse.json({ error: 'SERPAPI_KEY belum diatur' }, { status: 500 });

  const url = new URL('https://serpapi.com/search.json');
  url.search = new URLSearchParams({
    engine: 'google_shopping', q, gl: 'id', hl: 'id', google_domain: 'google.co.id', api_key: key,
  }).toString();

  // Cache 1 jam per kata kunci agar kuota SerpApi hemat
  const r = await fetch(url, { next: { revalidate: 3600 } });
  if (!r.ok) return NextResponse.json({ error: `SerpApi error ${r.status}` }, { status: 502 });
  const data = await r.json();

  const items = (data.shopping_results ?? []).map((x: any) => ({
    judul: x.title as string,
    harga: (x.extracted_price ?? null) as number | null,
    toko: (x.source ?? '') as string,
    rating: (x.rating ?? null) as number | null,
    ulasan: (x.reviews ?? null) as number | null,
    link: (x.product_link ?? x.link ?? null) as string | null,
    gambar: (x.thumbnail ?? null) as string | null,
  }));
  return NextResponse.json({ items });
}
