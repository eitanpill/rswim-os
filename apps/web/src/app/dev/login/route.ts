import { NextResponse, type NextRequest } from 'next/server';
import { DEV_COOKIE, devSessionFor, isDevAuthEnabled, isPersonaKey } from '@/lib/auth/dev';
import { homePath } from '@/lib/auth/routing';

/** GET /dev/login?as=owner — local demo login. 404 unless RSWIM_DEV_AUTH=1 outside production. */
export function GET(request: NextRequest) {
  const as = request.nextUrl.searchParams.get('as');
  if (!isDevAuthEnabled() || !isPersonaKey(as))
    return new NextResponse('Not found', { status: 404 });
  const response = NextResponse.redirect(new URL(homePath(devSessionFor(as)), request.url));
  response.cookies.set(DEV_COOKIE, as, { path: '/', httpOnly: true, sameSite: 'lax' });
  return response;
}
