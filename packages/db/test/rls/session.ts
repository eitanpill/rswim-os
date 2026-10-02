import type pg from 'pg';

export type Run = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

export const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

/** Each statement runs in its own savepoint, so an expected error doesn't abort the rest of the test. */
function savepointed(c: pg.PoolClient): Run {
  return async (text, params) => {
    await c.query('savepoint s');
    try {
      const rows = (await c.query(text, params)).rows;
      await c.query('release savepoint s');
      return rows;
    } catch (e) {
      await c.query('rollback to savepoint s');
      throw e;
    }
  };
}

/** Session helpers bound to a test database. Every call runs inside a transaction that is rolled back. */
export function sessions(pool: () => pg.Pool) {
  /** Runs `fn` as the given user with the given org claim, exactly as Supabase does per request. */
  async function as<T>(
    userId: string,
    orgId: string | null,
    fn: (run: Run, c: pg.PoolClient) => Promise<T>,
  ) {
    const c = await pool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: userId, org_id: orgId }),
      ]);
      await c.query('set local role authenticated');
      return await fn(savepointed(c), c);
    } finally {
      await c.query('rollback');
      c.release();
    }
  }

  /** Runs `fn` as the worker's system role scoped to one org. */
  async function asSystem<T>(orgId: string, fn: (run: Run) => Promise<T>) {
    const c = await pool().connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('app.org_id', $1, true)`, [orgId]);
      await c.query('set local role rswim_system');
      return await fn(savepointed(c));
    } finally {
      await c.query('rollback');
      c.release();
    }
  }

  return { as, asSystem };
}
