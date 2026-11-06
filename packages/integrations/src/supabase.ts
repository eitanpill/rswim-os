/**
 * Where a school's own database is created (docs/TENANT-DATABASES.md).
 *
 * `SupabaseManagementHost` talks to the Supabase Management API (https://api.supabase.com/v1) with a personal or
 * OAuth access token: it creates one project per school in the platform's Supabase organization, waits for it, and
 * hands back a pooler connection string. `LocalPostgresHost` creates a database on a local Postgres instead, so
 * the whole flow runs in tests and demos with no account.
 */
import pg from 'pg';

export type DatabaseHostStatus = 'creating' | 'ready' | 'failed';

export interface CreatedDatabase {
  ref: string;
  region: string | null;
}

export interface DatabaseHost {
  readonly provider: 'supabase' | 'local';
  /** True when the new database is plain Postgres (needs the Supabase shim before migrations). */
  readonly plainPostgres: boolean;
  /** Creates the database, or finds the one already created under this name (safe to call again). */
  createDatabase(input: { name: string; dbPass: string }): Promise<CreatedDatabase>;
  status(ref: string): Promise<DatabaseHostStatus>;
  connectionUrl(ref: string, dbPass: string): Promise<string>;
  deleteDatabase(ref: string): Promise<void>;
}

export class DatabaseHostError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** 429 and 5xx: try again later. */
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'DatabaseHostError';
  }
}

export interface SupabaseManagementOptions {
  accessToken: string;
  /** The platform's Supabase organization (Organization settings → slug). */
  organizationSlug: string;
  /** e.g. 'eu-central-1' (Frankfurt, closest to Israel). Left out, Supabase chooses. */
  region?: string;
  /** e.g. 'micro'. Left out, the organization's default. */
  instanceSize?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface ProjectJson {
  id?: string;
  ref?: string;
  name?: string;
  region?: string;
  status?: string;
}

interface PoolerJson {
  database_type?: string;
  db_user?: string;
  db_host?: string;
  db_port?: number;
  db_name?: string;
  pool_mode?: string;
}

const READY = new Set(['ACTIVE_HEALTHY']);
const FAILED = new Set([
  'INIT_FAILED',
  'REMOVED',
  'GOING_DOWN',
  'PAUSED',
  'RESTORE_FAILED',
  'PAUSE_FAILED',
]);

export class SupabaseManagementHost implements DatabaseHost {
  readonly provider = 'supabase' as const;
  readonly plainPostgres = false;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: SupabaseManagementOptions) {
    this.base = (opts.baseUrl ?? 'https://api.supabase.com').replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.opts.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      // The body may echo the request; keep only a short message, never the password.
      const text = (await res.text().catch(() => '')).slice(0, 300);
      throw new DatabaseHostError(
        `supabase ${method} ${path.replace(/\/projects\/[^/]+/, '/projects/:ref')} → ${res.status} ${text}`,
        res.status,
        res.status === 429 || res.status >= 500,
      );
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : {}) as T;
  }

  async createDatabase(input: { name: string; dbPass: string }): Promise<CreatedDatabase> {
    const existing = (await this.call<ProjectJson[]>('GET', '/v1/projects')).find(
      (p) => p.name === input.name,
    );
    if (existing?.ref) return { ref: existing.ref, region: existing.region ?? null };
    const body: Record<string, unknown> = {
      name: input.name,
      organization_slug: this.opts.organizationSlug,
      db_pass: input.dbPass,
    };
    if (this.opts.region) body.region = this.opts.region;
    if (this.opts.instanceSize) body.desired_instance_size = this.opts.instanceSize;
    const p = await this.call<ProjectJson>('POST', '/v1/projects', body);
    const ref = p.ref ?? p.id;
    if (!ref) throw new DatabaseHostError('supabase did not return a project ref');
    return { ref, region: p.region ?? null };
  }

  async status(ref: string): Promise<DatabaseHostStatus> {
    const p = await this.call<ProjectJson>('GET', `/v1/projects/${encodeURIComponent(ref)}`);
    const s = (p.status ?? '').toUpperCase();
    if (READY.has(s)) return 'ready';
    if (FAILED.has(s)) return 'failed';
    return 'creating';
  }

  /** Supavisor in session mode (port 5432): works over IPv4 and keeps session settings for migrations. */
  async connectionUrl(ref: string, dbPass: string): Promise<string> {
    const rows = await this.call<PoolerJson[]>(
      'GET',
      `/v1/projects/${encodeURIComponent(ref)}/config/database/pooler`,
    );
    const p = rows.find((r) => (r.database_type ?? 'PRIMARY') === 'PRIMARY') ?? rows[0];
    if (!p?.db_host || !p.db_user)
      throw new DatabaseHostError('supabase pooler config has no host');
    const url = new URL('postgresql://placeholder');
    url.username = p.db_user;
    url.password = dbPass;
    url.hostname = p.db_host;
    url.port = '5432';
    url.pathname = `/${p.db_name ?? 'postgres'}`;
    url.searchParams.set('sslmode', 'require');
    return url.toString();
  }

  async deleteDatabase(ref: string): Promise<void> {
    await this.call('DELETE', `/v1/projects/${encodeURIComponent(ref)}`);
  }
}

/**
 * A database per school on a local Postgres (tests, demos, a single-server install). `adminUrl` must be allowed to
 * create databases. `readyAfterPolls` makes it look like a project that takes a while to come up.
 */
export class LocalPostgresHost implements DatabaseHost {
  readonly provider = 'local' as const;
  readonly plainPostgres = true;
  private polls = new Map<string, number>();

  constructor(
    private readonly adminUrl: string,
    private readonly readyAfterPolls = 0,
  ) {}

  private static dbName(name: string): string {
    const clean = name
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 50);
    return `rswim_school_${clean}`;
  }

  async createDatabase(input: { name: string }): Promise<CreatedDatabase> {
    const ref = LocalPostgresHost.dbName(input.name);
    const c = new pg.Client({ connectionString: this.adminUrl });
    await c.connect();
    try {
      const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [ref]);
      if (!rowCount) await c.query(`create database "${ref}"`);
    } finally {
      await c.end();
    }
    return { ref, region: 'local' };
  }

  async status(ref: string): Promise<DatabaseHostStatus> {
    const n = (this.polls.get(ref) ?? 0) + 1;
    this.polls.set(ref, n);
    return n > this.readyAfterPolls ? 'ready' : 'creating';
  }

  async connectionUrl(ref: string): Promise<string> {
    const url = new URL(this.adminUrl);
    url.pathname = `/${ref}`;
    return url.toString();
  }

  async deleteDatabase(ref: string): Promise<void> {
    const c = new pg.Client({ connectionString: this.adminUrl });
    await c.connect();
    try {
      await c.query(`drop database if exists "${ref.replace(/"/g, '')}" with (force)`);
    } finally {
      await c.end();
    }
  }
}
