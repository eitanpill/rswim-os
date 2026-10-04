import 'server-only';
import { getLocale, getTranslations } from 'next-intl/server';
import { agorot, formatILS } from '@rswim/money';

/** Explanation params that hold agorot; they are shown as shekels. */
const MONEY_PARAMS = new Set(['amount', 'from', 'to', 'rate']);

/** Agorot as the viewer's currency text ("‏330 ₪"). */
export async function money() {
  const locale = (await getLocale()) === 'en' ? 'en' : 'he';
  return (a: number) => formatILS(agorot(a), locale);
}

/** A billing month ("2026-09") as people write it: 09/2026. */
export function periodLabel(period: string | null | undefined): string {
  if (!period) return '';
  const [y, m] = period.split('-');
  return `${m}/${y}`;
}

/**
 * Translator for stored decisions ({ code, params }): money params become shekels and periods read as MM/YYYY.
 * Unknown codes show as-is rather than breaking the page.
 */
export async function explainer() {
  const t = await getTranslations();
  const fmt = await money();
  return (e: unknown): string => {
    const x = e as { code?: string; params?: Record<string, string | number> } | null;
    if (!x?.code) return '';
    const params = Object.fromEntries(
      Object.entries(x.params ?? {}).map(([k, v]) => [
        k,
        MONEY_PARAMS.has(k) && typeof v === 'number'
          ? fmt(v)
          : k === 'last' && typeof v === 'string'
            ? periodLabel(v)
            : v,
      ]),
    );
    return t.has(x.code) ? t(x.code, params) : x.code;
  };
}
