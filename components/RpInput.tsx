'use client';
export default function RpInput({ name, placeholder, label }: { name: string; placeholder?: string; label?: string }) {
  return (
    <input
      name={name} aria-label={label ?? 'Nominal (Rp)'} inputMode="numeric" placeholder={placeholder ?? 'Rp 0'} required
      onInput={(e) => {
        const el = e.currentTarget;
        const v = el.value.replace(/\D/g, '');
        el.value = v ? 'Rp ' + Number(v).toLocaleString('id-ID') : '';
      }}
    />
  );
}
