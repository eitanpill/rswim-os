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
    expect(second).toEqual(first);
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
      { weekday: 3, gender_restriction: 'male' },
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
    expect(await rows(`select count(*)::int n from slot_bookings where status = 'booked'`)).toEqual(
      [{ n: 1 }],
    );
  });
});
