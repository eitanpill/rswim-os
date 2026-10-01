import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { applySupabaseShim, createDb, createPool, runMigrations, type Db } from '../src';

export const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';

export interface TestDatabase {
  url: string;
  pool: pg.Pool;
  db: Db;
  drop(): Promise<void>;
}

/** Creates a throwaway database with the shim and all migrations applied. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `rswim_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();

  const url = new URL(ADMIN_URL);
  url.pathname = `/${name}`;
  const pool = createPool(url.toString(), 5);
  await applySupabaseShim(pool);
  await runMigrations(pool);

  return {
    url: url.toString(),
    pool,
    db: createDb(pool),
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}
