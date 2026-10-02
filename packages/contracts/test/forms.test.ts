import { describe, expect, it } from 'vitest';
import {
  checkbox,
  optionalDate,
  optionalEmail,
  optionalInt,
  optionalPhone,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
} from '../src';

const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

describe('form helpers', () => {
  it('requiredText trims and requires', () => {
    expect(requiredText().parse('  שלום ')).toBe('שלום');
    expect(issues(requiredText().safeParse('  '))).toEqual(['forms.errors.required']);
    expect(issues(requiredText(3).safeParse('abcd'))).toEqual(['forms.errors.tooLong']);
    expect(issues(requiredText().safeParse(undefined))).toEqual(['forms.errors.required']);
  });
  it('optionalText maps blank to null', () => {
    expect(optionalText().parse('')).toBeNull();
    expect(optionalText().parse(undefined)).toBeNull();
    expect(optionalText().parse(null)).toBeNull();
    expect(optionalText().parse(' x ')).toBe('x');
    expect(issues(optionalText(1).safeParse('xx'))).toEqual(['forms.errors.tooLong']);
  });
  it('ints coerce and range-check', () => {
    expect(optionalInt(0, 10).parse('')).toBeNull();
    expect(optionalInt(0, 10).parse('7')).toBe(7);
    expect(issues(optionalInt(0, 10).safeParse('11'))).toEqual(['forms.errors.range']);
    expect(issues(optionalInt(0, 10).safeParse('-1'))).toEqual(['forms.errors.range']);
    expect(issues(optionalInt(0, 10).safeParse('1.5'))).toEqual(['forms.errors.number']);
    expect(issues(optionalInt(0, 10).safeParse('x'))).toEqual(['forms.errors.number']);
    expect(requiredInt(1, 5).parse('3')).toBe(3);
    expect(issues(requiredInt(1, 5).safeParse('9'))).toEqual(['forms.errors.range']);
    expect(issues(requiredInt(1, 5).safeParse('0'))).toEqual(['forms.errors.range']);
    expect(issues(requiredInt(1, 5).safeParse('2.5'))).toEqual(['forms.errors.number']);
  });
  it('dates', () => {
    expect(optionalDate().parse('')).toBeNull();
    expect(optionalDate().parse('2026-09-01')).toBe('2026-09-01');
    expect(issues(optionalDate().safeParse('1/9/26'))).toEqual(['forms.errors.date']);
    expect(requiredDate().parse('2027-01-01')).toBe('2027-01-01');
  });
  it('checkbox', () => {
    expect(checkbox().parse('on')).toBe(true);
    expect(checkbox().parse('true')).toBe(true);
    expect(checkbox().parse(true)).toBe(true);
    expect(checkbox().parse(undefined)).toBe(false);
  });
  it('phone and email', () => {
    expect(optionalPhone().parse('050-000-0106')).toBe('+972500000106');
    expect(optionalPhone().parse('')).toBeNull();
    expect(issues(optionalPhone().safeParse('12'))).toEqual(['forms.errors.phone']);
    expect(optionalEmail().parse('A@B.test')).toBe('a@b.test');
    expect(optionalEmail().parse('')).toBeNull();
    expect(issues(optionalEmail().safeParse('nope'))).toEqual(['forms.errors.email']);
  });
});
