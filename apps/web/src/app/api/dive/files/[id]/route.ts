import { z } from 'zod';
import { readableFile } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { fileStore } from '@/lib/dive-files';

/**
 * A diver's document (insurance policy, doctor's note, certification card), for the people allowed to see it: the
 * `files` row is read as the signed-in user, so RLS decides (staff of the club, or the diver who uploaded it).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const file = await withSession((tx) => readableFile(tx, id.data));
  const store = fileStore();
  if (!file || !store) return new Response(null, { status: 404 });
  const bytes = await store.get(file.path);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(new Blob([bytes as BlobPart], { type: file.mime }), {
    headers: {
      'content-type': file.mime,
      'content-disposition': 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy':
        "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
