/** Households, guardians and students as the signed-in owner: search, intake, CRM events, relations. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asUser, type Tx } from '@rswim/db';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  addStudent,
  createHousehold,
  getHousehold,
  GuardianInput,
  relateStudents,
  searchHouseholds,
  StudentInput,
  unrelateStudents,
  updateGuardian,
} from '../src/services';

let t: TestDatabase;
let ctx: ServiceContext;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);

beforeAll(async () => {
  t = await createTestDatabase();
  const q = async (text: string, params: unknown[] = []) =>
    (await t.pool.query(text, params)).rows[0];
  const orgId = (
    await q(`insert into organizations (slug, name) values ('p', 'בדיקה') returning id`)
  ).id;
  const userId = (await q(`insert into auth.users (email) values ('o@example.test') returning id`))
    .id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    orgId,
    userId,
  ]);
  ctx = { orgId, userId };
});
afterAll(async () => {
  await t.drop();
});

const guardian = (over: Record<string, unknown> = {}) =>
  GuardianInput.parse({ firstName: 'מיכל', lastName: 'כהן', phoneE164: '050-000-0106', ...over });
const student = (firstName: string, dob: string) =>
  StudentInput.parse({
    firstName,
    lastName: 'כהן',
    dob,
    gender: 'female',
    levelId: '',
    preferredStaffId: '',
  });

describe('families', () => {
  let householdId: string;
  let guardianId: string;

  it('needs a phone or an email for a guardian', () => {
    const r = GuardianInput.safeParse({ firstName: 'א', lastName: 'ב', phoneE164: '', email: '' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toBe('people.errors.contactRequired');
  });

  it('creates a family with its billing guardian and queues a CRM push', async () => {
    ({ householdId, guardianId } = await owner((tx) =>
      createHousehold(
        tx,
        ctx,
        { displayName: 'משפחת כהן', preferredLocale: 'he', notes: null },
        guardian(),
      ),
    ));
    const family = await owner((tx) => getHousehold(tx, householdId));
    expect(family?.guardians).toMatchObject([
      { phoneE164: '+972500000106', isBillingContact: true },
    ]);
    await owner((tx) =>
      updateGuardian(tx, ctx, guardianId, guardian({ email: 'michal@example.test' })),
    );
    const { rows } = await t.pool.query(
      `select payload->>'source' as source from outbox where event_type = 'people.guardian_upserted' and payload->>'guardianId' = $1`,
      [guardianId],
    );
    expect(rows.map((r) => r.source)).toEqual(['os', 'os']);
  });

  it('finds the family by its name, a guardian’s phone or a child’s name', async () => {
    await owner((tx) => addStudent(tx, ctx, householdId, student('נועה', '2018-03-01')));
    for (const q of ['כהן', '0500000106', 'נועה', '']) {
      const found = await owner((tx) => searchHouseholds(tx, q));
      expect(found.map((h) => h.id)).toContain(householdId);
    }
    expect(await owner((tx) => searchHouseholds(tx, 'אין כזה'))).toEqual([]);
  });

  it('records siblings once per pair, in either order, and refuses a self relation', async () => {
    const a = await owner((tx) => addStudent(tx, ctx, householdId, student('יואב', '2020-05-01')));
    const family = await owner((tx) => getHousehold(tx, householdId));
    const b = family?.students.find((s) => s.firstName === 'נועה')?.id as string;
    await owner((tx) => relateStudents(tx, ctx, a, b, 'sibling'));
    await owner((tx) => relateStudents(tx, ctx, b, a, 'sibling'));
    expect((await owner((tx) => getHousehold(tx, householdId)))?.relations).toHaveLength(1);
    await expect(owner((tx) => relateStudents(tx, ctx, a, a, 'sibling'))).rejects.toBeInstanceOf(
      DomainError,
    );
    await owner((tx) => unrelateStudents(tx, b, a, 'sibling'));
    expect((await owner((tx) => getHousehold(tx, householdId)))?.relations).toHaveLength(0);
  });

  it('reports a missing guardian as not found', async () => {
    await expect(
      owner((tx) => updateGuardian(tx, ctx, '00000000-0000-0000-0000-000000000000', guardian())),
    ).rejects.toMatchObject({ code: 'common.errors.notFound' });
  });
});
