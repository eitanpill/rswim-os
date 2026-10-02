import { formatILS, type Agorot } from '@rswim/money';

/** Displays an amount stored in agorot. Wrapped in <bdi> so "₪" stays on the right side in RTL text. */
export function Money({ agorot, locale = 'he' }: { agorot: Agorot; locale?: 'he' | 'en' }) {
  return <bdi className="tabular-nums">{formatILS(agorot, locale)}</bdi>;
}
