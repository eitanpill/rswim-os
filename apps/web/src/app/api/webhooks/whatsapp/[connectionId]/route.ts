import { NextResponse, type NextRequest } from 'next/server';
import { ingestMetaWebhook, metaSubscriptionCheck } from '@rswim/domain-comms';
import { acrossSchools } from '@/lib/db';

type Params = { params: Promise<{ connectionId: string }> };

/**
 * GET /api/webhooks/whatsapp/<connectionId>: Meta's subscription check. The challenge goes back only when the verify
 * token is the one this connection shows its owner.
 */
export async function GET(request: NextRequest, { params }: Params) {
  const { connectionId } = await params;
  const q = request.nextUrl.searchParams;
  const challenge = await acrossSchools(
    (d) =>
      metaSubscriptionCheck(d, connectionId, {
        mode: q.get('hub.mode'),
        token: q.get('hub.verify_token'),
        challenge: q.get('hub.challenge'),
      }),
    (r) => r === null,
  );
  if (challenge === null) return new NextResponse('forbidden', { status: 403 });
  return new NextResponse(challenge, { status: 200, headers: { 'content-type': 'text/plain' } });
}

/**
 * POST /api/webhooks/whatsapp/<connectionId>: people's messages and the receipts of ours, signed with the business's
 * app secret (a forged body is refused). Messages are stored once by Meta's id; errors answer 500 so Meta retries.
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { connectionId } = await params;
  const raw = await request.text();
  const result = await acrossSchools(
    (d) => ingestMetaWebhook(d, connectionId, raw, request.headers.get('x-hub-signature-256')),
    (r) => r === 'unknown_connection',
  );
  if (result === 'unknown_connection') return new NextResponse('unknown', { status: 404 });
  if (result === 'not_connected') return new NextResponse('not connected', { status: 503 });
  if (result === 'rejected') return new NextResponse('bad signature', { status: 401 });
  return NextResponse.json({ result });
}
