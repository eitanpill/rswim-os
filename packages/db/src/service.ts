/**
 * Server-side database access that is NOT tied to a signed-in user (worker, webhooks, cron).
 * Lint bans importing this outside apps/worker, webhook routes and the db package (ADR-0005).
 */
import { sql } from 'drizzle-orm';
import type { Db, Tx } from './client';

export interface WithOrgOptions {
  /** User the work is done on behalf of, recorded as the audit actor. */
  actorId?: string;
}

/**
 * Runs `fn` as `rswim_system` scoped to ONE organization. RLS still applies: every policy resolves
 * `app.current_org()` to `orgId`, so a bug in a job cannot read or write another tenant's rows.
 */
export async function withOrg<T>(
  db: Db,
  orgId: string,
  fn: (tx: Tx) => Promise<T>,
  options: WithOrgOptions = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    await tx.execute(
      sql`select set_config('request.jwt.claims', ${JSON.stringify(options.actorId ? { sub: options.actorId } : {})}, true)`,
    );
    await tx.execute(sql`set local role rswim_system`);
    return fn(tx);
  });
}

/**
 * Cross-tenant access with the connection's own (owner) role, bypassing RLS. Only for platform plumbing
 * that is inherently cross-tenant, such as the outbox relay claiming due rows. Keep usage tiny.
 */
export async function asPlatform<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
