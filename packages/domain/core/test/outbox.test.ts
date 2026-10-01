/**
 * Phase 0 acceptance: the outbox delivers a test event exactly once.
 * "Exactly once" here means exactly one EFFECT, even when the relay delivers the same event more than once.
 */
import { randomUUID } from 'node:crypto';
import type { DomainEventEnvelope } from '@rswim/contracts';
import { asUser, sql, type Db, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { emit, recordAudit } from '../src';
import { consumeOnce, relayOnce, type EventSender } from '../src/worker';

let t: TestDatabase;
let db: Db;
let orgId: string;
let parentUserId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  db = t.db;
  const q = async (text: string, params: unknown[] = []) =>
    (await t.pool.query(text, params)).rows[0];
  orgId = (
    await q(`insert into organizations (slug, name) values ('outbox-test', 'בדיקה') returning id`)
  ).id;
  const hh = (
    await q(
      `insert into households (organization_id, display_name) values ($1, 'משפחה') returning id`,
      [orgId],
    )
  ).id;
  const g = (
    await q(
      `insert into guardians (organization_id, household_id, first_name, last_name) values ($1, $2, 'א', 'ב') returning id`,
      [orgId, hh],
    )
  ).id;
  parentUserId = (await q(`insert into auth.users (email) values ('p@example.test') returning id`))
    .id;
  await q(
    `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3) returning id`,
    [orgId, parentUserId, g],
  );
  // Test-only side-effect table, protected like any tenant table.
  await t.pool.query(`
    create table test_effects (
      id uuid primary key default gen_random_uuid(),
      organization_id uuid not null,
      event_id uuid not null,
      message text not null
    );
    alter table test_effects enable row level security;
    grant select, insert on test_effects to rswim_system;
    create policy te on test_effects for all to rswim_system
      using (organization_id = app.current_org()) with check (organization_id = app.current_org());
  `);
});
afterAll(async () => {
  await t.drop();
});
beforeEach(async () => {
  await t.pool.query('truncate outbox, inbox_receipts, dead_letters, test_effects');
});

/** Simulates Inngest: every send is delivered to the consumer. */
function deliveringSender(
  onSend?: (e: DomainEventEnvelope, n: number) => void,
): EventSender & { deliveries: number } {
  const s = {
    deliveries: 0,
    async send(e: DomainEventEnvelope) {
      s.deliveries++;
      await consumeOnce(db, 'test.effect_writer', e, writeEffect);
      onSend?.(e, s.deliveries);
    },
  };
  return s;
}

async function writeEffect(tx: Tx, e: DomainEventEnvelope) {
  await tx.execute(
    sql`insert into test_effects (organization_id, event_id, message) values (${e.organizationId}, ${e.id}, ${String(e.payload.message)})`,
  );
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function pgError(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    const err = e as Error & { cause?: Error };
    return err.cause?.message ?? err.message;
  }
  return 'did not throw';
}

const count = async (table: string) =>
  (await t.pool.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;

describe('outbox exactly-once', () => {
  it('a parent action emits an event in its own transaction, and the relay delivers it once', async () => {
    await asUser(db, { sub: parentUserId, org_id: orgId }, (tx) =>
      emit(tx, {
        organizationId: orgId,
        type: 'core.ping',
        payload: { message: 'שלום' },
        idempotencyKey: 'ping-1',
      }),
    );
    const sender = deliveringSender();
    expect(await relayOnce(db, sender)).toEqual({ dispatched: 1, failed: 0, deadLettered: 0 });
    expect(await relayOnce(db, sender)).toEqual({ dispatched: 0, failed: 0, deadLettered: 0 });
    expect(sender.deliveries).toBe(1);
    expect(await count('test_effects')).toBe(1);
  });

  it('produces one effect when the same event is delivered twice (crash after send, before marking)', async () => {
    await withOrg(db, orgId, (tx) =>
      emit(tx, {
        organizationId: orgId,
        type: 'core.ping',
        payload: { message: 'x' },
        idempotencyKey: 'ping-2',
      }),
    );
    // First relay: the event IS delivered, then the relay "crashes" before it can mark the row.
    const crashing = deliveringSender(() => {
      throw new Error('connection reset after send');
    });
    expect(await relayOnce(db, crashing, { backoffMs: () => 0 })).toMatchObject({ failed: 1 });
    // Second relay redelivers the same event id.
    const sender = deliveringSender();
    expect(await relayOnce(db, sender)).toMatchObject({ dispatched: 1 });

    expect(crashing.deliveries + sender.deliveries).toBe(2);
    expect(await count('test_effects')).toBe(1);
    expect(await count('inbox_receipts')).toBe(1);
  });

  it('keeps one event when a mutation is retried with the same idempotency key', async () => {
    for (let i = 0; i < 3; i++) {
      await withOrg(db, orgId, (tx) =>
        emit(tx, {
          organizationId: orgId,
          type: 'core.ping',
          payload: { message: 'retry' },
          idempotencyKey: 'same',
        }),
      );
    }
    expect(await count('outbox')).toBe(1);
  });

  it('loses nothing when the mutation rolls back: no event is emitted either', async () => {
    await expect(
      withOrg(db, orgId, async (tx) => {
        await emit(tx, {
          organizationId: orgId,
          type: 'core.ping',
          payload: { message: 'x' },
          idempotencyKey: 'rb',
        });
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');
    expect(await count('outbox')).toBe(0);
  });

  it('rolls back the receipt when the consumer fails, so a retry can succeed', async () => {
    const event: DomainEventEnvelope = {
      id: randomUUID(),
      organizationId: orgId,
      type: 'core.ping',
      payload: { message: 'y' },
      idempotencyKey: 'k',
      occurredAt: new Date().toISOString(),
    };
    await expect(
      consumeOnce(db, 'c', event, async () => {
        throw new Error('handler crashed');
      }),
    ).rejects.toThrow('handler crashed');
    expect(await consumeOnce(db, 'c', event, writeEffect)).toBe(true);
    expect(await consumeOnce(db, 'c', event, writeEffect)).toBe(false);
    expect(await count('test_effects')).toBe(1);
  });

  it('retries with backoff and dead-letters after max attempts', async () => {
    await withOrg(db, orgId, (tx) =>
      emit(tx, {
        organizationId: orgId,
        type: 'core.ping',
        payload: { message: 'z' },
        idempotencyKey: 'dlq',
      }),
    );
    const broken: EventSender = {
      async send() {
        throw new Error('inngest down');
      },
    };
    expect(await relayOnce(db, broken, { maxAttempts: 2, backoffMs: () => 0 })).toMatchObject({
      failed: 1,
    });
    expect(await relayOnce(db, broken, { maxAttempts: 2, backoffMs: () => 0 })).toMatchObject({
      deadLettered: 1,
    });
    expect(await relayOnce(db, broken, { maxAttempts: 2 })).toEqual({
      dispatched: 0,
      failed: 0,
      deadLettered: 0,
    });
    const [dl] = (await t.pool.query('select source, error from dead_letters')).rows;
    expect(dl).toEqual({ source: 'outbox', error: 'inngest down' });
  });

  it('waits for the backoff before retrying (default backoff, non-Error failures)', async () => {
    await withOrg(db, orgId, (tx) =>
      emit(tx, {
        organizationId: orgId,
        type: 'core.ping',
        payload: { message: 'w' },
        idempotencyKey: 'bo',
      }),
    );
    const broken: EventSender = {
      async send() {
        throw 'plain string failure';
      },
    };
    expect(await relayOnce(db, broken)).toMatchObject({ failed: 1 });
    expect(await relayOnce(db, broken)).toEqual({ dispatched: 0, failed: 0, deadLettered: 0 });
    const [row] = (
      await t.pool.query(
        `select last_error, available_at > now() + interval '50 seconds' as later from outbox`,
      )
    ).rows;
    expect(row).toEqual({ last_error: 'plain string failure', later: true });
  });

  it('never lets a consumer write into another org', async () => {
    const other = (
      await t.pool.query(
        `insert into organizations (slug, name) values ('other', 'אחר') returning id`,
      )
    ).rows[0].id;
    const event: DomainEventEnvelope = {
      id: randomUUID(),
      organizationId: orgId,
      type: 'core.ping',
      payload: {},
      idempotencyKey: 'x',
      occurredAt: new Date().toISOString(),
    };
    expect(
      await pgError(
        consumeOnce(db, 'evil', event, async (tx) => {
          await tx.execute(
            sql`insert into test_effects (organization_id, event_id, message) values (${other}, ${event.id}, 'x')`,
          );
        }),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('recordAudit', () => {
  it('writes an app-level entry as the signed-in user', async () => {
    await asUser(db, { sub: parentUserId, org_id: orgId }, (tx) =>
      recordAudit(tx, {
        organizationId: orgId,
        actorId: parentUserId,
        action: 'login',
        subjectType: 'session',
      }),
    );
    await withOrg(db, orgId, (tx) =>
      recordAudit(tx, {
        organizationId: orgId,
        actorId: null,
        action: 'job',
        subjectType: 'relay',
        subjectId: '1',
        diff: { n: 1 },
      }),
    );
    const rows = (
      await t.pool.query(
        `select actor_id, action, diff from audit_log where action in ('login', 'job') order by id`,
      )
    ).rows;
    expect(rows).toEqual([
      { actor_id: parentUserId, action: 'login', diff: null },
      { actor_id: null, action: 'job', diff: { n: 1 } },
    ]);
  });
});
