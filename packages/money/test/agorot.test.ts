import { describe, expect, it } from 'vitest';
import {
  add,
  agorot,
  formatILS,
  negate,
  percentOf,
  ratioOf,
  shekels,
  subtract,
  ZERO,
} from '../src';

describe('agorot', () => {
  it('accepts safe integers only', () => {
    expect(agorot(33000)).toBe(33000);
    expect(() => agorot(1.5)).toThrow(RangeError);
    expect(() => agorot(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it('converts shekels without float drift', () => {
    expect(shekels(330)).toBe(33000);
    expect(shekels(0.1 + 0.2)).toBe(30);
  });

  it('adds, subtracts and negates', () => {
    expect(add()).toBe(ZERO);
    expect(add(agorot(100), agorot(250), agorot(-50))).toBe(300);
    expect(subtract(agorot(100), agorot(250))).toBe(-150);
    expect(negate(agorot(100))).toBe(-100);
  });
});

describe('percentOf', () => {
  it('computes the 10% sibling discount on ₪330', () => {
    expect(percentOf(shekels(330), 1000)).toBe(3300);
  });
  it('rounds half up to the agora, symmetric for negatives', () => {
    expect(percentOf(agorot(5), 1000)).toBe(1); // 0.5 → 1
    expect(percentOf(agorot(4), 1000)).toBe(0); // 0.4 → 0
    expect(percentOf(agorot(-5), 1000)).toBe(-1);
  });
  it('rejects fractional basis points', () => {
    expect(() => percentOf(agorot(100), 0.5)).toThrow(RangeError);
  });
});

describe('ratioOf', () => {
  it('prorates ₪330 for 3 of 4 sessions', () => {
    expect(ratioOf(shekels(330), 3, 4)).toBe(24750);
  });
  it('rounds half up', () => {
    expect(ratioOf(agorot(1), 1, 2)).toBe(1);
  });
  it('rejects a non-positive denominator', () => {
    expect(() => ratioOf(agorot(100), 1, 0)).toThrow(RangeError);
  });
});

describe('formatILS', () => {
  it('formats whole shekels without decimals', () => {
    expect(formatILS(shekels(330))).toMatch(/330/);
    expect(formatILS(shekels(330))).toContain('₪');
    expect(formatILS(shekels(330))).not.toMatch(/330[.,]00/);
  });
  it('keeps agorot when present', () => {
    expect(formatILS(agorot(24750), 'en')).toMatch(/247\.50/);
  });
});
