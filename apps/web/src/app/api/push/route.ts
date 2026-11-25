import { cookies } from 'next/headers';
import { z } from 'zod';
import { PUSH_PLATFORMS } from '@rswim/contracts';
import { sql } from '@rswim/db';
import { withSession } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { PUSH_COOKIE } from '@/lib/native-app';

const Body = z.object({
  platform: z.enum(PUSH_PLATFORMS),
  token: z.string().min(16).max(4096),
});

/**
 * The store app registers its push token here on each signed-in page (store stage 6, `components/native-bridge.tsx`),
 * in the person's current school. The token is also kept in an httpOnly cookie, so signing out forgets this phone.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session?.orgId) return new Response(null, { status: 401 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return new Response(null, { status: 400 });
  await withSession((tx) =>
    tx.execute(sql`select public.register_push_device(${body.data.platform}, ${body.data.token})`),
  );
  (await cookies()).set(PUSH_COOKIE, body.data.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 400 * 24 * 60 * 60,
  });
  return new Response(null, { status: 204 });
}
