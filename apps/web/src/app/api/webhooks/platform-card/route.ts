import { NextResponse, type NextRequest } from 'next/server';
import { ingestCardSetup } from '@rswim/domain-platform/card-intake';
import { db } from '@/lib/db';
import { cardVault } from '@/lib/platform-card';

/**
 * POST /api/webhooks/platform-card: the platform's processor reports a card saved (or refused) on its card page. The
 * vault verifies the signature (a forged callback is refused); the card lands on the school whose owner opened that
 * setup, never another, and a redelivery changes nothing. Errors answer 500 so the processor retries.
 */
export async function POST(request: NextRequest) {
  const vault = cardVault();
  if (!vault) return new NextResponse('not configured', { status: 503 });
  const event = await vault.readCardWebhook(await request.text(), request.headers);
  if (!event) return new NextResponse('bad signature', { status: 401 });
  await ingestCardSetup(db(), event);
  return NextResponse.json({ ok: true });
}
