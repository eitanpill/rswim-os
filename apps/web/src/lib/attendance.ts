import 'server-only';
import { getTranslations } from 'next-intl/server';
import { clockIL } from './scheduling';
import { dmy } from './options';

/** A session as one line: "בנות צפרדע · 5.10.2026 · 16:00". */
export function sessionWhen(s: { date: string; startsAt: Date | string }): string {
  return `${dmy(s.date)} · ${clockIL(s.startsAt)}`;
}

/** An instant as Israel date and time, "5.10.2026 16:00". */
export function dateTimeIL(d: Date | string): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date(d));
  return `${dmy(date)} ${clockIL(d)}`;
}

/** The decision of a processed absence notice as one sentence ("הודעה 13 שעות לפני… · נפתחה השלמה"). */
export async function noticeText() {
  const t = await getTranslations();
  const one = (e: { code: string; params?: Record<string, string | number> } | null | undefined) =>
    e ? (t.has(e.code) ? t(e.code, e.params ?? {}) : e.code) : '';
  return (decision: unknown) => {
    const d = decision as { notice?: { code: string }; credit?: { code: string } } | null;
    return [one(d?.notice), one(d?.credit)].filter(Boolean).join(' · ');
  };
}
