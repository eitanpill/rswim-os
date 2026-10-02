import { NextResponse, type NextRequest } from 'next/server';
import { ingestGhlWebhook } from '@rswim/domain-crm/webhook';
import { verifyGhlSignature } from '@rswim/integrations';
import { db } from '@/lib/db';

/**
 * POST /api/webhooks/ghl: ContactCreate / ContactUpdate from LeadYourWay (GHL).
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
    const result = await ingestGhlWebhook(db(), raw);
    return NextResponse.json({ result });
  } catch (e) {
    if (e instanceof SyntaxError) return new NextResponse('bad json', { status: 400 });
    throw e;
  }
}
