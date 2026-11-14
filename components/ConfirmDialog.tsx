'use client';

import { useCallback, useId, useState, type ReactNode } from 'react';
import Modal from './Modal';

export type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" mewarnai tombol konfirmasi merah untuk aksi yang menghapus data. */
  tone?: 'default' | 'danger';
};

type ConfirmDialogProps = {
  options: ConfirmOptions;
  onResult: (confirmed: boolean) => void;
};

export function ConfirmDialog({ options, onResult }: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const danger = options.tone === 'danger';

  return (
    <Modal
      onClose={() => onResult(false)}
      labelledBy={titleId}
      describedBy={messageId}
      lightDismiss
      className="max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
    >
      <h2 id={titleId} className="text-base font-extrabold tracking-tight text-[#103A57]">
        {options.title ?? 'Konfirmasi'}
      </h2>
      <p id={messageId} className="mt-2 text-sm font-semibold leading-relaxed text-[#4F6B7C]">
        {options.message}
      </p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {/* Fokus awal pada tombol yang aman (Batal), bukan pada aksi yang tidak bisa dibatalkan. */}
        <button
          type="button"
          data-autofocus
          onClick={() => onResult(false)}
          className="min-h-[44px] rounded-2xl bg-[#E3F0EA] px-4 text-sm font-extrabold text-[#103A57] transition hover:bg-[#CEE5D6]"
        >
          {options.cancelLabel ?? 'Batal'}
        </button>
        <button
          type="button"
          onClick={() => onResult(true)}
          className={`min-h-[44px] rounded-2xl px-4 text-sm font-extrabold text-white transition ${
            danger ? 'bg-[#991B1B] hover:bg-[#991B1B]/90' : 'bg-[#103A57] hover:bg-[#103A57]/90'
          }`}
        >
          {options.confirmLabel ?? 'Lanjutkan'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Pengganti window.confirm().
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ message: '...', tone: 'danger' }))) return;
 *   ...
 *   return (<>{...}{confirmDialog}</>);
 */
export function useConfirm(): {
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  confirmDialog: ReactNode;
} {
  const [pending, setPending] = useState<{
    options: ConfirmOptions;
    resolve: (confirmed: boolean) => void;
  } | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions | string) =>
      new Promise<boolean>((resolve) => {
        setPending({ options: typeof options === 'string' ? { message: options } : options, resolve });
      }),
    [],
  );

  const settle = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };

  return {
    confirm,
    confirmDialog: pending ? <ConfirmDialog options={pending.options} onResult={settle} /> : null,
  };
}
