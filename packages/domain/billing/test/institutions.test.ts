/**
 * Phase 8 courses, camps and institutions at the service level, against a real database with RLS:
 * - an intensive course meets twice a week, a child registers once and the month's bill charges its package once;
 *   the course has its own regulations (program policy), capacity and closing date;
 * - a camp week refuses a child beyond its staff ratio until a counselor is added;
 * - an institution's contract pays for a group: the family is not billed for it, the month's invoice comes from the
 *   roster, the worker prints the tax invoice, a partial payment leaves it open and the rest pays it (with receipts);
 * - the accountant reads institutions, an instructor does not.
 * Every person, institution and amount is fake.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  attachContractGroup,
  contractMonthReport,
  createContract,
  createInstitution,
  draftInstitutionInvoice,
  issueInstitutionInvoice,
  listInstitutionInvoices,
  listInstitutions,
  printInstitutionInvoice,
  printInstitutionReceipt,
  recordInstitutionPayment,
} from '@rswim/domain-institutions';
import {
  addCohortStaff,
  attachGroup,
  cancelRegistration,
  createCohort,
  getCohort,
  listCohorts,
  registerToCohort,
} from '@rswim/domain-scheduling';
import { FakeInvoicingProvider } from '@rswim/integrations';
import { draftRun } from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
const users = { accountant: '', instructor: '' };
const kids: string[] = [];
const ids = {
  venue: '',
  pool: '',
  course: '',
  camp: '',
  kidsProgram: '',
  staffA: '',
  staffB: '',
  courseSun: '',
  courseTue: '',
  campDays: [] as string[],
  schoolGroup: '',
};

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
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

async function group(name: string, programId: string, weekday: number, staffId: string | null) {
  const [g] = await q(
    `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                  duration_min, capacity, effective_from, lead_staff_id)
     values ($1, $2, $3, $4, $5, $6, '10:00', 45, 30, '2026-09-01', $7) returning id`,
    [ctx.orgId, name, programId, ids.venue, ids.pool, weekday, staffId],
  );
  return g.id as string;
}

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('cohorts', 'שחייה דמו') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  for (const [i, first] of ['אסף', 'ליה'].entries()) {
    const [s] = await q(
      `insert into staff_members (organization_id, first_name, last_name, gender, employment_type)
       values ($1, $2, 'דמו', 'female', 'employee') returning id`,
      [ctx.orgId, first],
    );
    if (i === 0) ids.staffA = s.id;
    else ids.staffB = s.id;
  }
  for (const [key, role, staff, perms] of [
    ['accountant', 'accountant', null, ['billing.read']],
    ['instructor', 'instructor', ids.staffA, []],
  ] as const) {
    const [usr] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = usr.id;
    await q(
      `insert into memberships (organization_id, user_id, role, staff_member_id, permissions)
       values ($1, $2, $3, $4, $5)`,
      [ctx.orgId, usr.id, role, staff, perms],
    );
  }
  const [h] = await q(
    `insert into households (organization_id, display_name) values ($1, 'משפחת דמו') returning id`,
    [ctx.orgId],
  );
  for (let i = 0; i < 12; i++) {
    const [s] = await q(
      `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
       values ($1, $2, $3, 'דמו', 'female', '2017-01-01') returning id`,
      [ctx.orgId, h.id, `ילדה ${i + 1}`],
    );
    kids.push(s.id);
  }
  const [v] = await q(
    `insert into venues (organization_id, name) values ($1, 'בריכת דמו') returning id`,
    [ctx.orgId],
  );
  ids.venue = v.id;
  const [pool] = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
    [ctx.orgId, v.id],
  );
  ids.pool = pool.id;
  for (const [key, codeName, kind, name] of [
    ['course', 'course', 'intensive_course', 'קורס מרוכז'],
    ['camp', 'camp', 'camp', 'קייטנה'],
    ['kidsProgram', 'kids', 'group_kids', 'קבוצות ילדים'],
  ] as const) {
    const [p] = await q(
      `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
       values ($1, $2, $3, $4, 45, 30) returning id`,
      [ctx.orgId, codeName, kind, name],
    );
    ids[key] = p.id;
  }
  // The course's own regulations: no makeups (a program-scoped policy version).
  await q(
    `insert into policy_sets (organization_id, scope_type, program_id, effective_from, rules)
     values ($1, 'program', $2, '2026-06-01', '{"makeup": {"enabled": false}}')`,
    [ctx.orgId, ids.course],
  );
  const [list] = await q(
    `insert into price_lists (organization_id, name, effective_from, status) values ($1, 'מחירון', '2026-01-01', 'draft') returning id`,
    [ctx.orgId],
  );
  await q(
    `insert into price_items (organization_id, price_list_id, program_id, kind, amount_agorot)
     values ($1, $2, $3, 'package', 80000), ($1, $2, $4, 'monthly', 30000)`,
    [ctx.orgId, list.id, ids.course, ids.kidsProgram],
  );
  await q(`update price_lists set status = 'published' where id = $1`, [list.id]);

  ids.courseSun = await group('קורס ראשון', ids.course, 0, ids.staffA);
  ids.courseTue = await group('קורס שלישי', ids.course, 2, ids.staffA);
  for (const d of [0, 1, 2, 3, 4])
    ids.campDays.push(await group(`קייטנה ${d}`, ids.camp, d, ids.staffB));
  ids.schoolGroup = await group('בית ספר אופק', ids.kidsProgram, 1, ids.staffA);
  // Last month's lessons for the school group (the institution's attendance report), one cancelled.
  for (const [date, status] of [
    ['2026-09-07', 'completed'],
    ['2026-09-14', 'completed'],
    ['2026-09-21', 'cancelled_by_school'],
    ['2026-09-28', 'completed'],
  ] as const) {
    await q(
      `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at, status)
       values ($1, $2, $3, $4, ($4::date + time '10:00') at time zone 'Asia/Jerusalem',
               ($4::date + time '10:45') at time zone 'Asia/Jerusalem', $5)`,
      [ctx.orgId, ids.schoolGroup, ids.venue, date, status],
    );
  }
});

afterAll(async () => {
  await t.drop();
});

describe('an intensive course: fixed cohort, twice a week, its own regulations', () => {
  let cohortId = '';

  it('registers a child into both weekly groups, once', async () => {
    cohortId = await owner((tx) =>
      createCohort(tx, ctx, {
        name: 'קורס חנוכה',
        programId: ids.course,
        startsOn: '2026-12-06',
        endsOn: '2026-12-29',
        capacity: 2,
        registrationClosesOn: '2026-12-01',
      }),
    );
    expect(
      await code(owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[0]! }))),
    ).toBe('scheduling.cohort.noGroups');
    await owner((tx) => attachGroup(tx, { cohortId, classTemplateId: ids.courseSun }));
    await owner((tx) => attachGroup(tx, { cohortId, classTemplateId: ids.courseTue }));
    expect(
      await code(owner((tx) => attachGroup(tx, { cohortId, classTemplateId: ids.schoolGroup }))),
    ).toBe('scheduling.cohort.programMismatch');
    await owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[0]! }));
    expect(
      await q(
        `select class_template_id, starts_on::text, ends_on::text, source from enrollments where student_id = $1 order by class_template_id = $2`,
        [kids[0], ids.courseTue],
      ),
    ).toEqual([
      {
        class_template_id: ids.courseSun,
        starts_on: '2026-12-06',
        ends_on: '2026-12-30',
        source: 'cohort',
      },
      {
        class_template_id: ids.courseTue,
        starts_on: '2026-12-06',
        ends_on: '2026-12-30',
        source: 'cohort',
      },
    ]);
    expect(
      await code(owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[0]! }))),
    ).toBe('scheduling.cohort.alreadyRegistered');
    const [summary] = await owner((tx) => listCohorts(tx, [cohortId]));
    expect(summary).toMatchObject({ registered: 1, ownPolicyFrom: '2026-06-01' });
    expect(summary?.ratio.explanation.code).toBe('scheduling.cohort.noRatio');
  });

  it('stops at capacity, and a cancellation before the start frees the seat', async () => {
    await owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[1]! }));
    expect(
      await code(owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[2]! }))),
    ).toBe('scheduling.cohort.full');
    await owner((tx) => cancelRegistration(tx, ctx, { cohortId, studentId: kids[1]! }));
    expect(
      await q(`select count(*)::int n from enrollments where student_id = $1`, [kids[1]]),
    ).toEqual([{ n: 0 }]);
    await owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[2]! }));
  });

  it('bills the course package once per child, not once per weekly group', async () => {
    await owner((tx) => draftRun(tx, ctx, '2026-12'));
    const lines = await q(
      `select student_id, kind, amount_agorot from billing_run_lines where kind = 'package' order by student_id`,
    );
    expect(lines).toHaveLength(2);
    expect(lines.every((l: { amount_agorot: number }) => l.amount_agorot === 80000)).toBe(true);
  });

  it('prints a roster with each child’s guardians and the lesson days', async () => {
    const view = await owner((tx) => getCohort(tx, cohortId));
    expect(view?.roster.map((r) => r.studentId).sort()).toEqual([kids[0], kids[2]].sort());
    expect(view?.groups.map((g) => g.weekday).sort()).toEqual([0, 2]);
  });
});

describe('a camp week keeps its staff ratio', () => {
  it('refuses the fifth child with one staff member at four per staff, until a counselor joins', async () => {
    // The camp's own regulations: four children per staff member.
    await q(
      `insert into policy_sets (organization_id, scope_type, program_id, effective_from, rules)
       values ($1, 'program', $2, '2026-06-01', '{"camp": {"children_per_staff": 4}}')`,
      [ctx.orgId, ids.camp],
    );
    const cohortId = await owner((tx) =>
      createCohort(tx, ctx, {
        name: 'קייטנה שבוע 1',
        programId: ids.camp,
        startsOn: '2027-07-04',
        endsOn: '2027-07-08',
        capacity: 30,
      }),
    );
    for (const g of ids.campDays) {
      await owner((tx) => attachGroup(tx, { cohortId, classTemplateId: g }));
    }
    for (const k of kids.slice(0, 4)) {
      await owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: k }));
    }
    const refused = await owner(async (tx) => {
      try {
        await registerToCohort(tx, ctx, { cohortId, studentId: kids[4]! });
        return null;
      } catch (e) {
        return toDomainError(e);
      }
    });
    expect(refused?.code).toBe('scheduling.cohort.ratio');
    expect(refused?.params).toEqual({ staff: 1, needed: 2, ratio: 4, max: 4 });
    await owner((tx) =>
      addCohortStaff(tx, ctx, { cohortId, staffMemberId: ids.staffA, role: 'מדריכה' }),
    );
    await owner((tx) => registerToCohort(tx, ctx, { cohortId, studentId: kids[4]! }));
    const [summary] = await owner((tx) => listCohorts(tx, [cohortId]));
    expect(summary?.ratio).toMatchObject({ needed: 2, max: 8, short: false });
  });
});

describe('an institution pays for a group by contract', () => {
  let contractId = '';
  let invoiceId = '';
  const invoicing = new FakeInvoicingProvider();

  it('keeps the group off the family’s bill and invoices the institution from the roster', async () => {
    for (const k of kids.slice(5, 8)) {
      await q(
        `insert into enrollments (organization_id, student_id, class_template_id, status, starts_on)
         values ($1, $2, $3, 'active', '2026-09-01')`,
        [ctx.orgId, k, ids.schoolGroup],
      );
    }
    const institutionId = await owner((tx) =>
      createInstitution(tx, ctx, {
        name: 'בית ספר אופק (דמו)',
        kind: 'school',
        taxId: '500000000',
        contactName: 'מזכירות',
        contactEmail: 'office@example.test',
      }),
    );
    contractId = await owner((tx) =>
      createContract(tx, ctx, {
        institutionId,
        name: 'שחייה לכיתות ג׳',
        startsOn: '2026-09-01',
        endsOn: '2027-06-30',
        pricing: 'per_child_month',
        amountAgorot: 12000,
        paymentTermsDays: 30,
      }),
    );
    await owner((tx) =>
      attachContractGroup(tx, ctx, { contractId, classTemplateId: ids.schoolGroup }),
    );

    await owner((tx) => draftRun(tx, ctx, '2026-09'));
    expect(
      await q(
        `select count(*)::int n from billing_run_lines where enrollment_id in
               (select id from enrollments where class_template_id = $1)`,
        [ids.schoolGroup],
      ),
    ).toEqual([{ n: 0 }]);

    const report = await owner((tx) => contractMonthReport(tx, contractId, '2026-09'));
    expect(report?.roster).toHaveLength(3);
    expect(report?.lessons.map((l) => l.status)).toContain('cancelled_by_school');

    invoiceId = await owner((tx) =>
      draftInstitutionInvoice(tx, ctx, { contractId, period: '2026-09' }),
    );
    const [inv] = await owner((tx) => listInstitutionInvoices(tx, { ids: [invoiceId] }));
    expect(inv).toMatchObject({ amountAgorot: 36000, status: 'draft' });
    expect(inv?.explanation).toEqual({
      code: 'institutions.decision.per_child_month',
      params: { count: 3, rate: 12000, amount: 36000, cancelled: 1 },
    });
  });

  it('prints the tax invoice once issued, and tracks partial and full payment with receipts', async () => {
    await owner((tx) => issueInstitutionInvoice(tx, ctx, invoiceId));
    expect(
      await code(
        owner((tx) =>
          recordInstitutionPayment(tx, ctx, {
            invoiceId,
            amountAgorot: 1000,
            paidOn: '2026-10-05',
            method: 'bank_transfer',
          }),
        ),
      ),
    ).toBe('institutions.errors.notIssued');
    const number = await system((tx) =>
      printInstitutionInvoice(tx, { orgId: ctx.orgId, userId: null }, invoicing, invoiceId),
    );
    expect(number).toBeTruthy();
    expect(invoicing.issued.at(-1)).toMatchObject({
      kind: 'tax_invoice',
      client: { name: 'בית ספר אופק (דמו)', nationalId: '500000000' },
      lines: [{ quantity: 3, amount: 12000 }],
    });
    const pay = (amount: number) =>
      owner((tx) =>
        recordInstitutionPayment(tx, ctx, {
          invoiceId,
          amountAgorot: amount,
          paidOn: '2026-10-05',
          method: 'bank_transfer',
          reference: 'העברה 123',
        }),
      );
    const first = await pay(20000);
    let [inv] = await owner((tx) => listInstitutionInvoices(tx, { ids: [invoiceId] }));
    expect(inv?.balance).toMatchObject({
      paidAgorot: 20000,
      balanceAgorot: 16000,
      state: 'partial',
    });
    expect(await code(pay(20000))).toBe('institutions.errors.overpaid');
    await pay(16000);
    [inv] = await owner((tx) => listInstitutionInvoices(tx, { ids: [invoiceId] }));
    expect(inv).toMatchObject({ status: 'paid', balance: { state: 'paid', balanceAgorot: 0 } });
    await system((tx) =>
      printInstitutionReceipt(tx, { orgId: ctx.orgId, userId: null }, invoicing, first),
    );
    expect(invoicing.issued.at(-1)).toMatchObject({ kind: 'receipt' });
    expect(
      await code(
        owner((tx) => draftInstitutionInvoice(tx, ctx, { contractId, period: '2026-09' })),
      ),
    ).toBe('institutions.errors.issued');
  });

  it('lets the accountant read institutions, not an instructor', async () => {
    expect(await as('accountant', (tx) => listInstitutions(tx))).toHaveLength(1);
    expect(await as('accountant', (tx) => listInstitutionInvoices(tx))).toHaveLength(1);
    expect(await as('instructor', (tx) => listInstitutions(tx))).toHaveLength(0);
  });
});
