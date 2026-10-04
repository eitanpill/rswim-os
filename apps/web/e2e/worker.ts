/**
 * Plays the worker's part between two screens, as production does: the same domain services, run as the tenant's
 * worker role (`rswim_system` with `app.org_id`, so RLS still applies) on the E2E database. Fake data only.
 */
import pg from 'pg';
import { createDb, type Tx } from '@rswim/db';
import { processAbsenceNotice } from '@rswim/domain-attendance';
import { processPortalRequest } from '@rswim/domain-billing';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';
export const E2E_DB_URL = Object.assign(new URL(ADMIN_URL), { pathname: '/rswim_e2e' }).toString();

async function asWorker<T>(
  fn: (tx: Tx, orgId: string, client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `select id from organizations where slug = 'rswim-demo'`,
    );
    const orgId = rows[0]!.id;
    await client.query(
      `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
      [orgId],
    );
    await client.query('set local role rswim_system');
    const out = await fn(
      createDb(client as unknown as pg.PoolClient) as unknown as Tx,
      orgId,
      client,
    );
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

/** Decides the absence a family just reported for one lesson (the worker's `attendance.absence_reported` step). */
export function processAbsence(studentId: string, sessionId: string): Promise<(string | null)[]> {
  return asWorker(async (tx, orgId, client) => {
    const { rows } = await client.query<{ id: string }>(
      `select id from absence_notices where student_id = $1 and session_id = $2 and status = 'pending'`,
      [studentId, sessionId],
    );
    const credits: (string | null)[] = [];
    for (const r of rows) {
      credits.push((await processAbsenceNotice(tx, { orgId, userId: null }, r.id)).creditId);
    }
    return credits;
  });
}

/** Decides a family's pending freeze or leave requests on one child's seats. */
export function processRequests(studentId: string) {
  return asWorker(async (tx, orgId, client) => {
    const { rows } = await client.query<{ id: string }>(
      `select r.id from portal_requests r join enrollments e on e.id = r.enrollment_id
       where e.student_id = $1 and r.status = 'pending'`,
      [studentId],
    );
    for (const r of rows) await processPortalRequest(tx, { orgId, userId: null }, r.id);
    return rows.length;
  });
}
