type Seg = { label: string; value: number; color: string };

export default function Donut({ data, center }: { data: Seg[]; center: string }) {
  const R = 70, C = 2 * Math.PI * R;
  const total = data.reduce((a, d) => a + d.value, 0);
  let acc = 0;
  return (
    <svg viewBox="0 0 200 200" style={{ width: '100%', maxWidth: 230, margin: '0 auto', display: 'block' }}>
      <circle cx="100" cy="100" r={R} fill="none" stroke="#f1f5f9" strokeWidth="22" />
      {total > 0 && data.map((d, i) => {
        const len = (d.value / total) * C;
        const el = (
          <circle key={i} cx="100" cy="100" r={R} fill="none" stroke={d.color} strokeWidth="22"
            strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 100 100)" />
        );
        acc += len;
        return el;
      })}
      <text x="100" y="100" textAnchor="middle" dominantBaseline="middle" fontWeight="800" fontSize="15" fill="#1e293b">{center}</text>
    </svg>
  );
}
