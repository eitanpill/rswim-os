/**
 * Phase 8 demo transport for the demo tenant, through the transport services as the tenant's worker (all fake):
 * - A school and one route from it to the boys' Wednesday group, with Dani (the escort persona) on board.
 * - Riders: Yoav Cohen (the parent persona's son) and two more boys, each with a drop-off point.
 * - Last Wednesday's run, done, with every stage tapped, so the in-water report has a row (the group got in late).
 */
import { createDb, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { addRider, createRoute, createSchool, openRun } from '@rswim/domain-transport';
import type pg from 'pg';

export interface TransportDataSummary {
  schools: number;
  routes: number;
  riders: number;
  pastRuns: number;
}

const ROUTE_GROUP = 'בנים צפרדע';

export async function seedTransportData(
  client: pg.PoolClient,
  orgId: string,
  staffIds: string[],
): Promise<TransportDataSummary> {
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const dani = staffIds[3] as string;
  const one = async <T>(sql: string, params: unknown[]) =>
    (await client.query(sql, params)).rows[0] as T | undefined;

  const schoolId = await createSchool(tx, ctx, {
    name: 'בית ספר אופק (דמו)',
    address: 'רחוב הדמו 1, ירושלים',
    contactName: 'מזכירות (דמו)',
    contactPhone: '',
    notes: '',
  });
  const group = await one<{ id: string; weekday: number }>(
    `select id, weekday from class_templates where organization_id = $1 and name = $2`,
    [orgId, ROUTE_GROUP],
  );
  if (!group) throw new Error(`seed: group ${ROUTE_GROUP} is missing`);
  const routeId = await createRoute(tx, ctx, {
    name: 'הסעת אופק',
    schoolId,
    classTemplateId: group.id,
    weekdays: [group.weekday],
    leavesSchoolAt: '15:30',
    rideMinutes: 20,
    escortStaffId: dani,
    vehicle: 'מיניבוס 16 מקומות',
    driverName: 'משה (נהג דמו)',
    driverPhone: '',
    notes: '',
  });

  const [{ today }] = (await client.query<{ today: string }>(`select app.today()::text as today`))
    .rows as [{ today: string }];
  const startsOn = `${today.slice(0, 7)}-01`;
  const boys = (
    await client.query<{ id: string; first_name: string }>(
      `select s.id, s.first_name from students s
       where s.organization_id = $1 and s.gender = 'male' and s.dob between '2017-01-01' and '2020-12-31'
       order by (s.last_name = 'כהן' and s.first_name = 'יואב') desc, s.id limit 3`,
      [orgId],
    )
  ).rows;
  const points = ['תחנת האוטובוס ברחוב הגפן', 'בית הספר (איסוף הורים)', 'מרכז קהילתי (דמו)'];
  for (const [i, b] of boys.entries()) {
    await addRider(tx, ctx, {
      routeId,
      studentId: b.id,
      dropoffPoint: points[i] ?? '',
      dropoffNote: i === 0 ? 'אמא מחכה ליד הספסל' : '',
      startsOn,
    });
  }

  // ─── Last week's run, tapped end to end ─────────────────────────────────────
  const past = new Date(Date.parse(`${today}T00:00:00Z`));
  past.setUTCDate(past.getUTCDate() - ((past.getUTCDay() - group.weekday + 7) % 7 || 7));
  const date = past.toISOString().slice(0, 10);
  const runId = await openRun(tx, ctx, { routeId, date });
  const at = (hhmm: string) => `${date} ${hhmm}`;
  const events: [string, string | null, string][] = [
    ...boys.map((b) => ['boarded', b.id, '15:28'] as [string, string, string]),
    ['left_school', null, '15:32'],
    ['arrived_pool', null, '15:58'],
    ['in_water', null, '16:06'],
    ['out_of_water', null, '16:38'],
    ['left_pool', null, '16:52'],
    ...boys.map((b) => ['dropped_off', b.id, '17:15'] as [string, string, string]),
    ['run_done', null, '17:20'],
  ];
  for (const [kind, studentId, hhmm] of events) {
    await client.query(
      `insert into run_events (organization_id, run_id, kind, student_id, at)
       values ($1, $2, $3, $4, ($5)::timestamp at time zone 'Asia/Jerusalem')`,
      [orgId, runId, kind, studentId, at(hhmm)],
    );
  }

  await client.query('reset role');
  return { schools: 1, routes: 1, riders: boys.length, pastRuns: 1 };
}
