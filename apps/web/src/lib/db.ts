import 'server-only';
import { redirect } from 'next/navigation';
import { asAnon, asUser, createDb, createPool, eq, schema, sql, type Db, type Tx } from '@rswim/db';
import {
  DatabaseRouter,
  findAcross,
  masterKeyFromEnv,
  SchoolDatabaseNotReady,
} from '@rswim/db/tenants';
import { mirrorUsers, syncUp } from '@rswim/domain-platform/sync';
import type { ServiceContext } from '@rswim/domain-core';
import { getSession } from './auth/session';
import type { Session } from './auth/types';

/**
 * One pool per server process (kept on globalThis so dev hot reloads don't leak connections).
 * DATABASE_URL points at Postgres directly: Supabase's pooler in hosted environments, local Postgres in dev and E2E.
 */
const g = globalThis as unknown as { rswimDb?: Db; rswimRouter?: DatabaseRouter };

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
  return asUser(await schoolDbOrWait(orgId), { sub: session.userId, org_id: orgId }, (tx) =>
    fn(tx, { orgId, userId: session.userId }, session),
  );
}

/**
 * Runs `fn` as the signed-in user without a school claim: for opening a new school (the database function checks
 * the caller) and for the platform console (security-definer functions check `platform_admins`).
 */
export async function withSignedIn<T>(
  fn: (tx: Tx, ctx: ServiceContext, session: Session) => Promise<T>,
  opts: { platform?: boolean; database?: Db } = {},
): Promise<T> {
  const session = await getSession();
  if (!session) redirect('/login');
  if (opts.platform && !session.isPlatformAdmin) redirect('/');
  return asUser(opts.database ?? db(), { sub: session.userId, org_id: null }, (tx) =>
    fn(tx, { orgId: '', userId: session.userId }, session),
  );
}

/** Runs `fn` with no user, for public reads before sign-in. */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>, database?: Db): Promise<T> {
  return asAnon(database ?? db(), fn);
}

// ─── A school's own database (docs/TENANT-DATABASES.md) ─────────────────────

/** Finds each school's database; `db()` above is the platform's own (the control plane). */
export function router(): DatabaseRouter {
  g.rswimRouter ??= new DatabaseRouter(db(), {
    masterKey: () => masterKeyFromEnv(),
    poolSize: Number(process.env.SCHOOL_DATABASE_POOL_SIZE ?? 3),
  });
  return g.rswimRouter;
}

/** The database that holds this school's data. Throws SchoolDatabaseNotReady while its own one is being made. */
export function dbFor(orgId: string): Promise<Db> {
  return router().forOrg(orgId);
}

/** Like dbFor, but a school whose database is not ready yet sends the visitor to the "getting ready" screen. */
export async function schoolDbOrWait(orgId: string): Promise<Db> {
  try {
    return await dbFor(orgId);
  } catch (e) {
    if (e instanceof SchoolDatabaseNotReady) redirect('/preparing');
    throw e;
  }
}

/**
 * Runs a lookup by a public key that does not name the school (a payment link, an invite, a webhook) on each
 * database until `miss` says it found something. Returns the last answer when nobody knows the key.
 */
export async function acrossSchools<T>(
  fn: (db: Db) => Promise<T>,
  miss: (r: T) => boolean,
): Promise<T> {
  let last: T | undefined;
  const found = await findAcross(router(), async (d) => {
    last = await fn(d);
    return miss(last) ? null : { r: last };
  });
  return found ? found.value.r : (last as T);
}

/**
 * The school's database by its public slug (join links), or the platform's for a shared school (and for a school
 * whose own database is still being made: its public page is not open yet).
 */
export async function dbForSlug(slug: string): Promise<Db> {
  const [org] = await db().transaction((tx) =>
    tx
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, slug)),
  );
  if (!org) return db();
  try {
    return await dbFor(org.id);
  } catch (e) {
    if (e instanceof SchoolDatabaseNotReady) return db();
    throw e;
  }
}

/** Before a signed-in person joins a school in its own database: their sign-in row must be there. */
export async function prepareJoin(target: Db, userId: string): Promise<void> {
  if (target !== db()) await mirrorUsers(db(), target, [userId]);
}

/**
 * After a person joined a school in its own database: the platform's directory learns the membership at once (the
 * next token must carry the school) and their sign-in row points at the school.
 */
export async function afterJoin(target: Db, orgId: string, userId: string): Promise<void> {
  if (target === db()) return;
  await syncUp(db(), target, orgId);
  await db().transaction((tx) =>
    tx.execute(
      sql`update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
            || jsonb_build_object('active_org_id', ${orgId}::uuid) where id = ${userId}`,
    ),
  );
}

/**
 * Runs `fn` on the platform's database and on every school's own one, and joins the answers: what a signed-in person
 * has across schools (their join requests, the families that have their phone). A school's own database answers only
 * once the person's sign-in row is there (they asked to join it); the platform's covers every shared school.
 */
export async function fromEveryDatabase<T>(fn: (db: Db) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const t of await router().all()) out.push(...(await fn(t.db)));
  return out;
}
