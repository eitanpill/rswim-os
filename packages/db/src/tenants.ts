/**
 * A school's own database (docs/TENANT-DATABASES.md): sealing its connection string, and finding the right
 * database for a school. The platform's database (the control plane) holds `tenant_databases`; a school without a
 * row there, or with `mode = shared`, lives in the control plane itself.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { createDb, createPool, type Db } from './client';
import { tenantDatabases } from './schema/saas';

const INFO = 'rswim:tenant-database-url:v1';

function sealingKey(masterKey: Buffer): Buffer {
  if (masterKey.length < 32) throw new Error('RSWIM_MASTER_KEY must be at least 32 bytes');
  return Buffer.from(hkdfSync('sha256', masterKey, Buffer.alloc(0), INFO, 32));
}

/** AES-256-GCM, `v1.<iv>.<tag>.<ciphertext>` in base64url. */
export function sealSecret(masterKey: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sealingKey(masterKey), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv, c.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

export function openSecret(masterKey: Buffer, sealed: string): string {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) throw new Error('unknown sealed secret format');
  const d = createDecipheriv('aes-256-gcm', sealingKey(masterKey), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}

/** What `tenant_databases.connection_sealed` holds: the password from the start, the URL once the host is up. */
export interface TenantConnection {
  dbPass: string;
  url?: string;
}

export function sealConnection(masterKey: Buffer, c: TenantConnection): string {
  return sealSecret(masterKey, JSON.stringify(c));
}

export function openConnection(masterKey: Buffer, sealed: string): TenantConnection {
  return JSON.parse(openSecret(masterKey, sealed)) as TenantConnection;
}

export function masterKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = env.RSWIM_MASTER_KEY;
  return raw ? Buffer.from(raw, 'base64') : null;
}

/** Thrown when a school has its own database that is not ready yet (being created, or failed). */
export class SchoolDatabaseNotReady extends Error {
  constructor(
    readonly organizationId: string,
    readonly status: string,
  ) {
    super(`school ${organizationId} database is ${status}`);
    this.name = 'SchoolDatabaseNotReady';
  }
}

export interface DatabaseTarget {
  /** 'control' for the platform's own database, else the school's id. */
  key: string;
  db: Db;
}

interface Entry {
  status: string;
  sealed: string | null;
}

/**
 * Finds each school's database. Pools are opened once per database and kept; the registry is re-read at most every
 * `ttlMs` (and at once when a school is not found, so a database that just became ready is used right away).
 */
export class DatabaseRouter {
  private registry = new Map<string, Entry>();
  private loadedAt = 0;
  private pools = new Map<string, { sealed: string; pool: pg.Pool; db: Db }>();

  constructor(
    readonly control: Db,
    private readonly opts: {
      masterKey: () => Buffer | null;
      poolSize?: number;
      ttlMs?: number;
      /** Tests and the local provider: open a pool from a plain URL (default: createPool). */
      openPool?: (url: string, max: number) => pg.Pool;
    },
  ) {}

  private async load(force = false): Promise<void> {
    const ttl = this.opts.ttlMs ?? 30_000;
    if (!force && Date.now() - this.loadedAt < ttl) return;
    const rows = await this.control.transaction((tx) =>
      tx
        .select({
          organizationId: tenantDatabases.organizationId,
          status: tenantDatabases.status,
          sealed: tenantDatabases.connectionSealed,
        })
        .from(tenantDatabases),
    );
    this.registry = new Map(rows.map((r) => [r.organizationId, { status: r.status, sealed: r.sealed }]));
    this.loadedAt = Date.now();
  }

  /** Forget the registry (after a database became ready, in this process). */
  invalidate(): void {
    this.loadedAt = 0;
  }

  /** Is this school on a dedicated database (in any state)? */
  async isDedicated(orgId: string): Promise<boolean> {
    await this.load();
    if (!this.registry.has(orgId)) await this.load(true);
    return this.registry.has(orgId);
  }

  /** The database that holds this school's data. Throws SchoolDatabaseNotReady while its own one is not ready. */
  async forOrg(orgId: string): Promise<Db> {
    await this.load();
    let e = this.registry.get(orgId);
    if (!e || e.status !== 'ready') {
      await this.load(true);
      e = this.registry.get(orgId);
    }
    if (!e) return this.control;
    if (e.status !== 'ready' || !e.sealed) throw new SchoolDatabaseNotReady(orgId, e.status);
    return this.open(orgId, e.sealed);
  }

  /** The control plane and every ready school database, for jobs that sweep all schools. */
  async all(): Promise<DatabaseTarget[]> {
    await this.load(true);
    const out: DatabaseTarget[] = [{ key: 'control', db: this.control }];
    for (const [orgId, e] of this.registry) {
      if (e.status === 'ready' && e.sealed) out.push({ key: orgId, db: this.open(orgId, e.sealed) });
    }
    return out;
  }

  /** Opens a school's database from its sealed connection string (also used while it is being set up). */
  openSealed(orgId: string, sealed: string): Db {
    return this.open(orgId, sealed);
  }

  private open(orgId: string, sealed: string): Db {
    const cached = this.pools.get(orgId);
    if (cached && cached.sealed === sealed) return cached.db;
    if (cached) void cached.pool.end().catch(() => undefined);
    const key = this.opts.masterKey();
    if (!key) throw new Error('RSWIM_MASTER_KEY is needed to open a school database');
    const { url } = openConnection(key, sealed);
    if (!url) throw new SchoolDatabaseNotReady(orgId, 'creating');
    const pool = (this.opts.openPool ?? createPool)(url, this.opts.poolSize ?? 3);
    const db = createDb(pool);
    this.pools.set(orgId, { sealed, pool, db });
    return db;
  }

  async close(): Promise<void> {
    await Promise.all([...this.pools.values()].map((p) => p.pool.end().catch(() => undefined)));
    this.pools.clear();
  }
}

/**
 * Tries `fn` on each database until one answers (not undefined). For lookups by a public key that does not name
 * the school (a payment link token, an invite token, a webhook): each school's own database first, the platform's
 * last (it holds copies of some rows of schools with their own database).
 */
export async function findAcross<T>(
  router: DatabaseRouter,
  fn: (db: Db, key: string) => Promise<T | undefined | null>,
): Promise<{ value: T; db: Db; key: string } | null> {
  const all = await router.all();
  for (const t of [...all.slice(1), all[0]!]) {
    const value = await fn(t.db, t.key);
    if (value !== undefined && value !== null) return { value, db: t.db, key: t.key };
  }
  return null;
}

/** The status row a school's database has, or null for a shared school. */
export async function schoolDatabaseStatus(control: Db, orgId: string) {
  const [row] = await control.transaction((tx) =>
    tx
      .select({ status: tenantDatabases.status })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.organizationId, orgId)),
  );
  return row?.status ?? null;
}

