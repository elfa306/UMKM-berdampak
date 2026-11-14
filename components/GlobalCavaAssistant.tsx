'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import CavaVoiceAssistant from './CavaVoiceAssistant';
import QuickRecordModal from './QuickRecordModal';
import { announceTransactionSaved, OPEN_CATAT_EVENT } from '@/lib/quickSession';

type RecordMode = 'masuk' | 'keluar' | 'modal';
type PaymentMethod = 'tunai' | 'qris';

const ASSISTANT_PAGES = new Set([
  '/kasir', '/laporan', '/pembiayaan', '/harga', '/integrasi',
  '/lainnya', '/inventaris', '/kredit', '/rekomendasi', '/riwayat',
  '/statistik', '/pengaturan-usaha',
]);

export default function GlobalCavaAssistant() {
  const pathname = usePathname();
  const controlsVisible = ASSISTANT_PAGES.has(pathname);
  const [showCatatModal, setShowCatatModal] = useState(false);
  const [catatAwal, setCatatAwal] = useState<{ type: RecordMode; metode: PaymentMethod }>({
    type: 'masuk',
    metode: 'tunai',
  });

  useEffect(() => {
    const buka = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: RecordMode; metode?: PaymentMethod }>).detail ?? {};
      setCatatAwal({ type: detail.type ?? 'masuk', metode: detail.metode ?? 'tunai' });
      setShowCatatModal(true);
    };
    window.addEventListener(OPEN_CATAT_EVENT, buka);
    return () => window.removeEventListener(OPEN_CATAT_EVENT, buka);
  }, []);

  return (
    <>
      <CavaVoiceAssistant
        variant="global"
        controlsVisible={controlsVisible}
        onManualRecord={(mode) => {
          setCatatAwal({ type: mode ?? 'masuk', metode: 'tunai' });
          setShowCatatModal(true);
        }}
      />
      <QuickRecordModal
        isOpen={showCatatModal}
        onClose={() => setShowCatatModal(false)}
        initialType={catatAwal.type}
        initialMetode={catatAwal.metode}
        onSuccess={(detail) => announceTransactionSaved(detail)}
      />
    </>
  );
}
