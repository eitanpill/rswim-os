/**
 * Phase 6 demo staff operations for the demo tenant, through the payroll and scheduling services as the tenant's
 * worker (all fake):
 * - Noa (the instructor persona) gets her swim-instructor certificate, so she can be offered substitutions.
 * - Last month: Asaf (hybrid) confirmed his hours, Dani disputed his, Asaf has a bonus, and the month is drafted. The
 *   open dispute keeps it from being approved until the owner closes it.
 * - One upcoming lesson looks for a substitute, and the first wave includes Noa, so her app shows the offer.
 * - Applicants at several stages, one of them in the talent pool.
 */
import { createDb, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import {
  addAdjustment,
  answerTimesheet,
  draftPayrollRun,
  previousPeriod,
} from '@rswim/domain-payroll';
import { requestSubstitute, upcomingLessons } from '@rswim/domain-scheduling';
import { createApplicant, updateApplicantStage } from '@rswim/domain-staff';
import type pg from 'pg';

export interface StaffOpsDataSummary {
  payrollPeriod: string;
  payrollStaff: number;
  substituteRequests: number;
  applicants: number;
}

export async function seedStaffOpsData(
  client: pg.PoolClient,
  orgId: string,
  staffIds: string[],
): Promise<StaffOpsDataSummary> {
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const [, asaf, noa, dani] = staffIds as [string, string, string, string];
  const [{ today }] = (await client.query<{ today: string }>(`select app.today()::text as today`))
    .rows as [{ today: string }];
  const period = previousPeriod(today.slice(0, 7));

  await client.query(
    `insert into certifications (organization_id, staff_member_id, type, issuer) values ($1, $2, 'swim_instructor', 'מכון וינגייט (דמו)')`,
    [orgId, noa],
  );

  // ─── Last month's payroll ───────────────────────────────────────────────────
  // Asaf's privates last month (by invoice), next to his groups (on the payslip): the hybrid split. Written directly,
  // since the booking service refuses dates in the past.
  for (const day of ['08', '15']) {
    await client.query(
      `with slot as (
         insert into private_slots (organization_id, staff_member_id, venue_id, program_id, kind, date, starts_at, ends_at, capacity, status)
         select $1, $2, v.id, p.id, 'private', $3::date,
                ($3 || ' 19:30')::timestamp at time zone 'Asia/Jerusalem',
                ($3 || ' 20:00')::timestamp at time zone 'Asia/Jerusalem', 1, 'full'
         from venues v, programs p
         where v.organization_id = $1 and p.organization_id = $1 and p.code = 'private'
         order by v.name limit 1
         returning id)
       insert into slot_bookings (organization_id, slot_id, student_id)
       select $1, slot.id, (select id from students where organization_id = $1 and first_name = 'רועי' order by id limit 1) from slot`,
      [orgId, asaf, `${period}-${day}`],
    );
  }
  await answerTimesheet(tx, ctx, asaf, { period, confirm: true });
  await answerTimesheet(tx, ctx, dani, {
    period,
    confirm: false,
    note: 'חסר לי שיעור פרטי אחד בסוף החודש',
  });
  await addAdjustment(tx, ctx, {
    staffMemberId: asaf,
    period,
    kind: 'bonus',
    routing: 'payslip',
    amount: '150',
    note: 'בונוס על החלפות',
  });
  const run = await draftPayrollRun(tx, ctx, period);

  // ─── A lesson looking for a substitute, offered to Noa in the first wave ───
  const upcoming = await upcomingLessons(tx, {
    from: today,
    to: new Date(Date.parse(`${today}T00:00:00Z`) + 14 * 86_400_000).toISOString().slice(0, 10),
  });
  let substituteRequests = 0;
  for (const l of upcoming) {
    if (!l.leadStaffId || l.leadStaffId === noa || l.date === today) continue;
    await client.query('savepoint substitute');
    const r = await requestSubstitute(tx, ctx, { sessionId: l.id, reason: 'מילואים' });
    if (r.ranked.some((c) => c.staffId === noa && c.wave === 1)) {
      await client.query('release savepoint substitute');
      substituteRequests++;
      break;
    }
    await client.query('rollback to savepoint substitute');
  }

  // ─── Recruiting ─────────────────────────────────────────────────────────────
  const applicants = [
    {
      firstName: 'מיכל',
      lastName: 'אברהמי',
      source: 'college',
      certifications: 'מדריכת שחייה (וינגייט)',
      availability: 'ראשון ושלישי אחה״צ',
      rateExpectation: '80',
      stage: 'trial_day',
      scores: { water: '5', kids: '4' },
    },
    {
      firstName: 'יונתן',
      lastName: 'שגב',
      source: 'facebook',
      certifications: 'מציל בריכות',
      availability: 'שני ורביעי',
      stage: 'screening',
    },
    {
      firstName: 'הדס',
      lastName: 'נחום',
      source: 'referral',
      certifications: 'מדריכת שחייה',
      availability: 'גמישה, מעדיפה גוש עציון',
      stage: 'talent_pool',
      scores: { water: '4', kids: '5', reliability: '5' },
    },
    { firstName: 'עומר', lastName: 'בן דוד', source: 'swim_club', stage: 'new' },
  ] as const;
  for (const a of applicants) {
    const id = await createApplicant(tx, ctx, {
      firstName: a.firstName,
      lastName: a.lastName,
      phone: '',
      email: '',
      gender: '',
      source: a.source,
      certifications: 'certifications' in a ? a.certifications : '',
      availability: 'availability' in a ? a.availability : '',
      rateExpectation: 'rateExpectation' in a ? a.rateExpectation : '',
      notes: '',
    });
    if (a.stage !== 'new') {
      await updateApplicantStage(tx, {
        id,
        stage: a.stage,
        ...('scores' in a ? a.scores : {}),
      });
    }
  }

  await client.query('reset role');
  return {
    payrollPeriod: period,
    payrollStaff: Object.keys(run.totals.staff).length,
    substituteRequests,
    applicants: applicants.length,
  };
}
