import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentDemoSession, getDemoAdminClient, isSameOriginRequest } from '@/lib/demoSessions.server';
import { getDemoPOSSnapshot } from '@/lib/demoPos.server';
import { BelibayarQrPayloadUnavailableError, createDynamicQris, createStaticQris, isBelibayarSandboxConfigured } from '@/lib/belibayarSandbox.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });
    const snapshot = await getDemoPOSSnapshot(session.id);
    return NextResponse.json(snapshot, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Get demo POS error:', error);
    return NextResponse.json({ error: 'Katalog kasir demo gagal dimuat.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Permintaan tidak berasal dari aplikasi ini.' }, { status: 403 });
  }

  try {
    const session = await getCurrentDemoSession();
    if (!session) return NextResponse.json({ error: 'Sesi demonstrasi tidak ditemukan atau sudah kedaluwarsa.' }, { status: 401 });

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = await request.json();
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_body');
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Format pesanan tidak valid.' }, { status: 400 });
    }

    const paymentMethod = body.paymentMethod;
    const items = body.items;
    if (paymentMethod !== 'cash' && paymentMethod !== 'qris') {
      return NextResponse.json({ error: 'Pilih metode pembayaran yang tersedia.' }, { status: 400 });
    }
    if (paymentMethod === 'qris' && !isBelibayarSandboxConfigured()) {
      return NextResponse.json({ error: 'Belibayar Sandbox belum dikonfigurasi. Tambahkan API Key, Secret Key, dan Webhook Secret Sandbox pada environment server.' }, { status: 503 });
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > 30) {
      return NextResponse.json({ error: 'Keranjang harus berisi 1–30 jenis produk.' }, { status: 400 });
    }

    const seen = new Set<string>();
    const normalizedItems: Array<{ productId: string; qty: number }> = [];
    for (const item of items) {
      if (!item || typeof item !== 'object') return NextResponse.json({ error: 'Rincian produk tidak valid.' }, { status: 400 });
      const row = item as Record<string, unknown>;
      const productId = typeof row.productId === 'string' ? row.productId : '';
      const qty = Number(row.qty);
      if (!/^[0-9a-f-]{36}$/i.test(productId) || !Number.isFinite(qty) || qty <= 0 || qty > 1000 || Math.round(qty * 1000) !== qty * 1000) {
        return NextResponse.json({ error: 'Produk atau jumlah barang tidak valid.' }, { status: 400 });
      }
      if (seen.has(productId)) return NextResponse.json({ error: 'Produk yang sama tidak boleh dikirim berulang dalam satu keranjang.' }, { status: 400 });
      seen.add(productId);
      normalizedItems.push({ productId, qty });
    }

    const { data, error } = await getDemoAdminClient().rpc('create_demo_pos_order', {
      p_session_id: session.id,
      p_items: normalizedItems,
      p_payment_method: paymentMethod,
    });
    if (error) {
      console.error('Create demo POS order RPC error:', error.message);
      const message = error.message || '';
      if (message.includes('insufficient_stock')) return NextResponse.json({ error: 'Stok tidak mencukupi untuk salah satu produk. Perbarui keranjang dan coba lagi.' }, { status: 409 });
      if (message.includes('demo_session_expired')) return NextResponse.json({ error: 'Sesi demonstrasi sudah kedaluwarsa.' }, { status: 401 });
      if (message.includes('item_not_for_sale')) return NextResponse.json({ error: 'Bahan baku dan barang dalam proses tidak dapat dijual langsung.' }, { status: 400 });
      return NextResponse.json({ error: 'Pesanan gagal dibuat. Periksa stok dan data produk.' }, { status: 400 });
    }

    if (paymentMethod === 'qris') {
      const order = data.order as { id: string; invoice_no: string; total: number | string; metadata?: Record<string, unknown> };
      const total = Number(order.total);
      if (!Number.isSafeInteger(total) || total < 1) {
        await getDemoAdminClient().rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
        return NextResponse.json({ error: 'Nominal QRIS harus berupa bilangan bulat rupiah positif. Periksa harga dan jumlah produk.' }, { status: 400 });
      }

      // Gunakan reference eksternal yang kuat dan tidak bergantung pada nomor invoice pendek.
      // Keep the same compact 25-character format that was accepted by Belibayar Sandbox.
      const externalReference = `D${order.id.replace(/-/g, '').slice(0, 24).toUpperCase()}`;
      const admin = getDemoAdminClient();
      const { error: preparePaymentError } = await admin.from('demo_payments')
        .update({ provider: 'belibayar_sandbox', external_reference: externalReference })
        .eq('session_id', session.id).eq('order_id', order.id).eq('status', 'pending');
      if (preparePaymentError) {
        await admin.rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
        console.error('Prepare Belibayar demo payment failed:', preparePaymentError.message);
        return NextResponse.json({ error: 'Data pembayaran demo gagal disiapkan.' }, { status: 500 });
      }

      const { error: prepareOrderError } = await admin.from('demo_orders').update({
        payment_method: 'QRIS Dinamis (Belibayar Sandbox)',
        payment_source: 'belibayar_sandbox',
        metadata: { ...(order.metadata ?? {}), payment_provider: 'belibayar_sandbox', external_reference: externalReference },
      }).eq('id', order.id).eq('session_id', session.id);
      if (prepareOrderError) {
        await admin.rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
        console.error('Prepare Belibayar demo order failed:', prepareOrderError.message);
        return NextResponse.json({ error: 'Invoice gagal disiapkan untuk QRIS Sandbox.' }, { status: 500 });
      }

      try {
        const gateway = await createDynamicQris({
          reference: externalReference,
          amount: total,
          customerName: 'Pelanggan Demo',
        });
        const expiredAt = typeof gateway.expired_at === 'number'
          ? new Date(gateway.expired_at * 1000).toISOString()
          : null;
        const { error: savePaymentError } = await admin.from('demo_payments')
          .update({
            provider: 'belibayar_sandbox',
            external_reference: externalReference,
            external_transaction_id: gateway.transaction_id ?? null,
            amount: total,
            qr_content: gateway.qr_content ?? null,
            qr_url: gateway.qr_url ?? null,
            expires_at: expiredAt,
            merchant_fee: gateway.merchant_fee ?? null,
            net_credit: gateway.net_credit ?? null,
            fee_bearer: gateway.fee_bearer ?? null,
            raw_payload: gateway,
          })
          .eq('session_id', session.id).eq('order_id', order.id).eq('provider', 'belibayar_sandbox');
        if (savePaymentError) throw new Error(`QR terbentuk tetapi gagal disimpan: ${savePaymentError.message}`);

        return NextResponse.json({
          ok: true,
          ...data,
          order: { ...order, payment_method: 'QRIS Dinamis (Belibayar Sandbox)' },
          paymentGateway: {
            provider: 'belibayar_sandbox',
            reference: gateway.reference,
            transactionId: gateway.transaction_id ?? null,
            qrContent: gateway.qr_content ?? null,
            qrUrl: gateway.qr_url ?? null,
            expiredAt,
          },
        }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
      } catch (gatewayError) {
        if (gatewayError instanceof BelibayarQrPayloadUnavailableError) {
          // Belibayar has acknowledged a pending dynamic transaction, so keep
          // its reference intact. The static QR below is display-only fallback:
          // it must never be written into demo_payments or treated as this invoice's QR.
          const gateway = gatewayError.gateway;
          const expiredAt = typeof gateway.expired_at === 'number'
            ? new Date(gateway.expired_at * 1000).toISOString()
            : null;
          const { error: savePendingError } = await admin.from('demo_payments')
            .update({
              provider: 'belibayar_sandbox',
              external_reference: externalReference,
              external_transaction_id: gateway.transaction_id ?? null,
              amount: total,
              qr_content: gateway.qr_content ?? null,
              qr_url: gateway.qr_url ?? null,
              expires_at: expiredAt,
              merchant_fee: gateway.merchant_fee ?? null,
              net_credit: gateway.net_credit ?? null,
              fee_bearer: gateway.fee_bearer ?? null,
              raw_payload: { ...gateway, qr_payload_missing: true, diagnostic: gatewayError.diagnostic },
            })
            .eq('session_id', session.id).eq('order_id', order.id).eq('provider', 'belibayar_sandbox');
          if (savePendingError) {
            console.error('Save pending Belibayar response failed:', savePendingError.message);
          }

          // Reuse the exact session-level static QR already shown in the static
          // QR panel. Create it once only when this demo session has none.
          let staticFallback: { merchant_reference: string; qr_content: string } | null = null;
          try {
            const { data: existingStatic, error: existingStaticError } = await admin
              .from('demo_static_qris')
              .select('merchant_reference,qr_content,status')
              .eq('session_id', session.id)
              .maybeSingle();
            if (existingStaticError) throw existingStaticError;

            if (existingStatic?.status === 'active' && typeof existingStatic.qr_content === 'string' && existingStatic.qr_content.trim()) {
              staticFallback = {
                merchant_reference: existingStatic.merchant_reference,
                qr_content: existingStatic.qr_content,
              };
            } else {
              const merchantReference = `DEMOQR_${session.id.replace(/-/g, '')}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
              const label = `${session.business_name} - Demo`.slice(0, 100);
              const createdStatic = await createStaticQris({ reference: merchantReference, label });
              const { data: savedStatic, error: saveStaticError } = await admin
                .from('demo_static_qris')
                .upsert({
                  session_id: session.id,
                  provider_reference: createdStatic.reference,
                  merchant_reference: merchantReference,
                  label,
                  qr_content: createdStatic.qr_content,
                  status: createdStatic.status,
                  raw_payload: createdStatic,
                }, { onConflict: 'session_id' })
                .select('merchant_reference,qr_content,status')
                .single();
              if (saveStaticError || !savedStatic) {
                throw new Error(`QRIS statis berhasil dibuat tetapi gagal disimpan: ${saveStaticError?.message ?? 'data kosong'}`);
              }
              if (savedStatic.status === 'active' && savedStatic.qr_content) {
                staticFallback = {
                  merchant_reference: savedStatic.merchant_reference,
                  qr_content: savedStatic.qr_content,
                };
              }
            }
          } catch (staticFallbackError) {
            console.error(
              'Could not prepare static QRIS display fallback:',
              staticFallbackError instanceof Error ? staticFallbackError.message : staticFallbackError,
            );
          }

          const { error: annotateOrderError } = await admin.from('demo_orders').update({
            metadata: {
              ...(order.metadata ?? {}),
              payment_provider: 'belibayar_sandbox',
              external_reference: externalReference,
              qr_payload_missing: true,
              qr_fallback_static: Boolean(staticFallback),
              static_qris_fallback_reference: staticFallback?.merchant_reference ?? null,
            },
          }).eq('id', order.id).eq('session_id', session.id);
          if (annotateOrderError) console.error('Annotate pending Belibayar order failed:', annotateOrderError.message);

          console.error('Belibayar charge acknowledged but QR payload is missing:', JSON.stringify(gatewayError.diagnostic));
          return NextResponse.json({
            ok: true,
            warning: staticFallback
              ? 'QRIS dinamis Belibayar belum tersedia. QRIS statis sesi ditampilkan sebagai fallback demo saja; QR tersebut tidak tertaut ke invoice ini dan tidak dapat melunasinya. Invoice tetap pending sampai webhook transaksi dinamis terverifikasi.'
              : 'Belibayar menerima transaksi, tetapi data QR dinamis belum tersedia dan QRIS statis fallback juga gagal dimuat. Invoice tetap pending; jangan lakukan pembayaran sungguhan.',
            ...data,
            order: { ...order, payment_method: 'QRIS Dinamis (Belibayar Sandbox)' },
            paymentGateway: {
              provider: 'belibayar_sandbox',
              reference: gateway.reference,
              transactionId: gateway.transaction_id ?? null,
              // This QR is intentionally returned only to the UI. The payment
              // row keeps the true (empty) dynamic QR fields for webhook matching.
              qrContent: staticFallback?.qr_content ?? gateway.qr_content ?? null,
              qrUrl: staticFallback ? null : gateway.qr_url ?? null,
              expiredAt,
              qrPayloadMissing: true,
              qrFallback: Boolean(staticFallback),
            },
          }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
        }

        const message = gatewayError instanceof Error ? gatewayError.message : 'QRIS Sandbox gagal dibuat.';
        await admin.rpc('settle_demo_pos_order', { p_session_id: session.id, p_order_id: order.id, p_action: 'cancel' });
        console.error('Create Belibayar dynamic QRIS failed:', message);
        return NextResponse.json({ error: message }, { status: 502 });
      }
    }

    return NextResponse.json({ ok: true, ...data }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Create demo POS order error:', error);
    return NextResponse.json({ error: 'Terjadi kesalahan saat membuat pesanan demo.' }, { status: 500 });
  }
}
