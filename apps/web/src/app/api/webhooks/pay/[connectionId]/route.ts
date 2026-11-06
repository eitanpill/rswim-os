import { NextResponse, type NextRequest } from 'next/server';
import { ingestGatewayWebhook } from '@rswim/domain-billing';
import { acrossSchools } from '@/lib/db';
import { gatewayFactory, onDivePaid } from '@/lib/payments';

/**
 * POST /api/webhooks/pay/<connectionId>: a business's processor reports a checkout's result. The connection names the
 * business; its own gateway verifies the callback with that business's secrets (a forged one is refused), stores it
 * once by the processor's event id and applies it. Errors answer 500 so the processor retries; duplicates are 200.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> },
) {
  const { connectionId } = await params;
  const raw = await request.text();
  // The connection belongs to one business; its own database (when it has one) knows it.
  const result = await acrossSchools(
    (d) => ingestGatewayWebhook(d, connectionId, raw, request.headers, { build: gatewayFactory, onDivePaid }),
    (r) => r === 'unknown_connection',
  );
  if (result === 'unknown_connection') return new NextResponse('unknown', { status: 404 });
  if (result === 'not_configured') return new NextResponse('not configured', { status: 503 });
  if (result === 'rejected') return new NextResponse('bad signature', { status: 401 });
  return NextResponse.json({ result });
}
