// Pure time-of-day helpers (no server imports, so tests and client code can use them).

/** The hour in Israel, 0–23. */
export function hourIL(now: Date = new Date()): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(now),
  );
}

export type DayPart = 'morning' | 'noon' | 'evening' | 'night';

export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'noon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'night';
}

/** The first word of a display name ("מיכל כהן (דמו)" → "מיכל"). */
export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? '';
}
