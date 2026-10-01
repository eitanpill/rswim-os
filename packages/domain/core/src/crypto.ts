/**
 * Envelope encryption for sensitive fields (ID numbers, medical notes, bank details) — ADR-0005.
 * A per-org data key (DEK) encrypts fields; the DEK is stored wrapped by the master key (KEK) from the environment.
 * Format of every ciphertext: version (1 byte) | iv (12) | auth tag (16) | ciphertext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 1;
const IV_LEN = 12;
const TAG_LEN = 16;

function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (sealed[0] !== VERSION) throw new Error(`Unsupported ciphertext version ${sealed[0]}`);
  const iv = sealed.subarray(1, 1 + IV_LEN);
  const tag = sealed.subarray(1 + IV_LEN, 1 + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(sealed.subarray(1 + IV_LEN + TAG_LEN)), decipher.final()]);
}

export function parseMasterKey(base64: string | undefined): Buffer {
  if (!base64) throw new Error('RSWIM_MASTER_KEY is not set');
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('RSWIM_MASTER_KEY must be 32 bytes, base64-encoded');
  return key;
}

/** Creates a fresh data key for an org and returns it with its wrapped form for org_keys.wrapped_dek. */
export function createDataKey(masterKey: Buffer, orgId: string): { dek: Buffer; wrapped: Buffer } {
  const dek = randomBytes(32);
  return { dek, wrapped: seal(masterKey, dek, `dek:${orgId}`) };
}

export function unwrapDataKey(masterKey: Buffer, orgId: string, wrapped: Buffer): Buffer {
  return open(masterKey, wrapped, `dek:${orgId}`);
}

/**
 * Encrypts one field. The AAD binds the ciphertext to its table, column and row, so a value copied into
 * another row or column will not decrypt.
 */
export function encryptField(dek: Buffer, value: string, context: FieldContext): Buffer {
  return seal(dek, Buffer.from(value, 'utf8'), aadFor(context));
}

export function decryptField(dek: Buffer, sealed: Buffer, context: FieldContext): string {
  return open(dek, sealed, aadFor(context)).toString('utf8');
}

export interface FieldContext {
  table: string;
  column: string;
  rowId: string;
}

const aadFor = (c: FieldContext) => `${c.table}.${c.column}:${c.rowId}`;
