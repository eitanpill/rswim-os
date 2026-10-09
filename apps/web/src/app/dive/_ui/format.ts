/** Formatting for the club screens: shekels, Israel times and dates, depth and time underwater. */

const TZ = 'Asia/Jerusalem';

export function shekels(agorot: number, locale: string, opts: { compact?: boolean } = {}): string {
  const v = agorot / 100;
  return new Intl.NumberFormat(locale === 'en' ? 'en-IL' : 'he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
    notation: opts.compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard',
  }).format(v);
}

export function hhmm(ts: string | Date): string {
  return new Date(ts).toLocaleTimeString('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** "ו׳ 10.10" / "Fri 10.10" for a YYYY-MM-DD day. */
export function dayLabel(date: string, locale: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.toLocaleDateString(locale === 'en' ? 'en-GB' : 'he-IL', {
    weekday: 'short',
    timeZone: 'UTC',
  });
  return `${wd} ${d.getUTCDate()}.${d.getUTCMonth() + 1}`;
}

export function dateShort(date: string | Date): string {
  const d =
    typeof date === 'string' && date.length === 10 ? new Date(`${date}T12:00:00Z`) : new Date(date);
  return d
    .toLocaleDateString('en-GB', {
      timeZone: typeof date === 'string' && date.length === 10 ? 'UTC' : TZ,
      day: 'numeric',
      month: 'numeric',
      year: '2-digit',
    })
    .replaceAll('/', '.');
}

export function localDay(ts: string | Date): string {
  return new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });
}

export function mmss(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');
}

/** A stable soft hue for a person's avatar. */
export function hueFor(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function pctChange(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}
