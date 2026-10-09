import type { ReactNode } from 'react';

/** Line icons for the club (lucide-style, inline). */
function I({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const di = {
  bridge: (
    <I>
      <path d="M3 18c2 0 2-1.5 4.5-1.5S9.5 18 12 18s2.5-1.5 4.5-1.5S19 18 21 18" />
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
    </I>
  ),
  ops: (
    <I>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
      <path d="m9 15 2 2 4-4" />
    </I>
  ),
  desk: (
    <I>
      <path d="M4 10h16v10H4z" />
      <path d="M2 10h20M9 14h6" />
      <path d="M7 10V6a5 5 0 0 1 10 0v4" />
    </I>
  ),
  water: (
    <I>
      <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
      <path d="M9 15a3 3 0 0 0 3 3" />
    </I>
  ),
  me: (
    <I>
      <circle cx="12" cy="7" r="3.5" />
      <path d="M5 21v-1a7 7 0 0 1 14 0v1" />
    </I>
  ),
  divers: (
    <I>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <circle cx="17.5" cy="9.5" r="2.5" />
      <path d="M16 14.5a5 5 0 0 1 6 5.5" />
    </I>
  ),
  wind: (
    <I>
      <path d="M3 8h10a3 3 0 1 0-3-3" />
      <path d="M3 12h15a3 3 0 1 1-3 3" />
      <path d="M3 16h7" />
    </I>
  ),
  wave: (
    <I>
      <path d="M2 12c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
      <path d="M2 18c2.5 0 2.5-3 5-3s2.5 3 5 3 2.5-3 5-3 2.5 3 5 3" />
    </I>
  ),
  eye: (
    <I>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </I>
  ),
  temp: (
    <I>
      <path d="M14 14.8V4a2 2 0 0 0-4 0v10.8a4 4 0 1 0 4 0z" />
    </I>
  ),
  arrow: (
    <I>
      <path d="M12 3v18" />
      <path d="m6 15 6 6 6-6" />
    </I>
  ),
  shield: (
    <I>
      <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" />
      <path d="m9 12 2 2 4-4" />
    </I>
  ),
  alert: (
    <I>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </I>
  ),
  check: (
    <I size={16}>
      <path d="m5 12 5 5L20 7" />
    </I>
  ),
  x: (
    <I size={16}>
      <path d="M18 6 6 18M6 6l12 12" />
    </I>
  ),
  bang: (
    <I size={16}>
      <path d="M12 5v9M12 19h.01" />
    </I>
  ),
  coin: (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M15 9.5a3 3 0 0 0-3-1.5c-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2a3 3 0 0 1-3-1.5M12 6.5v11" />
    </I>
  ),
  gear: (
    <I>
      <path d="M4 20c3-1 5-4 6-9l1-6h2l1 6c1 5 3 8 6 9" />
      <path d="M8 20h8" />
    </I>
  ),
  anchor: (
    <I>
      <circle cx="12" cy="5" r="2" />
      <path d="M12 7v14M5 12H2a10 10 0 0 0 20 0h-3M8 11h8" />
    </I>
  ),
  calendar: (
    <I>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </I>
  ),
  phone: (
    <I size={16}>
      <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.8 2z" />
    </I>
  ),
  spark: (
    <I>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />
    </I>
  ),
  sun: (
    <I>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </I>
  ),
  globe: (
    <I>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </I>
  ),
  network: (
    <I>
      <circle cx="12" cy="5" r="2.5" />
      <circle cx="5" cy="19" r="2.5" />
      <circle cx="19" cy="19" r="2.5" />
      <path d="M12 7.5v4M12 11.5 6.5 17M12 11.5l5.5 5.5" />
    </I>
  ),
  out: (
    <I size={18}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
    </I>
  ),
};

/** The club's mark: a drop with depth rings. */
export function ClubMark({ size = 36 }: { size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="dm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(86% 0.09 195)" />
          <stop offset="1" stopColor="oklch(52% 0.12 230)" />
        </linearGradient>
      </defs>
      <path d="M20 3c6 8 12 14.5 12 21.5a12 12 0 0 1-24 0C8 17.5 14 11 20 3z" fill="url(#dm)" />
      <path
        d="M12 25c2.6 0 2.6-2 5.3-2s2.6 2 5.4 2 2.6-2 5.3-2"
        stroke="white"
        strokeWidth="1.6"
        fill="none"
        opacity=".85"
      />
      <path
        d="M14 30c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4"
        stroke="white"
        strokeWidth="1.4"
        fill="none"
        opacity=".55"
      />
    </svg>
  );
}
