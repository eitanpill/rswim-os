import { NextResponse, type NextRequest } from 'next/server';
import { ingestGrowWebhook } from '@rswim/domain-billing/webhook';
import { verifyGrowSignature } from '@rswim/integrations';
import { db } from '@/lib/db';

/**
 * POST /api/webhooks/grow: charge and payment-link results from Grow.
 * Verifies `x-grow-signature` (HMAC-SHA256 with GROW_WEBHOOK_SECRET), stores the event once and queues it; the
 * worker applies it. Always answers fast: Grow retries on errors, and duplicates are dropped by event id.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  const secret = process.env.GROW_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('webhook not configured', { status: 503 });
  if (!verifyGrowSignature(raw, request.headers.get('x-grow-signature'), secret)) {
    return new NextResponse('bad signature', { status: 401 });
  }
  try {
    const result = await ingestGrowWebhook(db(), raw);
    return NextResponse.json({ result });
  } catch (e) {
    if (e instanceof SyntaxError) return new NextResponse('bad json', { status: 400 });
    throw e;
  }
}
