import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}

export function createDb(pool: pg.Pool | pg.PoolClient): Db {
  return drizzle(pool, { schema });
}

/** The subset of JWT claims the database reads. Role and permissions are re-read live from memberships. */
export interface DbClaims {
  sub: string;
  org_id: string | null;
  [k: string]: unknown;
}

/**
 * Runs `fn` as a signed-in user: `authenticated` role + JWT claims, inside one transaction.
 * This is exactly what Supabase/PostgREST does per request, so RLS applies in full.
 */
export async function asUser<T>(db: Db, claims: DbClaims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return fn(tx);
  });
}

/** Runs `fn` with no user at all (`anon`), for the few public reads before sign-in (a domain's branding). */
export async function asAnon<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local role anon`);
    return fn(tx);
  });
}
