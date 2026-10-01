import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type pg from 'pg';
import { createDb } from './client';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
const SHIM = fileURLToPath(new URL('../sql/supabase-shim.sql', import.meta.url));

/** Creates the Supabase-provided roles, auth schema and auth.users on plain Postgres. Never on Supabase. */
export async function applySupabaseShim(pool: pg.Pool): Promise<void> {
  await pool.query(await readFile(SHIM, 'utf8'));
}

export async function runMigrations(pool: pg.Pool): Promise<void> {
  await migrate(createDb(pool), { migrationsFolder: MIGRATIONS_DIR });
}
