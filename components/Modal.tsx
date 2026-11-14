'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';

type ModalProps = {
  /** Dipanggil saat pengguna menutup dialog (Escape, klik di luar, atau tombol tutup bawaan browser). */
  onClose: () => void;
  /** id elemen judul di dalam dialog (aria-labelledby). */
  labelledBy?: string;
  /** Label teks bila tidak ada judul yang terlihat. */
  label?: string;
  /** id elemen deskripsi (aria-describedby). */
  describedBy?: string;
  /** "center": di tengah layar. "sheet": menempel di bawah pada layar sempit, di tengah pada layar lebar. */
  variant?: 'center' | 'sheet';
  /** Klik di luar dialog menutupnya. Matikan untuk formulir yang sedang diisi. */
  lightDismiss?: boolean;
  /** Kelas Tailwind untuk panel (lebar maksimum, warna, sudut, padding). */
  className?: string;
  children: ReactNode;
};

/**
 * Dialog modal memakai elemen <dialog> native + showModal().
 * Browser yang mengurus: fokus terkunci di dalam dialog, halaman di belakang inert,
 * tombol Escape, dan pengembalian fokus ke tombol pemicu saat dialog ditutup.
 *
 * Pasang secara kondisional oleh pemanggil: {terbuka && <Modal onClose={...}>...</Modal>}.
 * Elemen di dalam dialog dengan atribut data-autofocus menerima fokus awal
 * (untuk konfirmasi destruktif, pasang pada tombol aman "Batal").
 */
export default function Modal({
  onClose,
  labelledBy,
  label,
  describedBy,
  variant = 'center',
  lightDismiss = false,
  className = '',
  children,
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);

  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const requestClose = () => onCloseRef.current();
    // Escape: serahkan keputusan menutup ke pemanggil (state React), bukan ke browser.
    const handleCancel = (event: Event) => {
      event.preventDefault();
      requestClose();
    };
    // Dialog tertutup oleh browser (mis. Escape berulang tanpa interaksi): selaraskan state pemanggil.
    // Event "close" dikirim asinkron; bila dialog sudah dibuka lagi (mis. efek dijalankan ulang
    // oleh React StrictMode), event lama itu diabaikan.
    const handleClose = () => {
      if (dialog.open) return;
      requestClose();
    };

    dialog.addEventListener('cancel', handleCancel);
    dialog.addEventListener('close', handleClose);
    if (!dialog.open) dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();

    // Cadangan untuk browser tanpa atribut closedby (mis. Safari): klik di luar panel menutup dialog.
    let removeFallback = () => {};
    if (lightDismiss && !('closedBy' in HTMLDialogElement.prototype)) {
      let pressedOutside = false;
      const isOutside = (event: PointerEvent) => {
        if (event.target !== dialog) return false;
        const rect = dialog.getBoundingClientRect();
        return (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        );
      };
      const handleDown = (event: PointerEvent) => {
        pressedOutside = isOutside(event);
      };
      const handleUp = (event: PointerEvent) => {
        if (pressedOutside && isOutside(event)) requestClose();
        pressedOutside = false;
      };
      dialog.addEventListener('pointerdown', handleDown);
      dialog.addEventListener('pointerup', handleUp);
      removeFallback = () => {
        dialog.removeEventListener('pointerdown', handleDown);
        dialog.removeEventListener('pointerup', handleUp);
      };
    }

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      dialog.removeEventListener('close', handleClose);
      removeFallback();
      // Menutup lewat API mengembalikan fokus ke elemen yang memicu dialog.
      if (dialog.open) dialog.close();
    };
  }, [lightDismiss]);

  // closedby belum ada di tipe JSX React; atribut diteruskan apa adanya ke DOM.
  const closedByProps = { closedby: lightDismiss ? 'any' : 'closerequest' } as Record<string, string>;

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      aria-describedby={describedBy}
      className={`modal-dialog ${variant === 'sheet' ? 'modal-sheet' : ''} ${className}`}
      {...closedByProps}
    >
      {children}
    </dialog>
  );
}
