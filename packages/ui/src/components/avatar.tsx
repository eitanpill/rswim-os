import { cn } from '../cn';

const TINTS = [
  'bg-[oklch(90%_0.07_220)] text-[oklch(38%_0.1_230)]',
  'bg-[oklch(91%_0.08_160)] text-[oklch(38%_0.09_160)]',
  'bg-[oklch(92%_0.08_80)] text-[oklch(42%_0.1_60)]',
  'bg-[oklch(91%_0.07_25)] text-[oklch(42%_0.13_25)]',
  'bg-[oklch(91%_0.06_300)] text-[oklch(40%_0.12_300)]',
  'bg-[oklch(91%_0.06_195)] text-[oklch(38%_0.08_200)]',
];

function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** A round initial badge; the colour is stable per name, so each child or person keeps "their" colour. */
export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const initial = [...name.trim()][0] ?? '·';
  return (
    <span
      aria-hidden
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-full font-bold',
        TINTS[hash(name) % TINTS.length],
        size === 'sm' && 'size-8 text-sm',
        size === 'md' && 'size-10 text-base',
        size === 'lg' && 'size-14 text-xl',
        className,
      )}
    >
      {initial}
    </span>
  );
}
