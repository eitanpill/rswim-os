import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDataKey, decryptField, encryptField, parseMasterKey, unwrapDataKey } from '../src';

const master = randomBytes(32);
const ctx = { table: 'students', column: 'enc_medical_notes', rowId: 'r1' };

describe('envelope encryption', () => {
  it('round-trips a Hebrew value through a wrapped org key', () => {
    const { dek, wrapped } = createDataKey(master, 'org-1');
    const sealed = encryptField(dek, 'אלרגיה לכלור', ctx);
    expect(sealed.toString('utf8')).not.toContain('כלור');
    const dek2 = unwrapDataKey(master, 'org-1', wrapped);
    expect(decryptField(dek2, sealed, ctx)).toBe('אלרגיה לכלור');
  });

  it('refuses a key wrapped for another org, and a value moved to another row', () => {
    const { dek, wrapped } = createDataKey(master, 'org-1');
    expect(() => unwrapDataKey(master, 'org-2', wrapped)).toThrow();
    const sealed = encryptField(dek, '123456782', ctx);
    expect(() => decryptField(dek, sealed, { ...ctx, rowId: 'r2' })).toThrow();
  });

  it('rejects unknown ciphertext versions', () => {
    const { dek } = createDataKey(master, 'org-1');
    const sealed = encryptField(dek, 'x', ctx);
    sealed[0] = 9;
    expect(() => decryptField(dek, sealed, ctx)).toThrow(/version 9/);
  });

  it('validates the master key', () => {
    expect(() => parseMasterKey(undefined)).toThrow(/not set/);
    expect(() => parseMasterKey(Buffer.alloc(8).toString('base64'))).toThrow(/32 bytes/);
    expect(parseMasterKey(master.toString('base64')).equals(master)).toBe(true);
  });
});

describe('DomainError', () => {
  it('carries an i18n code and parameters', async () => {
    const { DomainError, isDomainError } = await import('../src/context');
    const e = new DomainError('venues.errors.laneOverlap', { lane: '2' });
    expect(isDomainError(e)).toBe(true);
    expect(isDomainError(new Error('x'))).toBe(false);
    expect([e.code, e.params, e.name, e.message]).toEqual([
      'venues.errors.laneOverlap',
      { lane: '2' },
      'DomainError',
      'venues.errors.laneOverlap',
    ]);
  });
});

describe('toDomainError', () => {
  it('maps database errors a user can cause, through drizzle’s wrapper', async () => {
    const { DomainError, toDomainError } = await import('../src/context');
    const wrap = (code: string, message = 'x') => ({
      message: 'Failed query',
      cause: { code, message },
    });
    expect(
      toDomainError(wrap('23514', 'price list is in effect: create a new version instead'))?.code,
    ).toBe('settings.errors.versionLocked');
    expect(
      toDomainError(wrap('23514', 'policy set x is in effect and cannot be deleted'))?.code,
    ).toBe('settings.errors.versionLocked');
    expect(toDomainError(wrap('23505'))?.code).toBe('forms.errors.duplicate');
    expect(toDomainError(wrap('23514', 'violates check constraint'))?.code).toBe(
      'forms.errors.invalid',
    );
    expect(toDomainError(wrap('23503'))?.code).toBe('forms.errors.invalid');
    expect(
      toDomainError({ code: '42501', message: 'new row violates row-level security policy' })?.code,
    ).toBe('common.errors.forbidden');
    expect(toDomainError(wrap('RSW01', 'attendance.errors.noSeat'))?.code).toBe(
      'attendance.errors.noSeat',
    );
    expect(toDomainError(wrap('08006'))).toBeNull();
    expect(toDomainError(new Error('boom'))).toBeNull();
    expect(toDomainError(null)).toBeNull();
    expect(toDomainError({ code: 'ECONNREFUSED' })).toBeNull();
    const d = new DomainError('x');
    expect(toDomainError(d)).toBe(d);
  });
});
