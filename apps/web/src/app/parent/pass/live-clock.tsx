'use client';

import { useEffect, useState } from 'react';

/** Seconds ticking in Israel time with a moving bar: shows the pass is live, not a screenshot. */
export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const text = now
    ? new Intl.DateTimeFormat('he-IL', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).format(now)
    : '';
  return (
    <div className="mt-2" aria-hidden>
      <p className="font-mono text-3xl tabular-nums" dir="ltr">
        {text}
      </p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-50">
        <div
          className="h-full bg-brand-600 transition-[inline-size] duration-1000 ease-linear"
          style={{ inlineSize: `${now ? ((now.getSeconds() + 1) / 60) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}
