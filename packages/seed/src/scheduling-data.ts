/**
 * Phase 2 demo data for the R-SWIM demo tenant: the school-year term, groups on both venues with their lead
 * instructors, the generated sessions, enrollments, private slots, a waitlist cluster and one pending shift change
 * for the instructor persona to answer. Everything goes through the scheduling services (as `rswim_system`), so the
 * demo data obeys the same rules as the screens. All fake.
 */
import { createDb, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  addOverride,
  addToWaitlist,
  bookSlot,
  createGroup,
  createTerm,
  generateSessions,
  openSlots,
  placeStudent,
  requestShiftChange,
  TemplateInput,
  todayIL,
} from '@rswim/domain-scheduling';
import type pg from 'pg';

export interface SchedulingDataSummary {
  groups: number;
  sessions: number;
  enrollments: number;
  slots: number;
  waitlist: number;
  pendingShiftChanges: number;
}

const SEASON_START = '2026-09-01';
const SEASON_END = '2027-06-30';

/** ISO date `days` after `iso`. */
const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
/** The first date on or after `iso` that falls on `weekday` (0 = Sunday). */
const nextWeekday = (iso: string, weekday: number) =>
  addDays(iso, (weekday - new Date(`${iso}T00:00:00Z`).getUTCDay() + 7) % 7);

interface GroupSpec {
  name: string;
  venue: 'jerusalem' | 'gush';
  program: string;
  weekday: number;
  startsAt: string;
  lanes: number[];
  gender: 'mixed' | 'female' | 'male';
  levels?: [number, number];
  lead: 'reut' | 'asaf' | 'noa' | 'dani' | 'lia';
  capacity?: number;
  skills?: string[];
  instructorGender?: 'female' | 'male';
  /** Who gets placed: gender and birth-date range of the candidates. */
  pick: { gender?: 'female' | 'male'; bornFrom: string; bornTo: string; max: number };
}

const GROUPS: GroupSpec[] = [
  {
    name: 'בנות צפרדע',
    venue: 'jerusalem',
    program: 'kids-group',
    weekday: 1,
    startsAt: '16:00',
    lanes: [1, 2],
    gender: 'female',
    levels: [1, 2],
    lead: 'noa',
    pick: { gender: 'female', bornFrom: '2019-01-01', bornTo: '2022-09-01', max: 5 },
  },
  {
    name: 'בנות דולפין',
    venue: 'jerusalem',
    program: 'kids-group',
    weekday: 1,
    startsAt: '16:00',
    lanes: [3, 4],
    gender: 'female',
    levels: [3, 3],
    lead: 'lia',
    pick: { gender: 'female', bornFrom: '2017-01-01', bornTo: '2018-12-31', max: 5 },
  },
  {
    name: 'בנות כריש',
    venue: 'jerusalem',
    program: 'kids-group',
    weekday: 1,
    startsAt: '17:00',
    lanes: [1, 2],
    gender: 'female',
    levels: [4, 4],
    lead: 'lia',
    pick: { gender: 'female', bornFrom: '2012-11-01', bornTo: '2016-12-31', max: 5 },
  },
  {
    name: 'בנים צפרדע',
    venue: 'jerusalem',
    program: 'kids-group',
    weekday: 3,
    startsAt: '16:00',
    lanes: [1, 2],
    gender: 'male',
    levels: [1, 2],
    lead: 'asaf',
    pick: { gender: 'male', bornFrom: '2018-01-01', bornTo: '2022-09-01', max: 5 },
  },
  {
    name: 'בנים דולפין',
    venue: 'jerusalem',
    program: 'kids-group',
    weekday: 3,
    startsAt: '17:00',
    lanes: [1, 2],
    gender: 'male',
    levels: [3, 3],
    lead: 'asaf',
    pick: { gender: 'male', bornFrom: '2012-11-01', bornTo: '2017-12-31', max: 5 },
  },
  {
    name: 'תינוקות ראשון',
    venue: 'jerusalem',
    program: 'babies',
    weekday: 0,
    startsAt: '15:00',
    lanes: [3],
    gender: 'mixed',
    lead: 'reut',
    skills: ['babies'],
    pick: { bornFrom: '2023-10-15', bornTo: '2026-07-01', max: 4 },
  },
  {
    name: 'מעורבת ראשון',
    venue: 'jerusalem',
    program: 'kids-group',
    weekday: 0,
    startsAt: '16:00',
    lanes: [3, 4],
    gender: 'mixed',
    levels: [1, 2],
    lead: 'reut',
    pick: { bornFrom: '2019-01-01', bornTo: '2022-09-01', max: 4 },
  },
  {
    name: 'גוש שלישי',
    venue: 'gush',
    program: 'kids-group',
    weekday: 2,
    startsAt: '16:00',
    lanes: [5],
    gender: 'mixed',
    levels: [1, 2],
    lead: 'dani',
    pick: { bornFrom: '2015-01-01', bornTo: '2020-12-31', max: 5 },
  },
  {
    name: 'מבוגרים גוש',
    venue: 'gush',
    program: 'adults',
    weekday: 2,
    startsAt: '18:00',
    lanes: [6],
    gender: 'mixed',
    lead: 'dani',
    capacity: 8,
    pick: { bornFrom: '1900-01-01', bornTo: '2007-01-01', max: 2 },
  },
  {
    name: 'פחד ממים חמישי',
    venue: 'gush',
    program: 'kids-group',
    weekday: 4,
    startsAt: '16:00',
    lanes: [5],
    gender: 'mixed',
    lead: 'lia',
    capacity: 4,
    skills: ['water_fear'],
    instructorGender: 'female',
    pick: { bornFrom: '2014-01-01', bornTo: '2022-09-01', max: 3 },
  },
];

/** New fake children who wait for a babies group that does not exist yet (the "open a group" suggestion). */
const WAITING_BABIES = ['אורי', 'ליבי', 'נגה', 'אלון', 'יעלי', 'רז'];

export async function seedSchedulingData(
  client: pg.PoolClient,
  orgId: string,
  staffIds: readonly string[],
  fakePhone: () => string,
): Promise<SchedulingDataSummary> {
  const rows = async <T>(text: string, params: unknown[] = []) =>
    (await client.query(text, params)).rows as T[];
  const [reut, asaf, noa, dani, lia] = staffIds as [string, string, string, string, string];
  const staff = { reut, asaf, noa, dani, lia };

  // ─── Plain setup as the owner: availability, skills, levels for the older demo children ──
  for (const [id, weekday, venueName] of [
    [reut, 0, 'קאנטרי הדמו - ירושלים'],
    [reut, 2, 'בריכת הדמו - גוש עציון'],
    [lia, 1, 'קאנטרי הדמו - ירושלים'],
    [lia, 4, 'בריכת הדמו - גוש עציון'],
    // Dani also teaches in Jerusalem on Tuesdays; Lia does not on Thursdays (the venue migration demo shows both).
    [dani, 2, 'קאנטרי הדמו - ירושלים'],
  ] as const) {
    await client.query(
      `insert into availability_rules (organization_id, staff_member_id, weekday, starts_at, ends_at, venue_id, effective_from)
       select $1, $2, $3, '15:00', '20:00', id, $5 from venues where organization_id = $1 and name = $4`,
      [orgId, id, weekday, venueName, SEASON_START],
    );
  }
  await client.query(`update staff_members set skills = '{water_fear}' where id = $1`, [lia]);

  const venues = Object.fromEntries(
    (
      await rows<{ name: string; venue_id: string; pool_id: string }>(
        `select v.name, v.id venue_id, p.id pool_id from venues v join pools p on p.venue_id = v.id where v.organization_id = $1`,
        [orgId],
      )
    ).map((v) => [v.name === 'קאנטרי הדמו - ירושלים' ? 'jerusalem' : 'gush', v]),
  ) as unknown as Record<GroupSpec['venue'], { venue_id: string; pool_id: string }>;
  const lanes = await rows<{ pool_id: string; ordinal: number; id: string }>(
    `select pool_id, ordinal, id from lanes where organization_id = $1`,
    [orgId],
  );
  const programs = Object.fromEntries(
    (
      await rows<{ code: string; id: string }>(
        `select code, id from programs where organization_id = $1`,
        [orgId],
      )
    ).map((p) => [p.code, p.id]),
  );
  const levels = await rows<{ program_id: string; ordinal: number; id: string }>(
    `select program_id, ordinal, id from levels where organization_id = $1`,
    [orgId],
  );
  const levelId = (program: string, ordinal: number) =>
    levels.find((l) => l.program_id === programs[program] && l.ordinal === ordinal)?.id ?? null;
  // Older children have climbed the ladder: girls born 2017-2018 and boys up to 2017 are dolphins, older girls sharks.
  await client.query(
    `update students set level_id = $2 where organization_id = $1
       and ((gender = 'female' and dob between '2017-01-01' and '2018-12-31') or (gender = 'male' and dob < '2018-01-01'))
       and dob >= '2012-11-01'`,
    [orgId, levelId('kids-group', 3)],
  );
  await client.query(
    `update students set level_id = $2 where organization_id = $1 and gender = 'female' and dob between '2012-11-01' and '2016-12-31'`,
    [orgId, levelId('kids-group', 4)],
  );

  // ─── Services as rswim_system, inside the seed transaction ──────────────────
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const summary: SchedulingDataSummary = {
    groups: 0,
    sessions: 0,
    enrollments: 0,
    slots: 0,
    waitlist: 0,
    pendingShiftChanges: 0,
  };
  const today = await todayIL(tx);

  const termId = await createTerm(tx, ctx, {
    name: 'שנת הלימודים תשפ״ז',
    kind: 'school_year',
    startsOn: SEASON_START,
    endsOn: SEASON_END,
    notes: null,
  });
  await addOverride(tx, ctx, {
    date: '2027-03-21',
    kind: 'closed',
    venueId: null,
    reason: 'כנס מדריכים שנתי (דמו)',
  });

  const groupIds: Record<string, string> = {};
  for (const g of GROUPS) {
    const v = venues[g.venue];
    const input = TemplateInput.parse({
      name: g.name,
      programId: programs[g.program],
      venueId: v.venue_id,
      poolId: v.pool_id,
      weekday: g.weekday,
      startsAt: g.startsAt,
      durationMin: g.program === 'babies' ? 30 : 45,
      laneIds: g.lanes.map(
        (n) => lanes.find((l) => l.pool_id === v.pool_id && l.ordinal === n)?.id,
      ),
      levelMinId: g.levels ? levelId(g.program, g.levels[0]) : '',
      levelMaxId: g.levels ? levelId(g.program, g.levels[1]) : '',
      admittedGender: g.gender,
      capacity: g.capacity ?? 6,
      requiredInstructorGender: g.instructorGender ?? '',
      requiredSkills: g.skills ?? [],
      effectiveFrom: SEASON_START,
    });
    const id = await createGroup(tx, ctx, input);
    // The demo starts with instructors already on their groups; new assignments go through acceptance.
    await tx.execute(
      sql`update class_templates set lead_staff_id = ${staff[g.lead]} where id = ${id}`,
    );
    groupIds[g.name] = id;
    summary.groups++;
  }
  summary.sessions = (await generateSessions(tx, ctx, termId)).created;

  // ─── Enrollments: candidates by age and gender; the placement rules decide who fits ──
  const placed = new Set<string>();
  for (const g of GROUPS) {
    const candidates = await rows<{ id: string }>(
      `select id from students where organization_id = $1 and dob between $2 and $3 and ($4::text is null or gender = $4)
       order by dob desc, first_name`,
      [orgId, g.pick.bornFrom, g.pick.bornTo, g.pick.gender ?? null],
    );
    let n = 0;
    for (const c of candidates) {
      if (n >= g.pick.max || placed.has(c.id)) continue;
      try {
        await placeStudent(tx, ctx, {
          studentId: c.id,
          toTemplateId: groupIds[g.name] as string,
          fromTemplateId: null,
          onDate: SEASON_START,
          status: 'active',
        });
        placed.add(c.id);
        n++;
        summary.enrollments++;
      } catch (e) {
        if (!(e instanceof DomainError)) throw e;
      }
    }
  }

  // ─── Private slots: Reut on Tuesdays at Gush, the first one booked ──────────
  const slotIds = await openSlots(tx, ctx, {
    staffMemberId: reut,
    venueId: venues.gush.venue_id,
    poolId: venues.gush.pool_id,
    programId: programs.private ?? null,
    kind: 'private',
    date: nextWeekday(addDays(today, 1), 2),
    startsAt: '17:00',
    endsAt: '17:30',
    capacity: null,
    repeatWeeks: 4,
    notes: null,
  });
  summary.slots = slotIds.length;
  const [privateStudent] = await rows<{ id: string }>(
    `select id from students where organization_id = $1 and first_name = 'רועי'`,
    [orgId],
  );
  if (slotIds[0] && privateStudent) await bookSlot(tx, ctx, slotIds[0], privateStudent.id);

  // ─── Waitlist: enough babies for a Tuesday group at Gush that the board suggests opening ──
  await client.query('reset role');
  const waitingIds: string[] = [];
  for (const [i, first] of WAITING_BABIES.entries()) {
    const [h] = await rows<{ id: string }>(
      `insert into households (organization_id, display_name, notes) values ($1, $2, 'ממתינים לקבוצת תינוקות') returning id`,
      [orgId, `משפחת ${first} (ממתינים)`],
    );
    await client.query(
      `insert into guardians (organization_id, household_id, first_name, last_name, relation, phone_e164, whatsapp_opt_in, is_billing_contact)
       values ($1, $2, 'הורה', 'ממתין', 'mother', $3, true, true)`,
      [orgId, h?.id, fakePhone()],
    );
    const [s] = await rows<{ id: string }>(
      `insert into students (organization_id, household_id, first_name, last_name, dob, gender) values ($1, $2, $3, 'ממתין', $4, $5) returning id`,
      [orgId, h?.id, first, `2025-${String(3 + i).padStart(2, '0')}-10`, i % 2 ? 'male' : 'female'],
    );
    waitingIds.push(s?.id as string);
  }
  await client.query('set local role rswim_system');
  for (const studentId of waitingIds) {
    await addToWaitlist(tx, ctx, {
      studentId,
      programId: programs.babies as string,
      venueId: venues.gush.venue_id,
      classTemplateId: null,
      preferredWeekdays: [2],
      earliestAt: '15:30',
      latestAt: '18:00',
      priority: 0,
      notes: null,
    });
    summary.waitlist++;
  }

  // ─── One pending shift change for the instructor persona (Noa) to accept ────
  await requestShiftChange(tx, ctx, {
    kind: 'reassign_group',
    classTemplateId: groupIds['בנות כריש'] as string,
    effectiveFrom: nextWeekday(addDays(today, 7), 1),
    toStaffId: noa,
    reason: 'ליה עוברת ללמד בגוש בימי שני (דמו)',
  });
  summary.pendingShiftChanges++;

  await client.query('reset role');
  return summary;
}
