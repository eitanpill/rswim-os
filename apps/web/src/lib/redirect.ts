import { NextResponse } from 'next/server';

/**
 * A redirect to a path on this site. The Location stays relative: behind a host's proxy (the live demo, any
 * self-hosted deployment) `request.url` names the server's own address, not the address the browser used.
 */
export function redirectTo(path: string, status: 303 | 307 = 307): NextResponse {
  return new NextResponse(null, { status, headers: { location: path } });
}
