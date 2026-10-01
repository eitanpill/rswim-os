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
