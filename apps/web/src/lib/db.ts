import 'server-only';
import { redirect } from 'next/navigation';
import { asUser, createDb, createPool, type Db, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { getSession } from './auth/session';
import type { Session } from './auth/types';

/**
 * One pool per server process (kept on globalThis so dev hot reloads don't leak connections).
 * DATABASE_URL points at Postgres directly: Supabase's pooler in hosted environments, local Postgres in dev and E2E.
 */
const g = globalThis as unknown as { rswimDb?: Db };

export function db(): Db {
  if (!g.rswimDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    g.rswimDb = createDb(createPool(url, Number(process.env.DATABASE_POOL_SIZE ?? 5)));
  }
  return g.rswimDb;
}

/**
 * Runs `fn` as the signed-in user, inside one transaction, with RLS in full force: the same claims Supabase would
 * put on a PostgREST request. Every admin page and action reads and writes through this.
 */
export async function withSession<T>(
  fn: (tx: Tx, ctx: ServiceContext, session: Session) => Promise<T>,
): Promise<T> {
  const session = await getSession();
  if (!session?.orgId) redirect('/login');
  const orgId = session.orgId;
  return asUser(db(), { sub: session.userId, org_id: orgId }, (tx) =>
    fn(tx, { orgId, userId: session.userId }, session),
  );
}
