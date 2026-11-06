import { NextResponse, type NextRequest } from 'next/server';
import { ingestInboundMessage, isInboundMessage } from '@rswim/domain-comms/intake';
import { ingestGhlWebhook } from '@rswim/domain-crm/webhook';
import { verifyGhlSignature } from '@rswim/integrations';
import { acrossSchools } from '@/lib/db';

/**
 * POST /api/webhooks/ghl: ContactCreate / ContactUpdate and InboundMessage (a family's WhatsApp) from LeadYourWay (GHL).
 * Verifies `x-wh-signature` against GHL's published key (GHL_WEBHOOK_PUBLIC_KEY), stores the event once and queues
 * it; the worker applies it. Always answers fast: GHL retries on errors, and duplicates are dropped by id.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const key = process.env.GHL_WEBHOOK_PUBLIC_KEY;
  if (!key) return new NextResponse('webhook not configured', { status: 503 });
  if (!verifyGhlSignature(raw, request.headers.get('x-wh-signature'), key)) {
    return new NextResponse('bad signature', { status: 401 });
  }
  try {
    const body: unknown = JSON.parse(raw);
    // The GHL location names the school; its own database (when it has one) holds the location id.
    const result = isInboundMessage(body)
      ? await acrossSchools(
          (d) => ingestInboundMessage(d, raw),
          (r) => r === 'unknown_location',
        )
      : await acrossSchools(
          (d) => ingestGhlWebhook(d, raw),
          (r) => r === 'unknown_location',
        );
    return NextResponse.json({ result });
  } catch (e) {
    if (e instanceof SyntaxError) return new NextResponse('bad json', { status: 400 });
    throw e;
  }
}
