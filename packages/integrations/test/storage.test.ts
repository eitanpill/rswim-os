import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { assertSafePath, LocalDiskStore, sniffUpload, SupabaseStore } from '../src/storage';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('file stores', () => {
  it('keeps bytes on the local disk and answers null for a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rswim-files-'));
    dirs.push(dir);
    const store = new LocalDiskStore(dir);
    await store.put('org/dive_insurance/a.pdf', new Uint8Array([1, 2, 3]));
    expect(Array.from((await store.get('org/dive_insurance/a.pdf')) ?? [])).toEqual([1, 2, 3]);
    expect(await store.get('org/none.pdf')).toBeNull();
  });

  it('refuses paths that could leave its folder', async () => {
    const store = new LocalDiskStore(tmpdir());
    await expect(store.put('../etc/passwd', new Uint8Array())).rejects.toThrow(/unsafe/);
    await expect(store.get('a/../../b')).rejects.toThrow(/unsafe/);
    expect(() => assertSafePath('/abs')).toThrow(/unsafe/);
    expect(assertSafePath('a/b-c_d.jpg')).toBe('a/b-c_d.jpg');
  });

  it('passes on disk errors other than a missing file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rswim-files-'));
    dirs.push(dir);
    const store = new LocalDiskStore(dir);
    await store.put('a/b.txt', new Uint8Array([1]));
    // Reading a folder as a file fails with EISDIR.
    await expect(store.get('a')).rejects.toThrow();
  });

  it('talks to Supabase Storage with the service key', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const answers = [
      new Response(null, { status: 200 }),
      new Response(new Uint8Array([9, 8]), { status: 200 }),
      new Response(null, { status: 404 }),
      new Response(null, { status: 500 }),
      new Response(null, { status: 500 }),
    ];
    const http = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return answers.shift() as Response;
    }) as unknown as typeof fetch;
    const store = new SupabaseStore(
      { url: 'https://x.supabase.co/', serviceKey: 'k', bucket: 'docs' },
      http,
    );
    await store.put('o/a.png', new Uint8Array([1]), 'image/png');
    expect(calls[0]?.url).toBe('https://x.supabase.co/storage/v1/object/docs/o/a.png');
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer k');
    expect(Array.from((await store.get('o/a.png')) ?? [])).toEqual([9, 8]);
    expect(await store.get('o/missing.png')).toBeNull();
    await expect(store.get('o/a.png')).rejects.toThrow(/download failed/);
    await expect(store.put('o/a.png', new Uint8Array([1]), 'image/png')).rejects.toThrow(
      /upload failed/,
    );
  });

  it('uses the global fetch by default', () => {
    expect(new SupabaseStore({ url: 'u', serviceKey: 'k', bucket: 'b' })).toBeInstanceOf(
      SupabaseStore,
    );
  });
});

describe('uploads', () => {
  it('recognises the accepted kinds by their first bytes', () => {
    expect(sniffUpload(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffUpload(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png');
    expect(sniffUpload(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe('image/webp');
    expect(sniffUpload(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe('application/pdf');
    expect(sniffUpload(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
  });
});
