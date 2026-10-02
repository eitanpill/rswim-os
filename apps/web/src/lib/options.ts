import 'server-only';
import { getTranslations } from 'next-intl/server';

/** Select/checkbox options for an enum, labelled from `enums.<name>.<value>`. */
export async function enumOptions(name: string, values: readonly string[]) {
  const t = await getTranslations('enums');
  return values.map((value) => ({ value, label: t(`${name}.${value}`) }));
}

/** Translator for enum labels in lists and badges. */
export async function enumLabel() {
  const t = await getTranslations('enums');
  return (name: string, value: string) => t(`${name}.${value}`);
}

export async function weekdayOptions() {
  const t = await getTranslations('common.weekday');
  return [0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: String(d), label: t(String(d)) }));
}

/** Today's date in Israel, as the database's app.today() sees it. */
export function todayIL(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
}

/** Agorot → the plain number a shekel input shows ("330" or "330.50"). */
export function shekelValue(agorot: number | null | undefined): string {
  if (agorot === null || agorot === undefined) return '';
  return agorot % 100 === 0 ? String(agorot / 100) : (agorot / 100).toFixed(2);
}

/** A local date ("2026-09-01") as Israelis write it: 1.9.2026. */
export function dmy(date: string | null | undefined): string {
  if (!date) return '';
  const [y, m, d] = date.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}
