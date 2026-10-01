/**
 * Money is always an integer number of agorot (1 ILS = 100 agorot). Never a float.
 */
declare const AgorotBrand: unique symbol;
export type Agorot = number & { readonly [AgorotBrand]: true };

/** Basis points: 10000 bp = 100%. 1000 bp = 10%. */
export type BasisPoints = number;

export function agorot(value: number): Agorot {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Agorot must be a safe integer, got ${value}`);
  }
  return value as Agorot;
}

export function shekels(value: number): Agorot {
  return agorot(Math.round(value * 100));
}

export const ZERO = agorot(0);

export function add(...values: Agorot[]): Agorot {
  return agorot(values.reduce<number>((sum, v) => sum + v, 0));
}

export function subtract(a: Agorot, b: Agorot): Agorot {
  return agorot(a - b);
}

export function negate(a: Agorot): Agorot {
  return agorot(-a);
}

/** Rounds half away from zero, to the agora. */
function roundHalfUp(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/** amount × bp / 10000, rounded half-up to the agora (POLICIES "Rounding & money rules"). */
export function percentOf(amount: Agorot, bp: BasisPoints): Agorot {
  if (!Number.isInteger(bp)) throw new RangeError(`Basis points must be an integer, got ${bp}`);
  return agorot(roundHalfUp((amount * bp) / 10000));
}

/** amount × numerator / denominator, rounded half-up. Used for proration. */
export function ratioOf(amount: Agorot, numerator: number, denominator: number): Agorot {
  if (denominator <= 0) throw new RangeError('Denominator must be positive');
  return agorot(roundHalfUp((amount * numerator) / denominator));
}

/**
 * Formats agorot as ILS. Hebrew default: "‏330 ₪". Whole shekels drop the decimals.
 */
export function formatILS(amount: Agorot, locale: 'he' | 'en' = 'he'): string {
  const whole = amount % 100 === 0;
  return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-IL', {
    style: 'currency',
    currency: 'ILS',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}
