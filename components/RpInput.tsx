'use client';
export default function RpInput({ name, placeholder }: { name: string; placeholder?: string }) {
  return (
    <input
      name={name} inputMode="numeric" placeholder={placeholder ?? 'Rp 0'} required
      onInput={(e) => {
        const el = e.currentTarget;
        const v = el.value.replace(/\D/g, '');
        el.value = v ? 'Rp ' + Number(v).toLocaleString('id-ID') : '';
      }}
    />
  );
}
