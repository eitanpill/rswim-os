/**
 * Plays the worker's part between two screens, as production does: the same domain services, run as the tenant's
 * worker role (`rswim_system` with `app.org_id`, so RLS still applies) on the E2E database. Fake data only.
 */
import pg from 'pg';
import { createDb, type Tx } from '@rswim/db';
import { processAbsenceNotice } from '@rswim/domain-attendance';
import { processPortalRequest } from '@rswim/domain-billing';
import { runAutomation } from '@rswim/domain-comms';
import { billingPeriod, billSchool, pendingDomainIds, verifyDomain } from '@rswim/domain-platform';
import { FakeDnsResolver, FakePaymentProvider } from '@rswim/integrations';
import { ACCOUNT_PERSONAS } from '@rswim/db/personas';

const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://rswim:rswim@localhost:5432/postgres';
export const E2E_DB_URL = Object.assign(new URL(ADMIN_URL), { pathname: '/rswim_e2e' }).toString();

async function asWorker<T>(
  fn: (tx: Tx, orgId: string, client: pg.Client) => Promise<T>,
  slug = 'rswim-demo',
): Promise<T> {
  const client = new pg.Client({ connectionString: E2E_DB_URL });
  await client.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string }>(
      `select id from organizations where slug = $1`,
      [slug],
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

/**
 * Turns events of one type into family messages (the worker's `comms-automation` step for those not yet handled),
 * e.g. the escort's taps or a venue move. Returns how many messages were queued.
 */
export function runAutomations(eventType: string) {
  return asWorker(async (tx, orgId, client) => {
    // The outbox is platform plumbing (the relay reads it as the owner); the automation itself runs as the worker.
    await client.query('reset role');
    const { rows } = await client.query<{ id: string; event_type: string; payload: unknown }>(
      `select o.id, o.event_type, o.payload from outbox o
       where o.event_type = $1 and not exists (select 1 from messages m where m.source_event_id = o.id)`,
      [eventType],
    );
    await client.query('set local role rswim_system');
    let queued = 0;
    for (const r of rows) {
      const out = await runAutomation(
        tx,
        { orgId, userId: null },
        { id: r.id, type: r.event_type, payload: r.payload },
      );
      queued += out.queued;
    }
    return queued;
  });
}

/** Removes the schools the newcomer persona opened in an earlier run (the seed does the same). */
export async function resetNewcomer(): Promise<void> {
  const client = new pg.Client({ connectionString: E2E_DB_URL });
  await client.connect();
  try {
    await client.query(
      `delete from organizations where id in (select organization_id from memberships where user_id = $1)`,
      [ACCOUNT_PERSONAS.newcomer.userId],
    );
  } finally {
    await client.end();
  }
}

/** The id of a school by its slug. */
export function orgIdOf(slug: string): Promise<string> {
  return asWorker(async (_tx, orgId) => orgId, slug);
}

/**
 * Checks a school's pending domains (the worker's `platform-check-domain` step) with the demo DNS: a `*.localhost`
 * host answers with its own token, as under RSWIM_DNS_FAKE=1.
 */
export function checkDomains(slug: string): Promise<(string | null)[]> {
  return asWorker(async (tx, _orgId, client) => {
    const dns = new FakeDnsResolver(async (name) => {
      const host = name.replace(/^_rswim\./, '');
      if (!host.endsWith('.localhost')) return [];
      const { rows } = await client.query<{ token: string }>(
        `select token from org_domains where host = $1`,
        [host],
      );
      return rows.map((r) => [`rswim-verify=${r.token}`]);
    });
    const out: (string | null)[] = [];
    for (const id of await pendingDomainIds(tx)) out.push(await verifyDomain(tx, id, dns));
    return out;
  }, slug);
}

/** Bills a school for this month on the fake Grow (the worker's `platform-bill-school` step). */
export function billSchoolNow(slug: string) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());
  return asWorker(
    (tx, orgId) =>
      billSchool(
        tx,
        { orgId, userId: null },
        billingPeriod(today),
        new FakePaymentProvider(),
        today,
      ),
    slug,
  );
}
