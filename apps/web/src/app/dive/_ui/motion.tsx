'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A number that counts up once when it first scrolls into view. The server renders the final text, so the page reads
 * right without JavaScript and for screen readers; only the digits move, the prefix and suffix ("₪", "%", "m") stay.
 */
export function CountUp({ value, ms = 900 }: { value: string | number; ms?: number }) {
  const text = String(value);
  const m = /^(.*?)(\d[\d,]*)(.*)$/s.exec(text);
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useEffect(() => {
    if (!m || !ref.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const [, pre, digits, post] = m as unknown as [string, string, string, string];
    const target = Number(digits.replaceAll(',', ''));
    if (!Number.isFinite(target) || target < 10) return;
    const grouped = digits.includes(',');
    const fmt = (n: number) => (grouped ? n.toLocaleString('en-US') : String(n));
    let raf = 0;
    const el = ref.current;
    const run = () => {
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        const eased = 1 - (1 - k) ** 3;
        setShown(`${pre}${fmt(Math.round(target * eased))}${post}`);
        if (k < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        run();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // The text is the only input: re-run only when it changes.
  }, [text]);
  return (
    <span ref={ref} aria-label={text}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
}

/**
 * A welcome card shown until the person closes it (remembered in this browser only). Closing is a convenience, never
 * state anyone else depends on, so blocked storage simply shows it again.
 */
export function Dismissible({
  id,
  closeLabel,
  children,
}: {
  id: string;
  closeLabel: string;
  children: ReactNode;
}) {
  const key = `dive.dismissed.${id}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(key) === '1') setOpen(false);
    } catch {
      /* storage blocked: keep it open */
    }
  }, [key]);
  if (!open) return null;
  const close = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(key, '1');
    } catch {
      /* storage blocked: closed for this visit only */
    }
  };
  return (
    <div className="relative" data-testid={`dismissible-${id}`}>
      {children}
      <button
        type="button"
        onClick={close}
        aria-label={closeLabel}
        title={closeLabel}
        className="absolute end-3 top-3 inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-[color-mix(in_oklch,var(--ink)_8%,transparent)] hover:text-ink"
      >
        <svg
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Minutes and seconds left on a seat held for payment, ticking down. The server renders the starting value; at zero
 * it shows `expired` (the page reloads on the next visit and the seat is offered to others).
 */
export function HoldCountdown({ until, expired }: { until: string; expired: string }) {
  const left = () => Math.max(0, Math.floor((new Date(until).getTime() - Date.now()) / 1000));
  const [sec, setSec] = useState(left);
  useEffect(() => {
    const id = window.setInterval(() => setSec(left()), 1000);
    return () => window.clearInterval(id);
    // `until` is the only input.
  }, [until]);
  if (sec <= 0) return <span>{expired}</span>;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const text =
    h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  return (
    <span dir="ltr" className="tabular-nums" suppressHydrationWarning>
      {text}
    </span>
  );
}
