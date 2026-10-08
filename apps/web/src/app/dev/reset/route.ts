import { timingSafeEqual } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { NextResponse, type NextRequest } from 'next/server';
import { redirectTo } from '@/lib/redirect';
import { isDemoMode } from '@/lib/auth/dev';

/**
 * GET /dev/reset?key=… — asks the live demo to go back to its starting data (deploy/demo/start.sh picks the request
 * up within seconds). 404 unless RSWIM_DEMO_MODE=1 and RSWIM_DEMO_RESET_KEY is set; the key is compared in constant
 * time.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.RSWIM_DEMO_RESET_KEY;
  if (!isDemoMode() || !expected) return new NextResponse('Not found', { status: 404 });
  const given = Buffer.from(request.nextUrl.searchParams.get('key') ?? '');
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want))
    return new NextResponse('Not found', { status: 404 });
  await writeFile(
    process.env.RSWIM_DEMO_RESET_FLAG ?? '/tmp/rswim-demo-reset',
    new Date().toISOString(),
  );
  return redirectTo('/login?reset=1');
}
