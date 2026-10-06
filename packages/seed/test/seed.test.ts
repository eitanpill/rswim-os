import { randomBytes } from 'node:crypto';
import { decryptField, unwrapDataKey } from '@rswim/domain-core';
import { DEMO_ORG, PERSONAS, SECOND_ORG } from '@rswim/db/personas';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedDemo } from '../src/demo';

let t: TestDatabase;
const masterKey = randomBytes(32);

beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.drop();
});

describe('demo seed', () => {
  it('creates both orgs with the brief’s edge cases, and is re-runnable', async () => {
    const first = await seedDemo(t.pool, { masterKey });
    const second = await seedDemo(t.pool, { masterKey });
    expect(JSON.stringify(second, null, 1)).toEqual(JSON.stringify(first, null, 1));
    expect(first.orgs).toBe(2);
    expect(first.households).toBe(25 + 3);
    expect(first.memberships).toBe(6);

    const one = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    expect(
      await one(
        `select count(*)::int n from students where organization_id = $1 and dob = '2018-11-20'`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ n: 2 }]); // twins
    expect(
      await one(`select count(*)::int n from students where custody_pattern = 'alternating_weeks'`),
    ).toEqual([{ n: 1 }]);
    expect(
      await one(`select count(*)::int n from students where requires_female_instructor`),
    ).toEqual([{ n: 2 }]);
    expect(await one(`select count(*)::int n from students where water_fear`)).toEqual([{ n: 1 }]);
    expect(await one(`select count(*)::int n from students where is_self_guardian`)).toEqual([
      { n: 1 },
    ]);
    expect(
      await one(
        `select employment_type from staff_members where organization_id = $1 and first_name = 'אסף'`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ employment_type: 'hybrid' }]);
    expect(
      await one(
        `select count(*)::int n from students s join households h on h.id = s.household_id where h.notes like 'ארבעה ילדים%'`,
      ),
    ).toEqual([{ n: 4 }]);
    expect(
      await one(`select count(*)::int n from organizations where id = $1`, [SECOND_ORG.id]),
    ).toEqual([{ n: 1 }]);
  });

  it('uses only fake 050-000xxxx phone numbers', async () => {
    const rows = (
      await t.pool.query(
        `select phone_e164 from guardians union all select phone_e164 from staff_members`,
      )
    ).rows;
    for (const r of rows) expect(r.phone_e164).toMatch(/^\+9725000\d{5}$/);
  });

  it('stores medical notes encrypted, decryptable only with the org key', async () => {
    const [row] = (
      await t.pool.query(
        `select s.id, s.enc_medical_notes, k.wrapped_dek from students s join org_keys k using (organization_id)
         where s.first_name = 'נועה' and s.water_fear`,
      )
    ).rows;
    expect(row.enc_medical_notes.toString('utf8')).not.toContain('פחד');
    const dek = unwrapDataKey(masterKey, DEMO_ORG.id, row.wrapped_dek);
    expect(
      decryptField(dek, row.enc_medical_notes, {
        table: 'students',
        column: 'enc_medical_notes',
        rowId: row.id,
      }),
    ).toBe('פחד ממים, להתחיל לאט');
  });

  it('links the parent persona to the Cohen household under RLS', async () => {
    const c = await t.pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: PERSONAS.parent.userId, org_id: DEMO_ORG.id }),
      ]);
      await c.query('set local role authenticated');
      const kids = (await c.query('select first_name from students order by first_name')).rows.map(
        (r) => r.first_name,
      );
      expect(kids).toEqual(['יואב', 'נועה']);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('sets up Phase 1 core data: gender windows and two price versions at one venue', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    expect(
      await rows(
        `select w.weekday, w.gender_restriction from venue_operating_windows w join venues v on v.id = w.venue_id
         where v.organization_id = $1 and v.name = 'קאנטרי הדמו - ירושלים' order by w.weekday`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { weekday: 0, gender_restriction: 'mixed' },
      { weekday: 1, gender_restriction: 'female' },
      { weekday: 2, gender_restriction: 'mixed' },
      { weekday: 3, gender_restriction: 'male' },
      { weekday: 4, gender_restriction: 'mixed' },
    ]);
    expect(
      await rows(
        `select l.effective_from::text, l.status, i.amount_agorot from price_lists l
         join price_items i on i.price_list_id = l.id join venues v on v.id = l.venue_id
         where v.organization_id = $1 order by l.effective_from`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { effective_from: '2026-09-01', status: 'published', amount_agorot: 33000 },
      { effective_from: '2027-01-01', status: 'published', amount_agorot: 35000 },
    ]);
    expect(
      await rows(`select count(*)::int n from policy_sets where organization_id = $1`, [
        SECOND_ORG.id,
      ]),
    ).toEqual([{ n: 0 }]); // the second tenant stays bare
  });
  it('sets up Phase 2 scheduling: groups, sessions without Chol HaMoed, a waitlist cluster and a pending change', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    const summary = await seedDemo(t.pool, { masterKey });
    expect(summary.scheduling).toMatchObject({
      groups: 10,
      slots: 4,
      waitlist: 6,
      pendingShiftChanges: 1,
    });
    expect(summary.scheduling?.sessions).toBeGreaterThan(300);
    expect(summary.scheduling?.enrollments).toBeGreaterThan(15);
    expect(
      await rows(
        `select count(*)::int n from sessions where organization_id = $1 and date between '2026-09-27' and '2026-10-03'`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ n: 0 }]); // Sukkot week: Chol HaMoed and the chag days
    // No girl sits in a boys group and no boy in a girls group.
    expect(
      await rows(
        `select count(*)::int n from enrollments e join students s on s.id = e.student_id
         join class_templates c on c.id = e.class_template_id
         where c.admitted_gender <> 'mixed' and c.admitted_gender <> s.gender`,
      ),
    ).toEqual([{ n: 0 }]);
    expect(
      await rows(
        `select s.status, m.first_name from shift_changes s join staff_members m on m.id = s.respondent_staff_id
         where s.organization_id = $1`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ status: 'pending', first_name: 'נועה' }]);
    // Upcoming only: Phase 6 adds two of Asaf's privates last month.
    expect(
      await rows(
        `select count(*)::int n from slot_bookings b join private_slots p on p.id = b.slot_id
         where b.status = 'booked' and p.date >= app.today()`,
      ),
    ).toEqual([{ n: 1 }]);
  });

  it('sets up Phase 3: forms, attendance, notices with credits, a makeup booking and a trial', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    const summary = await seedDemo(t.pool, { masterKey });
    expect(summary.attendance).toMatchObject({
      forms: 3,
      notices: 3,
      credits: 2,
      makeups: 1,
      trials: 1,
    });
    expect(summary.attendance?.marks).toBeGreaterThan(10);
    expect(summary.attendance?.submissions).toBeGreaterThan(10);
    expect(
      await rows(
        `select classification, count(*)::int n from absence_notices where organization_id = $1
         group by classification order by classification`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { classification: 'late_notice', n: 1 },
      { classification: 'timely', n: 2 },
    ]);
    expect(
      await rows(
        `select status, count(*)::int n from makeup_credits where organization_id = $1 group by status order by status`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { status: 'booked', n: 1 },
      { status: 'open', n: 1 },
    ]);
    // The parent persona's household still has forms to accept in the portal.
    expect(
      await rows(
        `select count(*)::int n from form_submissions f join households h on h.id = f.household_id
         where h.display_name like '%כהן%'`,
      ),
    ).toEqual([{ n: 0 }]);
  });
  it('sets up Phase 4: an approved September with payments and a declined card, October waiting for review', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    process.env.RSWIM_MASTER_KEY = masterKey.toString('base64');
    try {
      const summary = await seedDemo(t.pool, { masterKey });
      expect(summary.billing).toMatchObject({ failedCharges: 1, leaving: 3 });
      expect(summary.billing?.payments).toBeGreaterThan(5);
      expect(summary.billing?.receipts).toBeGreaterThan(0);
    } finally {
      delete process.env.RSWIM_MASTER_KEY;
    }
    expect(
      await rows(
        `select period, status from billing_runs where organization_id = $1 order by period`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { period: '2026-09', status: 'posted' },
      { period: '2026-10', status: 'draft' },
    ]);
    const [oct] = await rows(
      `select anomalies from billing_runs where organization_id = $1 and period = '2026-10'`,
      [DEMO_ORG.id],
    );
    const kinds = new Set((oct.anomalies as { kind: string }[]).map((a) => a.kind));
    expect([...kinds].sort()).toEqual(
      expect.arrayContaining([
        'charge_without_enrollment',
        'duplicate_mandate',
        'enrollment_without_charge',
        'missing_mandate',
      ]),
    );
    expect(
      await rows(
        `select status, count(*)::int n from dunning_cases where organization_id = $1 group by status`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ status: 'open', n: 1 }]);
    const [billing] = await rows(
      `select payer_id_last4, enc_payer_national_id is not null as enc from household_billing where organization_id = $1`,
      [DEMO_ORG.id],
    );
    expect(billing).toEqual({ payer_id_last4: '0018', enc: true });
    expect(
      await rows(`select count(*)::int n from enrollment_freezes where status = 'requested'`),
    ).toEqual([{ n: 1 }]);
  });
  it('sets up Phase 5: templates, a WhatsApp inbox, a message held for Shabbat and a scheduled broadcast', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    const summary = await seedDemo(t.pool);
    expect(summary.comms).toMatchObject({ inbound: 3, held: 1, broadcasts: 1 });
    expect(summary.comms?.templates).toBeGreaterThan(30);
    const inbox = await rows(
      `select intent, guardian_id is not null as known from inbound_messages where organization_id = $1
       order by received_at desc`,
      [DEMO_ORG.id],
    );
    expect(inbox).toEqual([
      { intent: 'absence_notice', known: true },
      { intent: 'payment_question', known: true },
      { intent: 'lead', known: false },
    ]);
    expect(
      await rows(`select status, hold_reason from messages where organization_id = $1`, [
        DEMO_ORG.id,
      ]),
    ).toEqual([{ status: 'held', hold_reason: 'rest_window' }]);
    expect(
      await rows(`select status from broadcasts where organization_id = $1`, [DEMO_ORG.id]),
    ).toEqual([{ status: 'scheduled' }]);
  });

  it('sets up Phase 6: last month drafted with a dispute, a substitute offer for Noa and applicants', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    const summary = await seedDemo(t.pool);
    expect(summary.staffops).toMatchObject({ substituteRequests: 1, applicants: 4 });
    expect(summary.staffops?.payrollStaff).toBeGreaterThan(1);
    expect(
      await rows(`select status from payroll_runs where organization_id = $1`, [DEMO_ORG.id]),
    ).toEqual([{ status: 'draft' }]);
    expect(
      await rows(
        `select t.status from timesheets t join staff_members s on s.id = t.staff_member_id
         where t.organization_id = $1 order by s.first_name`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ status: 'confirmed' }, { status: 'disputed' }]); // אסף, דני
    const [hybrid] = await rows(
      `select bool_or(l.routing = 'payslip') payslip, bool_or(l.routing = 'transfer') transfer
       from payroll_lines l join staff_members s on s.id = l.staff_member_id
       where l.organization_id = $1 and s.first_name = 'אסף' and l.kind = 'work'`,
      [DEMO_ORG.id],
    );
    expect(hybrid).toEqual({ payslip: true, transfer: true });
    expect(
      await rows(
        `select o.status from substitute_offers o join staff_members s on s.id = o.staff_member_id
         where o.organization_id = $1 and s.first_name = 'נועה'`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ status: 'offered' }]);
  });
  it('sets up Phase 8: a route with Dani escorting Yoav Cohen, and last week’s run tapped end to end', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    expect(
      await rows(
        `select s.first_name, s.last_name from route_riders r join students s on s.id = r.student_id
         join transport_routes t on t.id = r.route_id
         join staff_members e on e.id = t.escort_staff_id
         where r.organization_id = $1 and e.first_name = 'דני' order by (s.first_name = 'יואב') desc limit 1`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ first_name: 'יואב', last_name: 'כהן' }]);
    expect(
      await rows(
        `select r.status, count(e.*)::int events from route_runs r join run_events e on e.run_id = r.id
         where r.organization_id = $1 group by r.status`,
        [DEMO_ORG.id],
      ),
    ).toEqual([{ status: 'done', events: 12 }]);
  });
  it('sets up Phase 8 courses: a course with its own regulations, a camp week in ratio, a school paying by contract', async () => {
    const rows = async (sql: string, params: unknown[] = []) =>
      (await t.pool.query(sql, params)).rows;
    expect(
      await rows(
        `select c.name, count(distinct e.student_id)::int n from cohorts c
         join class_templates g on g.cohort_id = c.id join enrollments e on e.class_template_id = g.id
         where c.organization_id = $1 group by c.name order by c.name`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { name: 'קורס חנוכה מרוכז', n: 4 },
      { name: 'קייטנת קיץ – שבוע 1', n: 12 },
    ]);
    expect(
      await rows(
        `select i.period, i.status, i.amount_agorot, coalesce(sum(p.amount_agorot), 0)::int paid
         from institution_invoices i left join institution_payments p on p.invoice_id = i.id
         where i.organization_id = $1 group by i.id order by i.period`,
        [DEMO_ORG.id],
      ),
    ).toEqual([
      { period: '2026-09', status: 'issued', amount_agorot: 72000, paid: 36000 },
      { period: '2026-10', status: 'draft', amount_agorot: 72000, paid: 0 },
    ]);
  });
});
