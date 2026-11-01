import 'server-only';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DomainError } from '@rswim/domain-core';
import {
  LocalDiskStore,
  MAX_UPLOAD_BYTES,
  sniffUpload,
  SupabaseStore,
  UPLOAD_KINDS,
  type FileStore,
} from '@rswim/integrations';
import { isDemoMode } from './auth/dev';

/**
 * Where divers' documents are kept. On the local disk for development, E2E and the live demo (`RSWIM_FILES_FAKE=1`
 * or demo mode, folder `RSWIM_FILES_DIR`); in Supabase Storage once the project exists (`SUPABASE_URL`,
 * `SUPABASE_SERVICE_ROLE_KEY`, bucket `RSWIM_FILES_BUCKET`, default "dive-documents"). Without either, uploads are
 * refused with a message and forms are signed without an attachment.
 */
export function fileStore(): FileStore | null {
  if (process.env.RSWIM_FILES_FAKE === '1' || isDemoMode())
    return new LocalDiskStore(process.env.RSWIM_FILES_DIR ?? join(tmpdir(), 'rswim-files'));
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && serviceKey)
    return new SupabaseStore({
      url,
      serviceKey,
      bucket: process.env.RSWIM_FILES_BUCKET ?? 'dive-documents',
    });
  return null;
}

export type DivePurpose = 'dive_insurance' | 'dive_medical' | 'dive_cert';

/**
 * Stores an uploaded document after checking what it really is (its first bytes) and its size. Returns what the
 * `files` row needs; the caller records it in the same transaction as the form that uses it.
 */
export async function storeUpload(
  orgId: string,
  file: File,
  purpose: DivePurpose,
): Promise<{ path: string; mime: string; sizeBytes: number }> {
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError('dive.errors.uploadTooBig');
  const store = fileStore();
  if (!store) throw new DomainError('dive.errors.uploadUnavailable');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffUpload(bytes);
  if (!mime) throw new DomainError('dive.errors.uploadKind');
  const path = `${orgId}/${purpose}/${randomUUID()}.${UPLOAD_KINDS[mime].ext}`;
  await store.put(path, bytes, mime);
  return { path, mime, sizeBytes: bytes.length };
}

/** The uploaded file of a form field, if one was chosen. */
export function chosenFile(fd: FormData, name: string): File | null {
  const f = fd.get(name);
  return f instanceof File && f.size > 0 ? f : null;
}
