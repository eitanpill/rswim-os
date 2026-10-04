import { z } from 'zod';
import { withSession } from '@/lib/db';
import { receiptHtml, receiptView } from '@/lib/receipt';

/**
 * Downloads a receipt as the signed-in user (RLS: a family only their own). With the real invoicing provider this is
 * the provider's signed PDF; under the fake provider (demos, tests) it is a printable copy of what was sent.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const out = await withSession(async (tx, _ctx, session) => {
    const r = await receiptView(tx, id.data);
    if (!r) return null;
    return {
      r,
      html: r.provider === 'fake' || !r.pdfUrl ? await receiptHtml(r, session.orgName ?? '') : null,
    };
  });
  if (!out) return new Response(null, { status: 404 });
  if (!out.html) return Response.redirect(out.r.pdfUrl as string, 302);
  const name = `receipt-${out.r.title.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || out.r.id}.html`;
  return new Response(out.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
    },
  });
}
