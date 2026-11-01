import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

/**
 * Where uploaded documents live (a diver's insurance policy, a doctor's note, a certification card). The database
 * keeps the `files` row (who may read it, under RLS); the bytes live here, under a path the app chooses.
 */
export interface FileStore {
  put(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** The bytes, or null when nothing is stored at that path. */
  get(path: string): Promise<Uint8Array | null>;
}

/** Paths the app builds: segments of letters, digits, `_` and `-`, one optional extension. Nothing else is stored. */
const SAFE_PATH = /^[a-z0-9_-]+(\/[a-z0-9_-]+)*(\.[a-z0-9]{1,5})?$/i;

export function assertSafePath(path: string): string {
  if (!SAFE_PATH.test(path)) throw new Error(`unsafe file path: ${path}`);
  return path;
}

/** Files on the local disk: local development, E2E and the one-container live demo. */
export class LocalDiskStore implements FileStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** SAFE_PATH has no `..` and no leading `/`, so the file stays under the root. */
  private file(path: string): string {
    return join(this.root, assertSafePath(path));
  }

  async put(path: string, bytes: Uint8Array): Promise<void> {
    const full = this.file(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async get(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.file(path)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
}

/**
 * Supabase Storage, one private bucket, reached with the service key from the server only. The app checks who may
 * read a file (the `files` row under RLS) before it asks for the bytes.
 */
export class SupabaseStore implements FileStore {
  constructor(
    private readonly cfg: { url: string; serviceKey: string; bucket: string },
    private readonly http: typeof fetch = fetch,
  ) {}

  private endpoint(path: string): string {
    return `${this.cfg.url.replace(/\/$/, '')}/storage/v1/object/${this.cfg.bucket}/${assertSafePath(path)}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.cfg.serviceKey}`,
      apikey: this.cfg.serviceKey,
      ...extra,
    };
  }

  async put(path: string, bytes: Uint8Array, mime: string): Promise<void> {
    const res = await this.http(this.endpoint(path), {
      method: 'POST',
      headers: this.headers({ 'content-type': mime, 'x-upsert': 'false' }),
      body: bytes as unknown as NonNullable<RequestInit['body']>,
    });
    if (!res.ok) throw new Error(`storage upload failed: ${res.status}`);
  }

  async get(path: string): Promise<Uint8Array | null> {
    const res = await this.http(this.endpoint(path), { headers: this.headers() });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`storage download failed: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
}

/** Uploads the club accepts, recognised by their first bytes (not by the name or the browser's word for it). */
export const UPLOAD_KINDS = {
  'image/jpeg': { ext: 'jpg', magic: [[0xff, 0xd8, 0xff]] },
  'image/png': { ext: 'png', magic: [[0x89, 0x50, 0x4e, 0x47]] },
  'image/webp': { ext: 'webp', magic: [[0x52, 0x49, 0x46, 0x46]] },
  'application/pdf': { ext: 'pdf', magic: [[0x25, 0x50, 0x44, 0x46]] },
} as const;
export type UploadMime = keyof typeof UPLOAD_KINDS;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/** What a file really is, from its first bytes; null when it is none of the accepted kinds. */
export function sniffUpload(bytes: Uint8Array): UploadMime | null {
  for (const [mime, k] of Object.entries(UPLOAD_KINDS) as [
    UploadMime,
    (typeof UPLOAD_KINDS)[UploadMime],
  ][]) {
    if (k.magic.some((m) => m.every((b, i) => bytes[i] === b))) return mime;
  }
  return null;
}
