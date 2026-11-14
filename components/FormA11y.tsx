'use client';

import { useEffect } from 'react';

/**
 * Menyelaraskan aria-invalid dengan status visual :user-invalid di seluruh aplikasi.
 *
 * - aria-invalid="false" sampai :user-invalid cocok, sehingga pembaca layar tidak
 *   mengumumkan "entri tidak valid" sebelum pengguna berinteraksi.
 * - Bila field punya data-error="<id elemen pesan>", pesan itu masuk aria-describedby
 *   hanya saat field tidak valid. Tanpa data-error, pesan validasi bawaan browser dipakai.
 * - Satu live region sopan (aria-live="polite") mengumumkan error saat pengguna
 *   meninggalkan atau mengubah field. Setelah submit gagal, browser memindahkan fokus
 *   ke field pertama yang tidak valid, sehingga error-nya terbaca lewat fokus.
 */

const FIELD_SELECTOR = 'input, select, textarea';
const SKIPPED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

function isField(node: unknown): node is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (!(node instanceof HTMLElement) || !node.matches(FIELD_SELECTOR)) return false;
  return !(node instanceof HTMLInputElement && SKIPPED_TYPES.has(node.type));
}

export default function FormA11y() {
  useEffect(() => {
    // :user-invalid belum ada di browser lama; tanpa itu tidak ada yang disinkronkan.
    if (!CSS.supports('selector(:user-invalid)')) return;

    const announcer = document.createElement('div');
    announcer.setAttribute('aria-live', 'polite');
    announcer.className = 'visually-hidden';
    document.body.append(announcer);

    let announceTimer: ReturnType<typeof setTimeout> | undefined;
    let announcedField: Element | null = null;
    const flagged = new WeakSet<Element>();
    const announced = new WeakSet<Element>();

    const linkError = (el: HTMLElement, shown: boolean) => {
      const errorId = el.dataset.error;
      if (!errorId) return;
      const ids = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (shown) ids.push(errorId);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
      else el.removeAttribute('aria-describedby');
    };

    const spokenText = (node: Element) => {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
      return (copy.textContent || '').replace(/\s+/g, ' ').trim();
    };

    const announceError = (el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) => {
      const errorEl = el.dataset.error ? document.getElementById(el.dataset.error) : null;
      const message = errorEl ? spokenText(errorEl) : el.validationMessage;
      if (!message) return;
      const labelEl = el.labels?.[0];
      const label = labelEl ? `${spokenText(labelEl)}: ` : el.getAttribute('aria-label') ? `${el.getAttribute('aria-label')}: ` : '';
      clearTimeout(announceTimer);
      announcer.textContent = '';
      announcedField = el;
      // Tunggu sampai pembaca layar selesai membacakan field berikutnya yang menerima fokus.
      announceTimer = setTimeout(() => {
        announcer.textContent = label + message;
      }, 500);
    };

    const syncAria = (el: Element, announce = false) => {
      if (!isField(el)) return;
      const invalid = el.matches(':user-invalid');
      if (invalid) {
        if (announce && !announced.has(el)) {
          announceError(el);
          announced.add(el);
        }
        el.setAttribute('aria-invalid', 'true');
        linkError(el, true);
        flagged.add(el);
      } else if (flagged.has(el) || el.getAttribute('aria-invalid') !== 'true') {
        // aria-invalid="true" yang bukan dari skrip ini (mis. dari pengecekan server) dibiarkan.
        el.setAttribute('aria-invalid', 'false');
        linkError(el, false);
        flagged.delete(el);
        announced.delete(el);
        if (announcedField === el) {
          clearTimeout(announceTimer);
          announcer.textContent = '';
        }
      }
    };

    const initTree = (root: ParentNode) => {
      root.querySelectorAll(FIELD_SELECTOR).forEach((el) => syncAria(el));
    };

    const onBlur = (e: Event) => syncAria(e.target as Element, true);
    const onChange = (e: Event) => syncAria(e.target as Element, true);
    const onInput = (e: Event) => {
      const el = e.target as Element;
      if (el.hasAttribute('aria-invalid')) syncAria(el);
    };
    // Submit gagal memicu 'invalid' pada setiap field yang gagal, termasuk yang belum disentuh.
    // Fokus yang pindah ke field pertama sudah mengumumkan error-nya, jadi tidak diumumkan lagi.
    const onInvalid = (e: Event) => {
      announced.add(e.target as Element);
      syncAria(e.target as Element);
    };
    // Reset menghapus :user-invalid setelah event 'reset', jadi sinkronkan sesudahnya.
    const onReset = (e: Event) => {
      const form = e.target as HTMLFormElement;
      setTimeout(() => Array.from(form.elements).forEach((el) => syncAria(el)));
    };

    document.addEventListener('blur', onBlur, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('input', onInput);
    document.addEventListener('invalid', onInvalid, true);
    document.addEventListener('reset', onReset, true);

    initTree(document);
    // Field yang muncul belakangan (halaman berpindah, dialog dibuka) mulai dari aria-invalid="false".
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return;
          if (isField(node)) syncAria(node);
          initTree(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.removeEventListener('blur', onBlur, true);
      document.removeEventListener('change', onChange, true);
      document.removeEventListener('input', onInput);
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('reset', onReset, true);
      clearTimeout(announceTimer);
      announcer.remove();
    };
  }, []);

  return null;
}
