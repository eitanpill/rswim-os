/**
 * Phase 7: a family's own freeze and leave requests from the portal. The family only asks (the database stamps who
 * and when); the worker decides with the office's services, so the same regulations apply. Every person is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, sql, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  askCancellation,
  askFreeze,
  pendingPortalRequests,
  portalRequestsOf,
  processPortalRequest,
  withdrawPortalRequest,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
const users = { parent: '', other: '' };
const seats = { mine: '', theirs: '' };

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const parentCtx = (): ServiceContext => ({ orgId: ctx.orgId, userId: users.parent });
const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const de = toDomainError(e);
    if (de) return de.code;
    throw e;
  }
  return null;
};

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('portal', 'בדיקת פורטל') returning id`,
  );
  const [owner] = await q(
    `insert into auth.users (email) values ('owner@example.test') returning id`,
  );
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    owner.id,
  ]);
  ctx = { orgId: org.id, userId: owner.id };
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכת בדיקה (דמו)') returning id`,
    [ctx.orgId],
  );
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v.id],
  );
  const [p] = await q(
    `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
     values ($1, 'kids', 'group_kids', 'קבוצת ילדים', 45, 6) returning id`,
    [ctx.orgId],
  );
  const [tpl] = await q(
    `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                  duration_min, capacity, effective_from)
     values ($1, 'דולפינים שלישי', $2, $3, $4, 2, '17:00', 45, 6, '2026-08-01') returning id`,
    [ctx.orgId, p.id, v.id, pool.id],
  );
  for (const who of ['parent', 'other'] as const) {
    const [hh] = await q(
      `insert into households (organization_id, display_name) values ($1, $2) returning id`,
      [ctx.orgId, `משפחת ${who} (דמו)`],
    );
    const [g] = await q(
      `insert into guardians (organization_id, household_id, first_name, last_name)
       values ($1, $2, 'הורה', 'דמו') returning id`,
      [ctx.orgId, hh.id],
    );
    const [u] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${who}@example.test`,
    ]);
    users[who] = u.id;
    await q(
      `insert into memberships (organization_id, user_id, role, guardian_id) values ($1, $2, 'parent', $3)`,
      [ctx.orgId, u.id, g.id],
    );
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, 'ילדה', 'דמו', 'female', '2017-01-01') returning id`,
      [ctx.orgId, hh.id],
    );
    const [e] = await q(
      `insert into enrollments (organization_id, student_id, class_template_id, status, starts_on)
       values ($1, $2, $3, 'active', '2026-08-01') returning id`,
      [ctx.orgId, s.id, tpl.id],
    );
    seats[who === 'parent' ? 'mine' : 'theirs'] = e.id;
  }
});
afterAll(async () => {
  await t.drop();
});

describe('a family asks; the worker decides with the office’s rules', () => {
  let freezeRequest = '';

  it('a freeze request is stamped by the database and queued for the worker', async () => {
    freezeRequest = await as('parent', (tx) =>
      askFreeze(tx, parentCtx(), {
        enrollmentId: seats.mine,
        fromDate: '2026-11-01',
        toDate: '2026-11-30',
        reason: 'vacation',
        note: 'טיול משפחתי',
      }),
    );
    const [row] = await q(`select * from portal_requests where id = $1`, [freezeRequest]);
    expect(row).toMatchObject({ status: 'pending', requested_by: users.parent, kind: 'freeze' });
    const events = await q(
      `select payload from outbox where event_type = 'billing.portal_request_created'`,
    );
    expect(events.map((e: { payload: { requestId: string } }) => e.payload.requestId)).toContain(
      freezeRequest,
    );
    // The same kind of request cannot be asked twice while one waits.
    expect(
      await code(
        as('parent', (tx) =>
          askFreeze(tx, parentCtx(), {
            enrollmentId: seats.mine,
            fromDate: '2026-12-01',
            toDate: '2026-12-10',
            reason: 'medical',
          }),
        ),
      ),
    ).toBe('parent.requests.errors.alreadyPending');
  });

  it('a family cannot forge who asked, when, or the outcome', async () => {
    await as('parent', (tx) =>
      tx.execute(sql`insert into portal_requests
        (organization_id, enrollment_id, kind, requested_at, requested_by, status, processed_at)
        values (${ctx.orgId}, ${seats.mine}, 'cancellation', '2026-01-01T00:00:00Z', ${users.other}, 'done', now())`),
    );
    const [row] = await q(
      `select * from portal_requests where kind = 'cancellation' and enrollment_id = $1`,
      [seats.mine],
    );
    expect(row.status).toBe('pending');
    expect(row.requested_by).toBe(users.parent);
    expect(row.processed_at).toBeNull();
    expect(Date.now() - new Date(row.requested_at).getTime()).toBeLessThan(60_000);
    // Nor mark it done themselves.
    expect(
      await code(
        as('parent', (tx) =>
          tx.execute(sql`update portal_requests set status = 'done' where id = ${row.id}`),
        ),
      ),
    ).toBe('parent.requests.errors.notPending');
    await q(`delete from portal_requests where id = $1`, [row.id]);
  });

  it('the worker records the freeze with the office’s service (approval as the policy says)', async () => {
    const out = await system((tx) =>
      processPortalRequest(tx, { orgId: ctx.orgId, userId: null }, freezeRequest),
    );
    expect(out).toMatchObject({ status: 'done', kind: 'freeze' });
    const [row] = await q(`select * from portal_requests where id = $1`, [freezeRequest]);
    const [freeze] = await q(
      `select from_date::text, to_date::text, reason, requested_by from enrollment_freezes where id = $1`,
      [row.freeze_id],
    );
    expect(freeze).toMatchObject({
      from_date: '2026-11-01',
      to_date: '2026-11-30',
      reason: 'vacation',
    });
    expect(freeze.requested_by).toBe(users.parent);
    // Processing again changes nothing.
    expect(
      await system((tx) =>
        processPortalRequest(tx, { orgId: ctx.orgId, userId: null }, freezeRequest),
      ),
    ).toBeNull();
  });

  it('a request to leave is decided by the moment the family asked', async () => {
    const id = await as('parent', (tx) =>
      askCancellation(tx, parentCtx(), { enrollmentId: seats.mine, note: 'עוברים דירה' }),
    );
    const out = await system((tx) =>
      processPortalRequest(tx, { orgId: ctx.orgId, userId: null }, id),
    );
    expect(out).toMatchObject({ status: 'done', kind: 'cancellation' });
    const [row] = await q(`select * from portal_requests where id = $1`, [id]);
    const [c] = await q(`select * from cancellation_requests where id = $1`, [row.cancellation_id]);
    expect(
      Math.abs(new Date(c.requested_at).getTime() - new Date(row.requested_at).getTime()),
    ).toBeLessThan(60_000);
    expect(c.last_charged_period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('a request the rules refuse is stored with the reason, for the family to read', async () => {
    const id = await as('parent', (tx) =>
      askCancellation(tx, parentCtx(), { enrollmentId: seats.mine }),
    );
    const out = await system((tx) =>
      processPortalRequest(tx, { orgId: ctx.orgId, userId: null }, id),
    );
    expect(out?.status).toBe('refused');
    const mine = await as('parent', (tx) => portalRequestsOf(tx, [seats.mine]));
    const refused = mine.find((r) => r.id === id);
    expect(refused?.status).toBe('refused');
    expect((refused?.error as { code: string }).code).toMatch(/\./);
    // Only one cancellation was recorded.
    expect(await q(`select count(*)::int n from cancellation_requests`)).toEqual([{ n: 1 }]);
  });

  it('a pending request can be withdrawn by the family; a decided one cannot', async () => {
    const id = await as('parent', (tx) =>
      askFreeze(tx, parentCtx(), {
        enrollmentId: seats.mine,
        fromDate: '2027-01-01',
        toDate: '2027-01-15',
        reason: 'medical',
      }),
    );
    expect(await system((tx) => pendingPortalRequests(tx))).toHaveLength(1);
    await as('parent', (tx) => withdrawPortalRequest(tx, id));
    expect(await system((tx) => pendingPortalRequests(tx))).toHaveLength(0);
    expect(await code(as('parent', (tx) => withdrawPortalRequest(tx, id)))).toBe(
      'parent.requests.errors.notPending',
    );
  });

  it('another family sees none of it and cannot ask for a seat that is not theirs', async () => {
    expect(await as('other', (tx) => portalRequestsOf(tx, [seats.mine]))).toEqual([]);
    expect(
      await code(
        as('other', (tx) =>
          askCancellation(
            tx,
            { orgId: ctx.orgId, userId: users.other },
            { enrollmentId: seats.mine },
          ),
        ),
      ),
    ).toBe('common.errors.forbidden');
  });
});
