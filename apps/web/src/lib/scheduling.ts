import 'server-only';
import { getTranslations } from 'next-intl/server';

/** "16:00:00" → "16:00". */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '');

/** An instant as Israel wall-clock time, "16:00". */
export function clockIL(d: Date | string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(d));
}

/** Translates a rule issue or score reason the domain returned (`{ code, params }`). */
export async function issueText() {
  const t = await getTranslations();
  return (i: { code: string; params?: Record<string, string | number> }) =>
    t.has(i.code) ? t(i.code, i.params ?? {}) : i.code;
}

/** A child's age as the board shows it: "6" years, or "8 ח׳" months for babies. */
export async function ageText() {
  const t = await getTranslations('scheduling.age');
  return (months: number | null) =>
    months === null
      ? ''
      : months < 24
        ? t('months', { n: months })
        : t('years', { n: Math.floor(months / 12) });
}

/** Staff id → "first last". */
export function staffNames(staff: readonly { id: string; firstName: string; lastName: string }[]) {
  const m = new Map(staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
  return (id: string | null | undefined) => (id ? (m.get(id) ?? '') : '');
}
