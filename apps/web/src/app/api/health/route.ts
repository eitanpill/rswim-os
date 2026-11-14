import { sql } from '@rswim/db';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * For uptime monitors: 200 when the web app can reach its database, 503 otherwise. Says nothing about tenants or
 * configuration; `release` is the deployed commit, so a monitor alert shows which deploy broke it.
 */
export async function GET() {
  const release = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RSWIM_RELEASE ?? null;
  try {
    await Promise.race([
      db().execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
    return Response.json({ ok: true, service: 'rswim-web', database: 'ok', release });
  } catch {
    return Response.json(
      { ok: false, service: 'rswim-web', database: 'unreachable', release },
      { status: 503 },
    );
  }
}
