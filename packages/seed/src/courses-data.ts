/**
 * Phase 8 demo courses, camps and an institution for the demo tenant (all fake):
 * - An intensive Hanukkah course (Sunday and Tuesday mornings) with its own regulations (no makeups), four children.
 * - A summer camp week (a group per day) with Reut leading and Noa as counselor: twelve children, within the ratio.
 * - A school that pays for its third graders' Thursday group by contract: September invoiced, printed (fake Green
 *   Invoice) and partly paid; attendance marked for September's lessons.
 */
import { createDb, sql, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import {
  attachContractGroup,
  createContract,
  createInstitution,
  draftInstitutionInvoice,
  issueInstitutionInvoice,
  printInstitutionInvoice,
  recordInstitutionPayment,
} from '@rswim/domain-institutions';
import {
  addCohortStaff,
  attachGroup,
  createCohort,
  createTerm,
  generateSessions,
  registerToCohort,
} from '@rswim/domain-scheduling';
import { FakeInvoicingProvider } from '@rswim/integrations';
import type pg from 'pg';

export interface CoursesDataSummary {
  cohorts: number;
  cohortMembers: number;
  institutions: number;
  institutionInvoices: number;
}

export async function seedCoursesData(
  client: pg.PoolClient,
  orgId: string,
  staffIds: string[],
): Promise<CoursesDataSummary> {
  const [reut, , noa, , lia] = staffIds as [string, string, string, string, string];
  const one = async <T>(text: string, params: unknown[]) =>
    (await client.query(text, params)).rows[0] as T;
  const rows = async <T>(text: string, params: unknown[]) =>
    (await client.query(text, params)).rows as T[];

  // ─── Plain setup as the owner: programs, their regulations and prices, the groups ──
  const program = async (code: string, kind: string, he: string, dur: number) =>
    (
      await one<{ id: string }>(
        `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity, sort_order)
         values ($1, $2, $3, $4, $5, 20, 20) returning id`,
        [orgId, code, kind, he, dur],
      )
    ).id;
  const course = await program('course', 'intensive_course', 'קורס שחייה מרוכז', 45);
  const camp = await program('camp', 'camp', 'קייטנת שחייה', 60);
  await client.query(
    `insert into policy_sets (organization_id, scope_type, program_id, effective_from, rules)
     values ($1, 'program', $2, '2026-09-01', '{"makeup": {"enabled": false}, "absence": {"timely_earns_makeup": false}}'),
            ($1, 'program', $3, '2026-09-01', '{"camp": {"children_per_staff": 8}}')`,
    [orgId, course, camp],
  );
  const list = await one<{ id: string }>(
    `insert into price_lists (organization_id, name, effective_from, status)
     values ($1, 'קורסים וקייטנות (דמו)', '2026-09-01', 'draft') returning id`,
    [orgId],
  );
  await client.query(
    `insert into price_items (organization_id, price_list_id, program_id, kind, amount_agorot)
     values ($1, $2, $3, 'package', 95000), ($1, $2, $4, 'package', 120000)`,
    [orgId, list.id, course, camp],
  );
  await client.query(`update price_lists set status = 'published' where id = $1`, [list.id]);

  const venues = await rows<{ name: string; venue_id: string; pool_id: string }>(
    `select v.name, v.id venue_id, p.id pool_id from venues v join pools p on p.venue_id = v.id
     where v.organization_id = $1 order by v.name`,
    [orgId],
  );
  const gush = venues.find((v) => v.name.includes('גוש')) ?? (venues[0] as (typeof venues)[0]);
  const jerusalem = venues.find((v) => v.name.includes('ירושלים')) ?? gush;
  const kidsProgram = (
    await one<{ id: string }>(
      `select id from programs where organization_id = $1 and code = 'kids-group'`,
      [orgId],
    )
  ).id;
  const group = async (
    name: string,
    programId: string,
    v: typeof gush,
    weekday: number,
    startsAt: string,
    duration: number,
    from: string,
    to: string,
    lead: string,
  ) =>
    (
      await one<{ id: string }>(
        `insert into class_templates (organization_id, name, program_id, venue_id, pool_id, weekday, starts_at,
                                      duration_min, capacity, effective_from, effective_to, lead_staff_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 20, $9, $10, $11) returning id`,
        [
          orgId,
          name,
          programId,
          v.venue_id,
          v.pool_id,
          weekday,
          startsAt,
          duration,
          from,
          to,
          lead,
        ],
      )
    ).id;
  const courseGroups = [
    await group(
      'קורס חנוכה – ראשון',
      course,
      gush,
      0,
      '09:00',
      45,
      '2026-12-06',
      '2026-12-25',
      lia,
    ),
    await group(
      'קורס חנוכה – שלישי',
      course,
      gush,
      2,
      '09:00',
      45,
      '2026-12-06',
      '2026-12-25',
      lia,
    ),
  ];
  const campGroups: string[] = [];
  for (const d of [0, 1, 2, 3, 4]) {
    campGroups.push(
      await group(
        `קייטנה שבוע 1 – יום ${d + 1}`,
        camp,
        jerusalem,
        d,
        '08:30',
        60,
        '2027-07-04',
        '2027-07-09',
        reut,
      ),
    );
  }
  const schoolGroup = await group(
    'אופק – כיתות ג׳',
    kidsProgram,
    jerusalem,
    4,
    '11:00',
    45,
    '2026-09-01',
    '2027-07-01',
    noa,
  );

  // ─── Services as rswim_system ───────────────────────────────────────────────
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };

  const hanukkah = await createTerm(tx, ctx, {
    name: 'קורס חנוכה תשפ״ז',
    kind: 'course',
    startsOn: '2026-12-06',
    endsOn: '2026-12-24',
    notes: null,
  });
  await generateSessions(tx, ctx, hanukkah, courseGroups);
  const summer = await createTerm(tx, ctx, {
    name: 'קיץ 2027',
    kind: 'summer',
    startsOn: '2027-07-04',
    endsOn: '2027-08-26',
    notes: null,
  });
  await generateSessions(tx, ctx, summer, campGroups);
  const [schoolYear] = (
    await tx.execute<{ id: string }>(
      sql`select id from terms where organization_id = ${orgId} and kind = 'school_year' limit 1`,
    )
  ).rows;
  if (schoolYear) await generateSessions(tx, ctx, schoolYear.id, [schoolGroup]);

  const courseId = await createCohort(tx, ctx, {
    name: 'קורס חנוכה מרוכז',
    programId: course,
    startsOn: '2026-12-06',
    endsOn: '2026-12-24',
    capacity: 10,
    registrationClosesOn: '2026-12-01',
    notes: 'פעמיים בשבוע, בוקר. בלי השלמות (תקנון הקורס).',
  });
  const campId = await createCohort(tx, ctx, {
    name: 'קייטנת קיץ – שבוע 1',
    programId: camp,
    startsOn: '2027-07-04',
    endsOn: '2027-07-08',
    capacity: 24,
  });
  for (const g of courseGroups) await attachGroup(tx, { cohortId: courseId, classTemplateId: g });
  for (const g of campGroups) await attachGroup(tx, { cohortId: campId, classTemplateId: g });
  await addCohortStaff(tx, ctx, { cohortId: campId, staffMemberId: noa, role: 'מדריכת קייטנה' });

  // Course: the Cohen children first (the parent persona), then two more of the right age.
  const pick = async (bornFrom: string, bornTo: string, n: number, skip: readonly string[]) =>
    (
      await rows<{ id: string }>(
        `select id from students where organization_id = $1 and dob between $2 and $3
           and not (id = any($4::uuid[]))
         order by (last_name = 'כהן') desc, dob, first_name limit $5`,
        [orgId, bornFrom, bornTo, skip, n],
      )
    ).map((r) => r.id);
  const courseKids = await pick('2016-01-01', '2021-12-31', 4, []);
  for (const k of courseKids) await registerToCohort(tx, ctx, { cohortId: courseId, studentId: k });
  const campKids = await pick('2014-01-01', '2020-12-31', 12, []);
  for (const k of campKids) await registerToCohort(tx, ctx, { cohortId: campId, studentId: k });

  // ─── The school that pays for its third graders ─────────────────────────────
  const institutionId = await createInstitution(tx, ctx, {
    name: 'בית ספר אופק (דמו)',
    kind: 'school',
    taxId: '500000001',
    contactName: 'מזכירות בית הספר (דמו)',
    contactPhone: '',
    contactEmail: 'office@example.test',
    address: 'רחוב הדמו 1, ירושלים',
  });
  const contractId = await createContract(tx, ctx, {
    institutionId,
    name: 'שחייה לכיתות ג׳ תשפ״ז',
    startsOn: '2026-09-01',
    endsOn: '2027-06-30',
    pricing: 'per_child_month',
    amountAgorot: 12000,
    paymentTermsDays: 30,
  });
  await attachContractGroup(tx, ctx, { contractId, classTemplateId: schoolGroup });
  const pupils = await pick('2017-09-01', '2018-08-31', 6, [...courseKids, ...campKids]);
  for (const p of pupils) {
    await tx.execute(sql`
      insert into enrollments (organization_id, student_id, class_template_id, status, starts_on, source)
      values (${orgId}, ${p}, ${schoolGroup}, 'active', '2026-09-01', 'institution')`);
  }
  // September's lessons happened: everyone came, one pupil missed the last one.
  const lessons = (
    await tx.execute<{ id: string; date: string }>(
      sql`select id, date::text from sessions where class_template_id = ${schoolGroup}
          and date < '2026-10-01' order by date`,
    )
  ).rows;
  for (const [i, l] of lessons.entries()) {
    for (const [j, p] of pupils.entries()) {
      const status = i === lessons.length - 1 && j === 0 ? 'absent' : 'present';
      await tx.execute(sql`
        insert into attendance (organization_id, session_id, student_id, status)
        values (${orgId}, ${l.id}, ${p}, ${status})`);
    }
    await tx.execute(sql`update sessions set status = 'completed' where id = ${l.id}`);
  }
  const september = await draftInstitutionInvoice(tx, ctx, { contractId, period: '2026-09' });
  await issueInstitutionInvoice(tx, ctx, september);
  await printInstitutionInvoice(tx, ctx, new FakeInvoicingProvider(), september);
  await recordInstitutionPayment(tx, ctx, {
    invoiceId: september,
    amountAgorot: 36000,
    paidOn: '2026-10-02',
    method: 'bank_transfer',
    reference: 'העברה 4471 (דמו)',
  });
  await draftInstitutionInvoice(tx, ctx, { contractId, period: '2026-10' });

  await client.query('reset role');
  return {
    cohorts: 2,
    cohortMembers: courseKids.length + campKids.length,
    institutions: 1,
    institutionInvoices: 2,
  };
}
