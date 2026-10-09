/**
 * What people do in the club: check divers in, book and cancel, log dives, report incidents, post the sea call, rent
 * and return gear, move leads, plan the lines, tick course skills, sign the waiver. Every change runs as the signed-in
 * user under RLS; the database guards capacity, gear availability, personal bests and what a customer may change.
 */
import { z } from 'zod';
import {
  CURRENTS,
  DIVE_SESSION_STATUSES,
  DiveDiscipline,
  DiveIncidentKind,
  DiveOutcome,
  DiveSeverity,
  LEAD_STAGES,
  WIND_DIRS,
  optionalText,
} from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { bookingDecision, passBalance, planLines, seaCall } from '../policies';
import { lineup } from './reads';
import { guarded, loadRules, myDiverId, one, rows, todayIL } from './shared';

const id = z.uuid();
/** An optional id from a form: an empty select ("none") means absent. */
const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), id.optional());
const intIn = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : Number(v)),
    z.int().min(min).max(max),
  );
const optionalIntIn = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : Number(v)),
    z.int().min(min).max(max).nullable(),
  );

// ─── Front desk ─────────────────────────────────────────────────────────────

export const BookingRef = z.object({ bookingId: id });

export async function checkIn(tx: Tx, raw: z.input<typeof BookingRef>) {
  const { bookingId } = BookingRef.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_bookings set status = 'checked_in', checked_in_at = now()
          where id = ${bookingId} and status in ('booked', 'no_show')`,
    ),
  );
}

export async function markNoShow(tx: Tx, raw: z.input<typeof BookingRef>) {
  const { bookingId } = BookingRef.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_bookings set status = 'no_show', checked_in_at = null where id = ${bookingId}`,
    ),
  );
}

export async function cancelBooking(tx: Tx, raw: z.input<typeof BookingRef>) {
  const { bookingId } = BookingRef.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_bookings set status = 'cancelled' where id = ${bookingId} and status = 'booked'`,
    ),
  );
}

export const BookInput = z.object({
  sessionId: id,
  diverId: id.optional(),
  /** Front desk: take payment now (else it shows as unpaid at check-in). */
  method: z.enum(['card', 'cash', 'bit', 'none']).default('none'),
});

/**
 * Books a diver into a session. A valid pass covers training sessions; otherwise the program's price is due (the
 * office can take it on the spot). A customer books themself; the office books anyone.
 */
export async function bookSession(tx: Tx, ctx: ServiceContext, raw: z.input<typeof BookInput>) {
  const input = BookInput.parse(raw);
  const diverId = input.diverId ?? (await myDiverId(tx));
  if (!diverId) throw new DomainError('dive.errors.noDiver');
  const today = await todayIL(tx);
  const { ruleSetId } = await loadRules(tx);
  const s = await one<{
    capacity: number;
    status: string;
    startsAt: string;
    minLevel: number;
    kind: string;
    price: number;
    programId: string;
    title: string;
    booked: number;
  }>(
    tx,
    sql`select x.capacity, x.status, x.starts_at as "startsAt", p.min_level as "minLevel", p.kind,
               p.price_agorot as price, p.id as "programId", coalesce(x.title, p.name_he) as title,
               (select count(*)::int from dive_bookings b where b.session_id = x.id and b.status in ('booked', 'checked_in')) as booked
        from dive_sessions x join dive_programs p on p.id = x.program_id where x.id = ${input.sessionId}`,
  );
  const d = await one<{ level: number; existing: string | null }>(
    tx,
    sql`select cert_level as level,
               (select b.id from dive_bookings b where b.session_id = ${input.sessionId} and b.diver_id = ${diverId}) as existing
        from dive_divers where id = ${diverId}`,
  );
  if (!s || !d) throw new DomainError('common.errors.notFound');
  const decision = bookingDecision(
    {
      capacity: s.capacity,
      booked: s.booked,
      status: s.status,
      startsAt: new Date(s.startsAt),
      minLevel: s.minLevel,
      diverLevel: d.level,
      alreadyBooked: false,
    },
    new Date(),
  );
  if (!decision.ok) throw new DomainError(`dive.errors.${decision.code}`);

  let passId: string | null = null;
  if (s.kind === 'training') {
    const passes = await rows<{
      id: string;
      total: number | null;
      validUntil: string;
      used: number;
    }>(
      tx,
      sql`select ps.id, ps.sessions_total as total, ps.valid_until::text as "validUntil",
                 (select count(*)::int from dive_bookings u where u.pass_id = ps.id and u.status in ('booked', 'checked_in', 'no_show')) as used
          from dive_passes ps where ps.diver_id = ${diverId} order by ps.valid_until`,
    );
    passId =
      passes.find(
        (p) =>
          passBalance({ sessionsTotal: p.total, validUntil: p.validUntil, used: p.used }, today)
            .usable,
      )?.id ?? null;
  }
  const price = passId ? 0 : s.price;
  const via = ctx.userId && (await isCustomer(tx)) ? 'online' : 'office';
  const bookingId = await guarded(async () => {
    if (d.existing) {
      await tx.execute(
        sql`update dive_bookings set status = 'booked', pass_id = ${passId}, price_agorot = ${price}, rule_set_id = ${ruleSetId}
            where id = ${d.existing}`,
      );
      return d.existing;
    }
    const r = await one<{ id: string }>(
      tx,
      sql`insert into dive_bookings (organization_id, session_id, diver_id, pass_id, price_agorot, booked_via, rule_set_id, created_by)
          values (${ctx.orgId}, ${input.sessionId}, ${diverId}, ${passId}, ${price}, ${via}, ${ruleSetId}, ${ctx.userId})
          returning id`,
    );
    return (r as { id: string }).id;
  });
  if (!passId && price > 0 && input.method !== 'none') {
    await recordSale(tx, ctx, {
      diverId,
      kind: s.kind as 'training',
      description: s.title,
      amount: price,
      method: input.method,
      programId: s.programId,
      sessionId: input.sessionId,
    });
  }
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.booking_created',
    payload: { bookingId, sessionId: input.sessionId, diverId, via },
    idempotencyKey: `dive.booking_created:${bookingId}:${Date.now()}`,
  });
  return bookingId;
}

async function isCustomer(tx: Tx): Promise<boolean> {
  const r = await one<{ c: boolean }>(tx, sql`select coalesce(app.is_customer(), false) as c`);
  return r?.c ?? false;
}

async function recordSale(
  tx: Tx,
  ctx: ServiceContext,
  s: {
    diverId: string | null;
    kind: string;
    description: string;
    amount: number;
    method: string;
    programId?: string | null;
    sessionId?: string | null;
  },
) {
  const n = await one<{ n: number }>(tx, sql`select count(*)::int + 1 as n from dive_sales`);
  await guarded(() =>
    tx.execute(
      sql`insert into dive_sales (organization_id, diver_id, kind, description, amount_agorot, method, program_id, session_id, receipt_no, sold_by)
          values (${ctx.orgId}, ${s.diverId}, ${s.kind}, ${s.description}, ${s.amount}, ${s.method},
                  ${s.programId ?? null}, ${s.sessionId ?? null}, ${`R-${String(10000 + (n?.n ?? 1))}`}, ${ctx.userId})`,
    ),
  );
}

// ─── Gear ───────────────────────────────────────────────────────────────────

export const RentInput = z.object({
  gearId: id,
  diverId: id,
  hours: intIn(1, 72).default(4),
  method: z.enum(['card', 'cash', 'bit']).default('card'),
});

export async function rentGear(tx: Tx, ctx: ServiceContext, raw: z.input<typeof RentInput>) {
  const input = RentInput.parse(raw);
  const g = await one<{ price: number; code: string; kind: string }>(
    tx,
    sql`select rental_price_agorot as price, code, kind from dive_gear where id = ${input.gearId}`,
  );
  if (!g) throw new DomainError('common.errors.notFound');
  await guarded(() =>
    tx.execute(
      sql`insert into dive_rentals (organization_id, gear_id, diver_id, due_at, price_agorot)
          values (${ctx.orgId}, ${input.gearId}, ${input.diverId}, now() + make_interval(hours => ${input.hours}::int), ${g.price})`,
    ),
  );
  if (g.price > 0)
    await recordSale(tx, ctx, {
      diverId: input.diverId,
      kind: 'rental',
      description: g.code,
      amount: g.price,
      method: input.method,
    });
}

export const RentalRef = z.object({ rentalId: id, note: optionalText(300) });

export async function returnGear(tx: Tx, raw: z.input<typeof RentalRef>) {
  const input = RentalRef.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_rentals set returned_at = now(), condition_note = ${input.note ?? null}
          where id = ${input.rentalId} and returned_at is null`,
    ),
  );
}

// ─── Leads ──────────────────────────────────────────────────────────────────

export const LeadMove = z.object({ leadId: id, stage: z.enum(LEAD_STAGES) });

export async function moveLead(tx: Tx, raw: z.input<typeof LeadMove>) {
  const input = LeadMove.parse(raw);
  await guarded(() =>
    tx.execute(sql`update dive_leads set stage = ${input.stage} where id = ${input.leadId}`),
  );
}

// ─── In the water ───────────────────────────────────────────────────────────

export const LogInput = z
  .object({
    diverId: id,
    sessionId: optionalId,
    discipline: DiveDiscipline,
    depthM: optionalIntIn(1, 150),
    distanceM: optionalIntIn(1, 300),
    durationSec: optionalIntIn(1, 900),
    outcome: DiveOutcome.default('clean'),
    notes: optionalText(500),
  })
  .refine((v) => v.depthM !== null || v.distanceM !== null || v.durationSec !== null, {
    message: 'dive.errors.measureRequired',
    path: ['depthM'],
  });

export async function logDive(tx: Tx, ctx: ServiceContext, raw: z.input<typeof LogInput>) {
  const input = LogInput.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`insert into dive_logs (organization_id, diver_id, session_id, dived_on, discipline, depth_m, distance_m, duration_sec, outcome, notes, recorded_by)
          values (${ctx.orgId}, ${input.diverId}, ${input.sessionId ?? null}, app.today(), ${input.discipline},
                  ${input.depthM}, ${input.distanceM}, ${input.durationSec}, ${input.outcome}, ${input.notes ?? null}, ${ctx.userId})`,
    ),
  );
  // A dive that ended badly opens an incident for the safety log automatically.
  if (input.outcome === 'lmc' || input.outcome === 'blackout' || input.outcome === 'squeeze') {
    await reportIncident(tx, ctx, {
      diverId: input.diverId,
      sessionId: input.sessionId,
      kind: input.outcome,
      severity: input.outcome === 'blackout' ? 'high' : 'medium',
      depthM: input.depthM ?? undefined,
      description: input.notes || `${input.discipline} ${input.depthM ?? ''}`.trim(),
    });
  }
}

export const IncidentInput = z.object({
  diverId: optionalId,
  sessionId: optionalId,
  kind: DiveIncidentKind,
  severity: DiveSeverity,
  depthM: optionalIntIn(0, 150).optional(),
  description: z.string().trim().min(3).max(1000),
  actionTaken: optionalText(1000),
});

export async function reportIncident(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof IncidentInput>,
) {
  const input = IncidentInput.parse(raw);
  const r = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`insert into dive_incidents (organization_id, diver_id, session_id, occurred_at, kind, severity, depth_m, description, action_taken, reported_by)
          values (${ctx.orgId}, ${input.diverId ?? null}, ${input.sessionId ?? null}, now(), ${input.kind}, ${input.severity},
                  ${input.depthM ?? null}, ${input.description}, ${input.actionTaken ?? null}, ${ctx.userId})
          returning id`,
    ),
  );
  const incidentId = (r as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.incident_reported',
    payload: { incidentId, kind: input.kind, severity: input.severity },
    idempotencyKey: `dive.incident_reported:${incidentId}`,
  });
  return incidentId;
}

export const IncidentClose = z.object({ incidentId: id, actionTaken: optionalText(1000) });

export async function closeIncident(tx: Tx, raw: z.input<typeof IncidentClose>) {
  const input = IncidentClose.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_incidents set status = 'closed', closed_at = now(),
                 action_taken = coalesce(${input.actionTaken ?? null}, action_taken)
          where id = ${input.incidentId}`,
    ),
  );
}

export const ConditionsInput = z.object({
  siteId: optionalId,
  windKts: intIn(0, 60),
  windDir: z.enum(WIND_DIRS),
  waveCm: intIn(0, 500),
  visibilityM: intIn(0, 60),
  waterTempC: intIn(10, 35),
  current: z.enum(CURRENTS).default('none'),
  note: optionalText(300),
});

/** Posts this morning's sea; the call (go / caution / no-go) follows from the club's rules, not from opinion. */
export async function recordConditions(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof ConditionsInput>,
) {
  const input = ConditionsInput.parse(raw);
  const { rules, ruleSetId } = await loadRules(tx);
  const { call } = seaCall(input, rules.sea);
  await guarded(() =>
    tx.execute(
      sql`insert into dive_conditions (organization_id, site_id, observed_on, wind_kts, wind_dir, wave_cm, visibility_m, water_temp_c, current, call, rule_set_id, note, recorded_by)
          values (${ctx.orgId}, ${input.siteId ?? null}, app.today(), ${input.windKts}, ${input.windDir}, ${input.waveCm},
                  ${input.visibilityM}, ${input.waterTempC}, ${input.current}, ${call}, ${ruleSetId}, ${input.note ?? null}, ${ctx.userId})`,
    ),
  );
  return call;
}

export const SessionStatusInput = z.object({
  sessionId: id,
  status: z.enum(DIVE_SESSION_STATUSES),
});

export async function setSessionStatus(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof SessionStatusInput>,
) {
  const input = SessionStatusInput.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_sessions set status = ${input.status} where id = ${input.sessionId}`,
    ),
  );
  if (input.status === 'cancelled' || input.status === 'hold')
    await emit(tx, {
      organizationId: ctx.orgId,
      type: 'dive.session_changed',
      payload: { sessionId: input.sessionId, status: input.status },
      idempotencyKey: `dive.session_changed:${input.sessionId}:${input.status}:${Date.now()}`,
    });
}

export const SessionRef = z.object({ sessionId: id });

/** Applies the suggested line plan: deepest divers on line A, buddies paired by target. */
export async function applyLinePlan(tx: Tx, raw: z.input<typeof SessionRef>) {
  const { sessionId } = SessionRef.parse(raw);
  const card = await one<{ id: string; day: string; siteKind: string; programKind: string }>(
    tx,
    sql`select x.id, (x.starts_at at time zone 'Asia/Jerusalem')::date::text as day, s.kind as "siteKind", p.kind as "programKind"
        from dive_sessions x join dive_sites s on s.id = x.site_id join dive_programs p on p.id = x.program_id
        where x.id = ${sessionId}`,
  );
  if (!card) throw new DomainError('common.errors.notFound');
  const divers = await lineup(tx, {
    id: card.id,
    day: card.day,
    siteKind: card.siteKind,
  } as Parameters<typeof lineup>[1]);
  const plan = planLines(
    divers
      .filter((d) => d.status !== 'no_show')
      .map((d) => ({ id: d.diverId, targetM: d.targetDepthM ?? d.allowedM })),
    3,
  );
  for (const line of plan)
    for (const d of line.divers)
      await guarded(() =>
        tx.execute(
          sql`update dive_bookings set line_label = ${line.line}, buddy_diver_id = ${d.buddyId},
                     target_depth_m = coalesce(target_depth_m, ${d.targetM})
              where session_id = ${sessionId} and diver_id = ${d.id}`,
        ),
      );
}

export const TargetInput = z.object({ bookingId: id, targetDepthM: intIn(1, 130) });

export async function setTarget(tx: Tx, raw: z.input<typeof TargetInput>) {
  const input = TargetInput.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_bookings set target_depth_m = ${input.targetDepthM} where id = ${input.bookingId}`,
    ),
  );
}

export const SkillToggle = z.object({ enrollmentId: id, skill: z.string().regex(/^[a-z0-9_]+$/) });

export async function toggleSkill(tx: Tx, raw: z.input<typeof SkillToggle>) {
  const input = SkillToggle.parse(raw);
  await guarded(() =>
    tx.execute(
      sql`update dive_enrollments set skills = case when ${input.skill} = any(skills)
                                              then array_remove(skills, ${input.skill})
                                              else array_append(skills, ${input.skill}) end
          where id = ${input.enrollmentId}`,
    ),
  );
}

// ─── Customer ───────────────────────────────────────────────────────────────

/** The customer signs the club's waiver for themself (valid for the rules' months). */
export async function signWaiver(tx: Tx) {
  const diverId = await myDiverId(tx);
  if (!diverId) throw new DomainError('dive.errors.noDiver');
  await guarded(() =>
    tx.execute(sql`update dive_divers set waiver_signed_on = app.today() where id = ${diverId}`),
  );
}

export const MedicalInput = z.object({
  medicalExpiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function updateMedical(tx: Tx, raw: z.input<typeof MedicalInput>) {
  const input = MedicalInput.parse(raw);
  const diverId = await myDiverId(tx);
  if (!diverId) throw new DomainError('dive.errors.noDiver');
  await guarded(() =>
    tx.execute(
      sql`update dive_divers set medical_expires_on = ${input.medicalExpiresOn}::date where id = ${diverId}`,
    ),
  );
}
