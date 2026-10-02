import { describe, expect, it } from 'vitest';
import { BillingPeriod, isValidIsraeliId } from '../src/billing';

describe('isValidIsraeliId', () => {
  it('accepts numbers whose check digit is right, padding short ones', () => {
    expect(isValidIsraeliId('000000018')).toBe(true);
    expect(isValidIsraeliId('00018')).toBe(true);
    expect(isValidIsraeliId('123456782')).toBe(true); // 1+4+3+8+5+3+7+7+2 = 40
  });

  it('refuses a wrong check digit, letters and the wrong length', () => {
    expect(isValidIsraeliId('123456789')).toBe(false);
    expect(isValidIsraeliId('12345678a')).toBe(false);
    expect(isValidIsraeliId('1234')).toBe(false);
    expect(isValidIsraeliId('1234567890')).toBe(false);
  });
});

describe('BillingPeriod', () => {
  it('is a calendar month', () => {
    expect(BillingPeriod.safeParse('2026-09').success).toBe(true);
    expect(BillingPeriod.safeParse('2026-13').success).toBe(false);
  });
});
