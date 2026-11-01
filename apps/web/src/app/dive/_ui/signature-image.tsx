import { SIGNATURE_PAD } from '@rswim/contracts';

/** A stored signature drawn back from its points (never from markup the browser sent). */
export function SignatureImage({ strokes, label }: { strokes: number[][][]; label: string }) {
  const safe = Array.isArray(strokes) ? strokes : [];
  return (
    <svg
      viewBox={`0 0 ${SIGNATURE_PAD.width} ${SIGNATURE_PAD.height}`}
      role="img"
      aria-label={label}
      className="aspect-[3/1] w-full max-w-sm rounded-lg border border-line bg-white"
      data-testid="signature-image"
    >
      {safe.map((s, i) => (
        <polyline
          key={i}
          fill="none"
          stroke="#0b2a4a"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          points={s
            .filter((p) => Array.isArray(p) && p.length === 2)
            .map(([x, y]) => `${Number(x)},${Number(y)}`)
            .join(' ')}
        />
      ))}
    </svg>
  );
}
