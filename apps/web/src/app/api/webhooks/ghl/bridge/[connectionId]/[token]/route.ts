import { NextResponse, type NextRequest } from 'next/server';
import { ingestGhlBridgeHook } from '@rswim/domain-comms';
import { acrossSchools } from '@/lib/db';

type Params = { params: Promise<{ connectionId: string; token: string }> };

/**
 * POST /api/webhooks/ghl/bridge/<connectionId>/<token>: the business's GHL workflow ("Customer replied" on WhatsApp →
 * Webhook) says a contact wrote. The token in the path is the connection's own secret; the body only names the
 * contact, and the worker reads what was said from GHL with the business's token. Answers fast: GHL retries errors.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { connectionId, token } = await params;
  const raw = await request.text();
  if (raw.length > 200_000) return new NextResponse('too large', { status: 413 });
  const result = await acrossSchools(
    (d) => ingestGhlBridgeHook(d, connectionId, token, raw),
    (r) => r === 'unknown_connection',
  );
  if (result === 'unknown_connection' || result === 'forbidden')
    return new NextResponse('unknown', { status: 404 });
  if (result === 'not_connected') return new NextResponse('not connected', { status: 410 });
  return NextResponse.json({ result });
}
