/**
 * Phase 6 acceptance criterion 1 at the service level, against a real database with RLS: a hybrid instructor's month
 * of real lessons (group sessions held, booked private slots) becomes a payslip part and a transfer part that match
 * the hand calculation to the agora. Plus the month-end timesheet (confirm, dispute, resolve), approval locking the
 * run, sick-leave accrual, pension status, the accountant's XLSX and who may read what. Every person is fake.
 */
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { asUser, type Tx } from '@rswim/db';
import { withOrg } from '@rswim/db/service';
import { createTestDatabase, type TestDatabase } from '@rswim/db/testing';
import { toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  addAdjustment,
  answerTimesheet,
  approvePayrollRun,
  draftPayrollRun,
  getPayrollRun,
  listTimesheets,
  myStatements,
  payrollWorkbook,
  previousPeriod,
  recordSickDay,
  resolveTimesheet,
  sickBalances,
  staffMonth,
  type ExportLabels,
} from '../src';

let t: TestDatabase;
let ctx: ServiceContext;
let period = '';
const staff = { asaf: '', noa: '' };
const users = { asaf: '', noa: '', accountant: '' };

const q = async (text: string, params: unknown[] = []) => (await t.pool.query(text, params)).rows;
const owner = <T>(fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: ctx.userId as string, org_id: ctx.orgId }, fn);
const as = <T>(who: keyof typeof users, fn: (tx: Tx) => Promise<T>) =>
  asUser(t.db, { sub: users[who], org_id: ctx.orgId }, fn);
const system = <T>(fn: (tx: Tx) => Promise<T>) => withOrg(t.db, ctx.orgId, fn);
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    const de = toDomainError(e);
    if (de) return de.code;
    throw e;
  }
  return null;
};

const labels: ExportLabels = {
  payslipSheet: 'תלוש',
  transferSheet: 'העברות',
  columns: {
    staff: 'עובד',
    employment: 'העסקה',
    date: 'תאריך',
    item: 'פריט',
    quantity: 'כמות',
    amount: 'סכום',
    total: 'סה״כ',
    pension: 'פנסיה',
    sick: 'מחלה',
  },
  line: (l) => `${l.kind}:${l.description}`,
  employment: (x) => x,
  pension: (p) => (p.eligible ? 'זכאי' : `${p.continuousMonths}`),
  sickDays: (n) => `${n / 2}`,
};

beforeAll(async () => {
  t = await createTestDatabase();
  const [org] = await q(
    `insert into organizations (slug, name) values ('payroll', 'שחייה דמו') returning id`,
  );
  const [u] = await q(`insert into auth.users (email) values ('owner@example.test') returning id`);
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'owner')`, [
    org.id,
    u.id,
  ]);
  ctx = { orgId: org.id, userId: u.id };
  await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2025-01-01', $2)`,
    [ctx.orgId, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  const [today] = await q(`select app.today()::text as d`);
  period = previousPeriod((today.d as string).slice(0, 7));

  for (const [key, first, gender, type] of [
    ['asaf', 'אסף', 'male', 'hybrid'],
    ['noa', 'נועה', 'female', 'employee'],
  ] as const) {
    const [s] = await q(
      `insert into staff_members (organization_id, first_name, last_name, gender, employment_type)
       values ($1, $2, 'דמו', $3, $4) returning id`,
      [ctx.orgId, first, gender, type],
    );
    staff[key] = s.id;
    const [su] = await q(`insert into auth.users (email) values ($1) returning id`, [
      `${key}@example.test`,
    ]);
    users[key] = su.id;
    await q(
      `insert into memberships (organization_id, user_id, role, staff_member_id) values ($1, $2, 'instructor', $3)`,
      [ctx.orgId, su.id, s.id],
    );
  }
  const [acc] = await q(
    `insert into auth.users (email) values ('accountant@example.test') returning id`,
  );
  users.accountant = acc.id;
  await q(
    `insert into memberships (organization_id, user_id, role) values ($1, $2, 'accountant')`,
    [ctx.orgId, acc.id],
  );

  const venue = async (name: string) => {
    const [v] = await q(`insert into venues (organization_id, name) values ($1, $2) returning id`, [
      ctx.orgId,
      name,
    ]);
    const [p] = await q(
      `insert into pools (organization_id, venue_id, name) values ($1, $2, 'ראשית') returning id`,
      [ctx.orgId, v.id],
    );
    return { id: v.id as string, pool: p.id as string };
  };
  const gush = await venue('גוש עציון (דמו)');
  const jlm = await venue('ירושלים (דמו)');
  const program = async (code: string, kind: string, name: string) => {
    const [p] = await q(
      `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
       values ($1, $2, $3, $4, 45, 6) returning id`,
      [ctx.orgId, code, kind, name],
    );
    return p.id as string;
  };
  const kidsProgram = await program('kids', 'group_kids', 'קבוצת ילדים');
  const privateProgram = await program('private', 'private', 'פרטי');

  // Asaf: groups ₪90/hour on the payslip with ₪15 travel a day; privates ₪120 a lesson by transfer.
  // Noa: ₪85/hour on the payslip for anything.
  const rule = (
    s: string,
    basis: string,
    amount: number,
    routing: string,
    programId: string | null,
    travel = 0,
  ) =>
    q(
      `insert into pay_rules (organization_id, staff_member_id, basis, amount_agorot, routing, program_id,
                              travel_allowance_agorot, effective_from)
       values ($1, $2, $3, $4, $5, $6, $7, '2025-01-01')`,
      [ctx.orgId, s, basis, amount, routing, programId, travel],
    );
  await rule(staff.asaf, 'per_hour', 9000, 'payslip', kidsProgram, 1500);
  await rule(staff.asaf, 'per_session', 12000, 'transfer', privateProgram);
  await rule(staff.noa, 'per_hour', 8500, 'payslip', null);

  const template = async (name: string) => {
    const [tpl] = await q(
      `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                    duration_min, capacity, effective_from)
       values ($1, $2, $3, $4, $5, 2, '16:00', 45, 6, '2025-01-01') returning id`,
      [ctx.orgId, name, kidsProgram, gush.id, gush.pool],
    );
    return tpl.id as string;
  };
  const dolphins = await template('בנים דולפין');
  const sharks = await template('בנות כריש');
  const session = async (
    tpl: string,
    day: string,
    from: string,
    to: string,
    who: string,
    status = 'scheduled',
  ) => {
    const date = `${period}-${day}`;
    const [s] = await q(
      `insert into sessions (organization_id, class_template_id, venue_id, date, starts_at, ends_at, status)
       values ($1, $2, $3, $4::date, ($4::date + $5::time) at time zone 'Asia/Jerusalem',
               ($4::date + $6::time) at time zone 'Asia/Jerusalem', $7) returning id`,
      [ctx.orgId, tpl, gush.id, date, from, to, status],
    );
    await q(
      `insert into session_staff (organization_id, session_id, staff_member_id, role) values ($1, $2, $3, 'lead')`,
      [ctx.orgId, s.id, who],
    );
  };
  await session(dolphins, '06', '16:00', '16:45', staff.asaf); // 67.50
  await session(sharks, '06', '16:45', '17:30', staff.asaf); // 67.50
  await session(dolphins, '13', '16:00', '16:50', staff.asaf); // 75.00
  await session(dolphins, '20', '16:00', '16:45', staff.asaf, 'cancelled_by_school'); // not taught: nothing
  await session(sharks, '20', '16:00', '16:40', staff.noa); // Noa: 40 min × ₪85 = 56.67

  const [h] = await q(
    `insert into households (organization_id, display_name) values ($1, 'משפחת דמו') returning id`,
    [ctx.orgId],
  );
  const [kid] = await q(
    `insert into students (organization_id, household_id, first_name, last_name, gender, dob)
     values ($1, $2, 'יונתן', 'דמו', 'male', '2017-01-01') returning id`,
    [ctx.orgId, h.id],
  );
  const slot = async (
    day: string,
    v: { id: string; pool: string },
    from: string,
    booked: boolean,
  ) => {
    const date = `${period}-${day}`;
    const [p] = await q(
      `insert into private_slots (organization_id, staff_member_id, venue_id, pool_id, program_id, kind, date,
                                  starts_at, ends_at, capacity)
       values ($1, $2, $3, $4, $5, 'private', $6::date, ($6::date + $7::time) at time zone 'Asia/Jerusalem',
               ($6::date + $7::time + interval '30 minutes') at time zone 'Asia/Jerusalem', 1) returning id`,
      [ctx.orgId, staff.asaf, v.id, v.pool, privateProgram, date, from],
    );
    if (booked) {
      await q(
        `insert into slot_bookings (organization_id, slot_id, student_id) values ($1, $2, $3)`,
        [ctx.orgId, p.id, kid.id],
      );
    }
  };
  await slot('06', gush, '17:30', true); // 120 transfer
  await slot('15', jlm, '16:00', true); // 120 transfer
  await slot('15', jlm, '16:30', true); // 120 transfer
  await slot('16', jlm, '16:00', false); // nobody booked: not taught

  await owner((tx) =>
    addAdjustment(tx, ctx, {
      staffMemberId: staff.asaf,
      period,
      kind: 'bonus',
      routing: 'payslip',
      amount: '200',
      note: 'בונוס קייטנה (דמו)',
    }),
  );
}, 60_000);

afterAll(async () => {
  await t?.drop();
});

describe('AC1: the hybrid instructor', () => {
  it('splits the month into ₪440 on the payslip and ₪360 by transfer, as calculated by hand', async () => {
    const { totals } = await owner((tx) => draftPayrollRun(tx, ctx, period));
    // Payslip: 67.50 + 67.50 + 75.00 (groups by the minute) + 2 × 15 travel (6th, 13th at Gush) + 200 bonus.
    expect(totals.staff[staff.asaf]).toMatchObject({
      payslip: 44000,
      transfer: 36000,
      lessons: 6,
      unpriced: 0,
    });
    // Noa: 40 minutes at ₪85 = 56.666… → 56.67.
    expect(totals.staff[staff.noa]).toMatchObject({ payslip: 5667, transfer: 0, lessons: 1 });
    expect(totals).toMatchObject({ payslip: 44000 + 5667, transfer: 36000 });

    const [row] = await q(
      `select id, status, policy_version_key from payroll_runs where period = $1`,
      [period],
    );
    expect(row.status).toBe('draft');
    expect(row.policy_version_key).toBeTruthy();
    const lines = await q(
      `select kind, routing, work_kind, date::text, amount_agorot, explanation->>'code' as code from payroll_lines
       where run_id = $1 and staff_member_id = $2 order by routing, date, kind, amount_agorot`,
      [row.id, staff.asaf],
    );
    expect(
      lines.map((l) => [l.routing, l.kind, l.work_kind, l.date?.slice(8), l.amount_agorot]),
    ).toEqual([
      ['payslip', 'travel', null, '06', 1500],
      ['payslip', 'work', 'group', '06', 6750],
      ['payslip', 'work', 'group', '06', 6750],
      ['payslip', 'travel', null, '13', 1500],
      ['payslip', 'work', 'group', '13', 7500],
      ['payslip', 'adjustment', null, undefined, 20000],
      ['transfer', 'work', 'slot', '06', 12000],
      ['transfer', 'work', 'slot', '15', 12000],
      ['transfer', 'work', 'slot', '15', 12000],
    ]);
    expect(lines.every((l) => (l.code as string).startsWith('payroll.decision.'))).toBe(true);
  });

  it('the instructor sees the same month before payroll runs', async () => {
    // Adjustments show once the month is approved: before that the instructor sees their lessons' pay.
    const month = await as('asaf', (tx) => staffMonth(tx, period, staff.asaf));
    expect(month.lessons).toHaveLength(6);
    expect(month.pay).toMatchObject({ payslip: 24000, transfer: 36000 });
  });
});

describe('month-end timesheets', () => {
  it('a dispute blocks approval until the owner resolves it, with a correction', async () => {
    expect(
      await as('asaf', (tx) =>
        answerTimesheet(tx, ctx, staff.asaf, { period, confirm: false, note: 'חסר שיעור ב-27' }),
      ),
    ).toBe('disputed');
    expect(
      await as('noa', (tx) => answerTimesheet(tx, ctx, staff.noa, { period, confirm: true })),
    ).toBe('confirmed');
    // A dispute needs a note, and nobody answers for someone else.
    await expect(
      as('noa', (tx) => answerTimesheet(tx, ctx, staff.noa, { period, confirm: false })),
    ).rejects.toThrow('payroll.errors.disputeNote');
    expect(
      await codeOf(
        as('noa', (tx) => answerTimesheet(tx, ctx, staff.asaf, { period, confirm: true })),
      ),
    ).toBe('payroll.errors.timesheetNotYours');

    const sheets = await owner((tx) => listTimesheets(tx, period));
    expect(sheets.map((s) => [s.name, s.lessons, s.timesheet?.status])).toEqual(
      expect.arrayContaining([
        ['אסף דמו', 6, 'disputed'],
        ['נועה דמו', 1, 'confirmed'],
      ]),
    );
    const { runId } = await owner((tx) => draftPayrollRun(tx, ctx, period));
    expect(await codeOf(owner((tx) => approvePayrollRun(tx, ctx, runId)))).toBe(
      'payroll.errors.disputesOpen',
    );

    const asaf = sheets.find((s) => s.staffId === staff.asaf);
    await owner((tx) =>
      resolveTimesheet(tx, ctx, {
        id: asaf?.timesheet?.id as string,
        resolution: 'שיעור השלמה ב-27 (דמו)',
        amount: '67.50',
      }),
    );
    const again = await owner((tx) => draftPayrollRun(tx, ctx, period));
    expect(again.totals.staff[staff.asaf]).toMatchObject({
      payslip: 44000 + 6750,
      transfer: 36000,
      timesheet: 'resolved',
    });
  });

  it('approving locks the run, accrues sick leave and tells the worker', async () => {
    const [run] = await q(`select id from payroll_runs where period = $1`, [period]);
    await owner((tx) => approvePayrollRun(tx, ctx, run.id));
    expect(await codeOf(owner((tx) => draftPayrollRun(tx, ctx, period)))).toBe(
      'payroll.errors.runLocked',
    );
    expect(await codeOf(owner((tx) => approvePayrollRun(tx, ctx, run.id)))).toBe(
      'payroll.errors.runLocked',
    );
    expect(
      await codeOf(
        owner((tx) =>
          tx.execute(
            `update payroll_lines set amount_agorot = 1 where run_id = '${run.id}'` as never,
          ),
        ),
      ),
    ).toBe('payroll.errors.runLocked');
    expect(
      await codeOf(
        owner((tx) =>
          addAdjustment(tx, ctx, {
            staffMemberId: staff.noa,
            period,
            kind: 'bonus',
            routing: 'payslip',
            amount: '10',
            note: 'x',
          }),
        ),
      ),
    ).toBe('payroll.errors.periodLocked');
    expect(
      await codeOf(
        as('noa', (tx) =>
          answerTimesheet(tx, ctx, staff.noa, { period, confirm: false, note: 'מאוחר מדי' }),
        ),
      ),
    ).toBe('payroll.errors.timesheetNotYours');
    const [event] = await q(`select payload from outbox where event_type = 'payroll.run_approved'`);
    expect(event.payload).toMatchObject({ runId: run.id, period, transferAgorot: 36000 });

    // Hybrid (payslip groups) and employee both accrue 3 half days; the balance goes down with a sick day.
    const balances = await owner((tx) => sickBalances(tx));
    expect(balances.get(staff.asaf)).toBe(3);
    await owner((tx) =>
      recordSickDay(tx, ctx, { staffMemberId: staff.noa, date: `${period}-27`, halfDays: 2 }),
    );
    expect((await owner((tx) => sickBalances(tx))).get(staff.noa)).toBe(1);
    expect(await codeOf(owner((tx) => tx.execute('delete from sick_leave_entries' as never)))).toBe(
      'payroll.errors.sickLeaveAppendOnly',
    );
  });

  it('records pension status per instructor', async () => {
    const [row] = await q(`select id from payroll_runs where period = $1`, [period]);
    const data = await owner((tx) => getPayrollRun(tx, row.id));
    const noa = data?.staff.find((s) => s.id === staff.noa);
    expect(noa?.pension).toMatchObject({
      continuousMonths: 1,
      eligible: false,
      explanation: { code: 'payroll.decision.pension.notYet' },
    });
  });
});

describe('who reads payroll', () => {
  it('an instructor sees only their own approved statement; the accountant reads the run', async () => {
    const mine = await as('asaf', (tx) => myStatements(tx, staff.asaf));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ period, payslip: 44000 + 6750, transfer: 36000 });
    expect(await as('asaf', (tx) => myStatements(tx, staff.noa))).toEqual([]);
    expect(
      await as(
        'asaf',
        async (tx) => (await tx.execute('select * from payroll_runs' as never)).rows,
      ),
    ).toEqual([]);
    const balances = await as('asaf', (tx) => sickBalances(tx));
    expect([...balances.keys()]).toEqual([staff.asaf]);

    const [row] = await q(`select id from payroll_runs where period = $1`, [period]);
    const run = await as('accountant', (tx) => getPayrollRun(tx, row.id));
    expect(run?.staff.map((s) => s.name).sort()).toEqual(['אסף דמו', 'נועה דמו']);
    expect(
      await codeOf(as('accountant', (tx) => draftPayrollRun(tx, ctx, previousPeriod(period)))),
    ).toBe('common.errors.forbidden');
  });

  it('exports the accountant XLSX: payslip and transfer sheets with totals', async () => {
    const [row] = await q(`select id from payroll_runs where period = $1`, [period]);
    const out = await as('accountant', (tx) => payrollWorkbook(tx, row.id, labels));
    expect(out?.period).toBe(period);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(out?.buffer as unknown as ArrayBuffer);
    const payslip = book.getWorksheet('תלוש');
    const transfer = book.getWorksheet('העברות');
    const totals = (sheet: ExcelJS.Worksheet | undefined, amountCol: number) => {
      const out: Record<string, number> = {};
      sheet?.eachRow((r, i) => {
        if (i > 1 && r.getCell(sheet === payslip ? 4 : 3).value === 'סה״כ') {
          out[String(r.getCell(1).value)] = Number(r.getCell(amountCol).value);
        }
      });
      return out;
    };
    expect(totals(payslip, 6)).toEqual({ 'אסף דמו': 507.5, 'נועה דמו': 56.67 });
    expect(totals(transfer, 5)).toEqual({ 'אסף דמו': 360 });
    expect(
      await owner((tx) => payrollWorkbook(tx, '00000000-0000-0000-0000-000000000000', labels)),
    ).toBeNull();
  });
});

describe('system', () => {
  it('the worker can draft a month as the tenant', async () => {
    const r = await system((tx) =>
      draftPayrollRun(tx, { orgId: ctx.orgId, userId: null }, previousPeriod(period)),
    );
    expect(r.totals.staff).toEqual({});
  });
});
