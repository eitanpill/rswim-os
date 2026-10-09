/**
 * What each role's screens read. Every query runs as the signed-in user, so RLS decides what comes back: an
 * instructor's sales are empty, a customer sees only their own rows.
 */
import { COURSE_SKILLS, type DiveProgramKind, type SeaCall } from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import {
  allowedDepth,
  bookingDecision,
  clubInsights,
  daysBetween,
  expiryState,
  passBalance,
  planLines,
  ratioCheck,
  readiness,
  type Insight,
  type ReadinessItem,
} from '../policies';
import { loadRules, one, rows, todayIL } from './shared';

// ─── Shared shapes ──────────────────────────────────────────────────────────

export interface ConditionsRow {
  observedOn: string;
  isForecast: boolean;
  siteName: string | null;
  windKts: number;
  windDir: string;
  waveCm: number;
  visibilityM: number;
  waterTempC: number;
  current: string;
  call: SeaCall;
  note: string | null;
}

export async function seaOutlook(
  tx: Tx,
  days = 4,
): Promise<{ today: ConditionsRow | null; next: ConditionsRow[] }> {
  const list = await rows<ConditionsRow>(
    tx,
    sql`select distinct on (c.observed_on) c.observed_on::text as "observedOn", c.is_forecast as "isForecast",
               s.name as "siteName", c.wind_kts as "windKts", c.wind_dir as "windDir", c.wave_cm as "waveCm",
               c.visibility_m as "visibilityM", c.water_temp_c as "waterTempC", c.current, c.call, c.note
        from dive_conditions c left join dive_sites s on s.id = c.site_id
        where c.observed_on between app.today() and app.today() + ${days}::int
        order by c.observed_on, c.is_forecast, c.recorded_at desc`,
  );
  const today = await todayIL(tx);
  return {
    today: list.find((c) => c.observedOn === today) ?? null,
    next: list.filter((c) => c.observedOn !== today),
  };
}

export interface SessionCard {
  id: string;
  startsAt: string;
  endsAt: string;
  day: string;
  status: string;
  capacity: number;
  booked: number;
  checkedIn: number;
  title: string;
  programKind: DiveProgramKind;
  programCode: string;
  color: string | null;
  minLevel: number;
  siteName: string;
  siteKind: string;
  leadName: string | null;
  assistName: string | null;
  instructors: number;
  ratio: { needed: number; ok: boolean; perInstructor: number };
}

async function sessionCards(tx: Tx, where: ReturnType<typeof sql>): Promise<SessionCard[]> {
  const { rules } = await loadRules(tx);
  const list = await rows<Omit<SessionCard, 'ratio'>>(
    tx,
    sql`select x.id, x.starts_at as "startsAt", x.ends_at as "endsAt",
               (x.starts_at at time zone 'Asia/Jerusalem')::date::text as day, x.status, x.capacity,
               (select count(*)::int from dive_bookings b where b.session_id = x.id and b.status in ('booked', 'checked_in')) as booked,
               (select count(*)::int from dive_bookings b where b.session_id = x.id and b.status = 'checked_in') as "checkedIn",
               coalesce(x.title, p.name_he) as title, p.kind as "programKind", p.code as "programCode", p.color,
               p.min_level as "minLevel", s.name as "siteName", s.kind as "siteKind",
               l.first_name as "leadName", a.first_name as "assistName",
               ((x.lead_staff_id is not null)::int + (x.assist_staff_id is not null)::int) as instructors
        from dive_sessions x
        join dive_programs p on p.id = x.program_id
        join dive_sites s on s.id = x.site_id
        left join staff_members l on l.id = x.lead_staff_id
        left join staff_members a on a.id = x.assist_staff_id
        where ${where}
        order by x.starts_at`,
  );
  return list.map((s) => ({
    ...s,
    ratio: ratioCheck(s.programKind, s.booked, s.instructors, rules.ratio),
  }));
}

// ─── Owner: the bridge ──────────────────────────────────────────────────────

export interface OwnerBridge {
  today: string;
  sea: Awaited<ReturnType<typeof seaOutlook>>;
  kpis: {
    revenueMonth: number;
    revenueLastMonthSameDay: number;
    activeDivers: number;
    newDivers30d: number;
    sessionsWeek: number;
    fillWeekPct: number;
    daysSinceIncident: number | null;
    courseConversionPct: number;
    passesActive: number;
    avgTicket: number;
  };
  revenueByMonth: { month: string; stream: string; amount: number }[];
  origins: { origin: string; divers: number; revenue: number }[];
  funnel: { level: number; divers: number }[];
  instructors: {
    name: string;
    sessions: number;
    divers: number;
    revenue: number;
    deepest: number | null;
  }[];
  programs: { name: string; kind: string; revenue: number; sold: number }[];
  insights: Insight[];
  todaySessions: SessionCard[];
}

export async function ownerBridge(tx: Tx): Promise<OwnerBridge> {
  const today = await todayIL(tx);
  const { rules } = await loadRules(tx);
  const sea = await seaOutlook(tx, 4);
  const k = (await one<OwnerBridge['kpis']>(
    tx,
    sql`select
      (select coalesce(sum(amount_agorot), 0)::int from dive_sales
         where sold_at >= date_trunc('month', now() at time zone 'Asia/Jerusalem') at time zone 'Asia/Jerusalem') as "revenueMonth",
      (select coalesce(sum(amount_agorot), 0)::int from dive_sales
         where sold_at >= (date_trunc('month', now() at time zone 'Asia/Jerusalem') - interval '1 month') at time zone 'Asia/Jerusalem'
           and sold_at < now() - interval '1 month') as "revenueLastMonthSameDay",
      (select count(distinct b.diver_id)::int from dive_bookings b join dive_sessions x on x.id = b.session_id
         where b.status in ('checked_in', 'booked') and x.starts_at between now() - interval '30 days' and now() + interval '14 days') as "activeDivers",
      (select count(*)::int from dive_divers where joined_on > app.today() - 30) as "newDivers30d",
      (select count(*)::int from dive_sessions where status <> 'cancelled'
         and (starts_at at time zone 'Asia/Jerusalem')::date between app.today() and app.today() + 6) as "sessionsWeek",
      (select coalesce(round(100.0 * sum(b) / nullif(sum(c), 0)), 0)::int from (
         select x.capacity as c, (select count(*) from dive_bookings b where b.session_id = x.id and b.status in ('booked', 'checked_in')) as b
         from dive_sessions x where x.status <> 'cancelled'
           and (x.starts_at at time zone 'Asia/Jerusalem')::date between app.today() and app.today() + 6) w) as "fillWeekPct",
      (select (app.today() - max((occurred_at at time zone 'Asia/Jerusalem')::date))::int from dive_incidents) as "daysSinceIncident",
      (select coalesce(round(100.0 * count(*) filter (where exists (
          select 1 from dive_enrollments e where e.diver_id = d.id)) / nullif(count(*), 0)), 0)::int
         from dive_divers d where exists (
           select 1 from dive_bookings b join dive_sessions x on x.id = b.session_id join dive_programs p on p.id = x.program_id
           where b.diver_id = d.id and p.kind = 'experience' and b.status = 'checked_in')) as "courseConversionPct",
      (select count(*)::int from dive_passes where valid_until >= app.today()) as "passesActive",
      (select coalesce(round(avg(amount_agorot)), 0)::int from dive_sales where sold_at > now() - interval '30 days' and amount_agorot > 0) as "avgTicket"`,
  )) as OwnerBridge['kpis'];

  const revenueByMonth = await rows<OwnerBridge['revenueByMonth'][number]>(
    tx,
    sql`select to_char(date_trunc('month', sold_at at time zone 'Asia/Jerusalem'), 'YYYY-MM') as month,
               case when kind in ('course') then 'courses'
                    when kind in ('training', 'pass') then 'training'
                    when kind in ('experience', 'workshop', 'trip') then 'experiences'
                    else 'gear' end as stream,
               sum(amount_agorot)::int as amount
        from dive_sales
        where sold_at >= date_trunc('month', now() at time zone 'Asia/Jerusalem') - interval '5 months'
        group by 1, 2 order by 1, 2`,
  );
  const origins = await rows<OwnerBridge['origins'][number]>(
    tx,
    sql`select d.origin, count(distinct d.id)::int as divers, coalesce(sum(s.amount_agorot), 0)::int as revenue
        from dive_divers d left join dive_sales s on s.diver_id = d.id and s.sold_at > now() - interval '90 days'
        group by d.origin order by divers desc`,
  );
  const funnel = await rows<OwnerBridge['funnel'][number]>(
    tx,
    sql`select l as level, (select count(*)::int from dive_divers where cert_level >= l) as divers
        from generate_series(1, 4) l order by l`,
  );
  const instructors = await rows<OwnerBridge['instructors'][number]>(
    tx,
    sql`select m.first_name as name,
               count(distinct x.id)::int as sessions,
               count(b.id) filter (where b.status = 'checked_in')::int as divers,
               coalesce((select sum(s.amount_agorot) from dive_sales s join dive_sessions y on y.id = s.session_id
                         where (y.lead_staff_id = m.id) and s.sold_at > now() - interval '30 days'), 0)::int as revenue,
               (select max(g.depth_m)::int from dive_logs g join dive_sessions y on y.id = g.session_id
                 where y.lead_staff_id = m.id and g.dived_on > app.today() - 30) as deepest
        from staff_members m
        join dive_sessions x on x.lead_staff_id = m.id and x.starts_at between now() - interval '30 days' and now()
        left join dive_bookings b on b.session_id = x.id
        group by m.id, m.first_name order by sessions desc`,
  );
  const programs = await rows<OwnerBridge['programs'][number]>(
    tx,
    sql`select coalesce(p.name_he, s.description) as name, coalesce(p.kind, s.kind) as kind,
               sum(s.amount_agorot)::int as revenue, count(*)::int as sold
        from dive_sales s left join dive_programs p on p.id = s.program_id
        where s.sold_at > now() - interval '90 days'
        group by 1, 2 order by revenue desc limit 6`,
  );

  const facts = await one<{
    medicals: number;
    gear: number;
    overdue: number;
    leads: number;
    idle: number;
  }>(
    tx,
    sql`select
      (select count(distinct d.id)::int from dive_divers d join dive_bookings b on b.diver_id = d.id
         join dive_sessions x on x.id = b.session_id
         where b.status = 'booked' and x.starts_at > now()
           and (d.medical_expires_on is null or d.medical_expires_on < app.today() + ${rules.paperwork.medical_warn_days}::int)) as medicals,
      (select count(*)::int from dive_gear where status <> 'retired' and service_every_days is not null
         and coalesce(last_service_on, purchased_on) + service_every_days < app.today()) as gear,
      (select count(*)::int from dive_rentals where returned_at is null
         and due_at < now() - make_interval(mins => ${rules.gear.rental_grace_min}::int)) as overdue,
      (select count(*)::int from dive_leads where stage = 'new' and created_at < now() - interval '1 day') as leads,
      (select count(*)::int from dive_enrollments e where e.status = 'completed' and e.completed_on > app.today() - 90
         and not exists (select 1 from dive_bookings b join dive_sessions x on x.id = b.session_id
                         where b.diver_id = e.diver_id and x.starts_at > (e.completed_on + 1)::timestamptz)) as idle`,
  );
  const forecast = await rows<{
    date: string;
    call: SeaCall;
    windKts: number;
    seaBookings: number;
  }>(
    tx,
    sql`select distinct on (c.observed_on) c.observed_on::text as date, c.call, c.wind_kts as "windKts",
               (select count(*)::int from dive_bookings b join dive_sessions x on x.id = b.session_id
                  join dive_sites s on s.id = x.site_id
                where s.kind <> 'pool' and b.status = 'booked'
                  and (x.starts_at at time zone 'Asia/Jerusalem')::date = c.observed_on) as "seaBookings"
        from dive_conditions c where c.observed_on between app.today() + 1 and app.today() + 4
        order by c.observed_on, c.is_forecast, c.recorded_at desc`,
  );
  const courses = await rows<{ title: string; date: string; booked: number; capacity: number }>(
    tx,
    sql`select coalesce(x.title, p.name_he) as title, (x.starts_at at time zone 'Asia/Jerusalem')::date::text as date,
               (select count(*)::int from dive_bookings b where b.session_id = x.id and b.status in ('booked', 'checked_in')) as booked,
               x.capacity
        from dive_sessions x join dive_programs p on p.id = x.program_id
        where p.kind = 'course' and x.status <> 'cancelled' and x.starts_at > now()
          and x.starts_at = (select min(y.starts_at) from dive_sessions y where y.program_id = x.program_id
                             and y.title is not distinct from x.title and y.starts_at > now())
        order by x.starts_at`,
  );
  const certs = await rows<{ name: string; title: string; days: number }>(
    tx,
    sql`select m.first_name as name, c.title, (c.expires_on - app.today())::int as days
        from dive_staff_certs c join staff_members m on m.id = c.staff_member_id
        where c.expires_on < app.today() + ${rules.staff.cert_warn_days}::int order by c.expires_on`,
  );
  const insights = clubInsights({
    today,
    forecast,
    courses,
    medicalsExpiring: facts?.medicals ?? 0,
    staffCertsExpiring: certs,
    gearServiceDue: facts?.gear ?? 0,
    rentalsOverdue: facts?.overdue ?? 0,
    leadsWaiting: facts?.leads ?? 0,
    daysSinceIncident: k.daysSinceIncident,
    graduatesIdle: facts?.idle ?? 0,
  });
  const todaySessions = await sessionCards(
    tx,
    sql`(x.starts_at at time zone 'Asia/Jerusalem')::date = app.today() and x.status <> 'cancelled'`,
  );
  return {
    today,
    sea,
    kpis: k,
    revenueByMonth,
    origins,
    funnel,
    instructors,
    programs,
    insights,
    todaySessions,
  };
}

// ─── Manager: operations ────────────────────────────────────────────────────

export interface OpsBoard {
  today: string;
  days: string[];
  sessions: SessionCard[];
  outlook: ConditionsRow[];
  staffCerts: {
    name: string;
    title: string;
    kind: string;
    expiresOn: string | null;
    state: string;
  }[];
  paperwork: {
    diverId: string;
    name: string;
    issue: 'medical' | 'waiver';
    on: string;
    sessionTitle: string;
  }[];
  gear: { kind: string; available: number; rented: number; maintenance: number }[];
  serviceDue: { code: string; kind: string; size: string | null; since: string }[];
  incidents: IncidentRow[];
  rules: Awaited<ReturnType<typeof loadRules>>['rules'];
  sites: { id: string; name: string }[];
}

export interface IncidentRow {
  id: string;
  occurredAt: string;
  kind: string;
  severity: string;
  status: string;
  depthM: number | null;
  description: string;
  actionTaken: string | null;
  diverName: string | null;
  sessionTitle: string | null;
}

export async function listIncidents(tx: Tx, limit = 20): Promise<IncidentRow[]> {
  return rows<IncidentRow>(
    tx,
    sql`select i.id, i.occurred_at as "occurredAt", i.kind, i.severity, i.status, i.depth_m as "depthM",
               i.description, i.action_taken as "actionTaken",
               d.first_name || ' ' || d.last_name as "diverName", coalesce(x.title, p.name_he) as "sessionTitle"
        from dive_incidents i
        left join dive_divers d on d.id = i.diver_id
        left join dive_sessions x on x.id = i.session_id
        left join dive_programs p on p.id = x.program_id
        order by i.occurred_at desc limit ${limit}`,
  );
}

export async function opsBoard(tx: Tx): Promise<OpsBoard> {
  const today = await todayIL(tx);
  const { rules } = await loadRules(tx);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const sessions = await sessionCards(
    tx,
    sql`(x.starts_at at time zone 'Asia/Jerusalem')::date between app.today() and app.today() + 6`,
  );
  const outlook = await seaOutlook(tx, 6);
  const staffCerts = (
    await rows<{ name: string; title: string; kind: string; expiresOn: string | null }>(
      tx,
      sql`select m.first_name || ' ' || m.last_name as name, c.title, c.kind, c.expires_on::text as "expiresOn"
          from dive_staff_certs c join staff_members m on m.id = c.staff_member_id
          order by c.expires_on nulls last`,
    )
  ).map((c) => ({ ...c, state: expiryState(c.expiresOn, today, rules.staff.cert_warn_days) }));
  const paperwork = await rows<OpsBoard['paperwork'][number]>(
    tx,
    sql`select distinct on (d.id) d.id as "diverId", d.first_name || ' ' || d.last_name as name,
               case when d.waiver_signed_on is null or d.waiver_signed_on + make_interval(months => ${rules.paperwork.waiver_valid_months}::int) < x.starts_at
                    then 'waiver' else 'medical' end as issue,
               (x.starts_at at time zone 'Asia/Jerusalem')::date::text as on, coalesce(x.title, p.name_he) as "sessionTitle"
        from dive_bookings b join dive_divers d on d.id = b.diver_id
        join dive_sessions x on x.id = b.session_id join dive_programs p on p.id = x.program_id
        where b.status = 'booked' and x.starts_at between now() and now() + interval '14 days'
          and (d.waiver_signed_on is null
               or d.waiver_signed_on + make_interval(months => ${rules.paperwork.waiver_valid_months}::int) < x.starts_at
               or d.medical_expires_on is null
               or d.medical_expires_on < (x.starts_at at time zone 'Asia/Jerusalem')::date + ${rules.paperwork.medical_warn_days}::int)
        order by d.id, x.starts_at`,
  );
  const gear = await rows<OpsBoard['gear'][number]>(
    tx,
    sql`select kind, count(*) filter (where status = 'available')::int as available,
               count(*) filter (where status = 'rented')::int as rented,
               count(*) filter (where status = 'maintenance')::int as maintenance
        from dive_gear where status <> 'retired' group by kind order by kind`,
  );
  const serviceDue = await rows<OpsBoard['serviceDue'][number]>(
    tx,
    sql`select code, kind, size, coalesce(last_service_on, purchased_on)::text as since
        from dive_gear where status <> 'retired' and service_every_days is not null
          and coalesce(last_service_on, purchased_on) + service_every_days < app.today()
        order by coalesce(last_service_on, purchased_on) limit 12`,
  );
  const sites = await rows<{ id: string; name: string }>(
    tx,
    sql`select id, name from dive_sites where active and kind <> 'pool' order by name`,
  );
  return {
    today,
    days,
    sessions,
    outlook: [...(outlook.today ? [outlook.today] : []), ...outlook.next],
    staffCerts,
    paperwork: paperwork.sort((a, b) => a.on.localeCompare(b.on)),
    gear,
    serviceDue,
    incidents: await listIncidents(tx, 8),
    rules,
    sites,
  };
}

// ─── Office: the front desk ─────────────────────────────────────────────────

export interface ArrivalRow {
  bookingId: string;
  diverId: string;
  name: string;
  phone: string | null;
  origin: string;
  status: string;
  checkedInAt: string | null;
  certLevel: number;
  passLeft: number | null;
  ready: boolean;
  items: ReadinessItem[];
}

export interface FrontDesk {
  today: string;
  sessions: (SessionCard & { arrivals: ArrivalRow[] })[];
  leads: {
    id: string;
    name: string;
    phone: string | null;
    source: string;
    origin: string;
    stage: string;
    note: string | null;
    interest: string | null;
    ageHours: number;
    nextActionOn: string | null;
  }[];
  rentals: {
    id: string;
    code: string;
    kind: string;
    size: string | null;
    diver: string;
    dueAt: string;
    overdue: boolean;
  }[];
  sales: {
    id: string;
    soldAt: string;
    description: string;
    diver: string | null;
    amount: number;
    method: string;
  }[];
  salesTotal: number;
  divers: { id: string; name: string }[];
  availableGear: { id: string; code: string; kind: string; size: string | null; price: number }[];
  upcoming: { id: string; label: string }[];
}

async function arrivals(
  tx: Tx,
  sessionIds: string[],
  onDate: string,
): Promise<Map<string, ArrivalRow[]>> {
  const { rules } = await loadRules(tx);
  if (sessionIds.length === 0) return new Map();
  const list = await rows<{
    sessionId: string;
    bookingId: string;
    diverId: string;
    name: string;
    phone: string | null;
    origin: string;
    status: string;
    checkedInAt: string | null;
    certLevel: number;
    waiverSignedOn: string | null;
    medicalExpiresOn: string | null;
    minLevel: number;
    paid: boolean;
    passLeft: number | null;
  }>(
    tx,
    sql`select b.session_id as "sessionId", b.id as "bookingId", d.id as "diverId",
               d.first_name || ' ' || d.last_name as name, d.phone_e164 as phone, d.origin, b.status,
               b.checked_in_at as "checkedInAt", d.cert_level as "certLevel",
               d.waiver_signed_on::text as "waiverSignedOn", d.medical_expires_on::text as "medicalExpiresOn",
               p.min_level as "minLevel",
               (b.pass_id is not null or exists (select 1 from dive_sales s where s.diver_id = d.id
                  and (s.session_id = b.session_id or (s.program_id = x.program_id and p.kind = 'course')))) as paid,
               (select (ps.sessions_total - (select count(*) from dive_bookings u where u.pass_id = ps.id and u.status in ('booked', 'checked_in', 'no_show')))::int
                  from dive_passes ps where ps.id = b.pass_id) as "passLeft"
        from dive_bookings b join dive_divers d on d.id = b.diver_id
        join dive_sessions x on x.id = b.session_id join dive_programs p on p.id = x.program_id
        where b.session_id = any(string_to_array(${sessionIds.join(',')}, ',')::uuid[])
          and b.status <> 'cancelled'
        order by d.first_name`,
  );
  const out = new Map<string, ArrivalRow[]>();
  for (const r of list) {
    const ready = readiness(
      {
        waiverSignedOn: r.waiverSignedOn,
        medicalExpiresOn: r.medicalExpiresOn,
        certLevel: r.certLevel,
        paid: r.paid,
      },
      { onDate, minLevel: r.minLevel },
      rules.paperwork,
    );
    const row: ArrivalRow = {
      bookingId: r.bookingId,
      diverId: r.diverId,
      name: r.name,
      phone: r.phone,
      origin: r.origin,
      status: r.status,
      checkedInAt: r.checkedInAt,
      certLevel: r.certLevel,
      passLeft: r.passLeft,
      ready: ready.ready,
      items: ready.items,
    };
    out.set(r.sessionId, [...(out.get(r.sessionId) ?? []), row]);
  }
  return out;
}

export async function frontDesk(tx: Tx): Promise<FrontDesk> {
  const today = await todayIL(tx);
  const sessions = await sessionCards(
    tx,
    sql`(x.starts_at at time zone 'Asia/Jerusalem')::date = app.today() and x.status <> 'cancelled'`,
  );
  const byS = await arrivals(
    tx,
    sessions.map((s) => s.id),
    today,
  );
  const leads = await rows<FrontDesk['leads'][number]>(
    tx,
    sql`select l.id, l.name, l.phone_e164 as phone, l.source, l.origin, l.stage, l.note, p.name_he as interest,
               (extract(epoch from now() - l.created_at) / 3600)::int as "ageHours", l.next_action_on::text as "nextActionOn"
        from dive_leads l left join dive_programs p on p.id = l.interest_program_id
        where l.stage <> 'lost' or l.updated_at > now() - interval '14 days'
        order by l.created_at desc`,
  );
  const rentals = await rows<FrontDesk['rentals'][number]>(
    tx,
    sql`select r.id, g.code, g.kind, g.size, d.first_name || ' ' || d.last_name as diver, r.due_at as "dueAt",
               (r.due_at < now()) as overdue
        from dive_rentals r join dive_gear g on g.id = r.gear_id join dive_divers d on d.id = r.diver_id
        where r.returned_at is null order by r.due_at`,
  );
  const sales = await rows<FrontDesk['sales'][number]>(
    tx,
    sql`select s.id, s.sold_at as "soldAt", s.description, d.first_name || ' ' || d.last_name as diver,
               s.amount_agorot as amount, s.method
        from dive_sales s left join dive_divers d on d.id = s.diver_id
        where (s.sold_at at time zone 'Asia/Jerusalem')::date = app.today() order by s.sold_at desc`,
  );
  const divers = await rows<{ id: string; name: string }>(
    tx,
    sql`select id, first_name || ' ' || last_name as name from dive_divers order by first_name, last_name`,
  );
  const availableGear = await rows<FrontDesk['availableGear'][number]>(
    tx,
    sql`select id, code, kind, size, rental_price_agorot as price from dive_gear where status = 'available' order by kind, code`,
  );
  const upcoming = await rows<{ id: string; label: string }>(
    tx,
    sql`select x.id, to_char(x.starts_at at time zone 'Asia/Jerusalem', 'DD.MM HH24:MI') || ' · ' || coalesce(x.title, p.name_he) as label
        from dive_sessions x join dive_programs p on p.id = x.program_id
        where x.starts_at > now() and x.starts_at < now() + interval '10 days' and x.status <> 'cancelled'
          and (select count(*) from dive_bookings b where b.session_id = x.id and b.status in ('booked', 'checked_in')) < x.capacity
        order by x.starts_at`,
  );
  return {
    today,
    sessions: sessions.map((s) => ({ ...s, arrivals: byS.get(s.id) ?? [] })),
    leads,
    rentals,
    sales,
    salesTotal: sales.reduce((a, s) => a + s.amount, 0),
    divers,
    availableGear,
    upcoming,
  };
}

// ─── Instructor: my day ─────────────────────────────────────────────────────

export interface LineupDiver extends ArrivalRow {
  pbCwtM: number | null;
  pbStaSec: number | null;
  pbDynM: number | null;
  allowedM: number;
  limitedBy: string;
  targetDepthM: number | null;
  lineLabel: string | null;
  buddyName: string | null;
  lastDive: { on: string; depthM: number | null; outcome: string } | null;
  flags: string[];
}

export interface InstructorDay {
  today: string;
  staffId: string | null;
  sea: Awaited<ReturnType<typeof seaOutlook>>;
  sessions: (SessionCard & {
    lineup: LineupDiver[];
    suggested: ReturnType<typeof planLines>;
    logged: number;
  })[];
  students: {
    enrollmentId: string;
    name: string;
    program: string;
    level: number;
    skills: string[];
    done: string[];
    startedOn: string;
  }[];
  recentLogs: {
    id: string;
    name: string;
    discipline: string;
    depthM: number | null;
    distanceM: number | null;
    durationSec: number | null;
    outcome: string;
    at: string;
  }[];
}

export async function lineup(tx: Tx, session: SessionCard): Promise<LineupDiver[]> {
  const { rules } = await loadRules(tx);
  const base = (await arrivals(tx, [session.id], session.day)).get(session.id) ?? [];
  if (base.length === 0) return [];
  const extra = await rows<{
    diverId: string;
    pbCwtM: number | null;
    pbStaSec: number | null;
    pbDynM: number | null;
    depthLimitM: number | null;
    targetDepthM: number | null;
    lineLabel: string | null;
    buddyName: string | null;
    tags: string[];
    maxDepthM: number;
    lastOn: string | null;
    lastDepth: number | null;
    lastOutcome: string | null;
    incidents: number;
  }>(
    tx,
    sql`select d.id as "diverId", d.pb_cwt_m as "pbCwtM", d.pb_sta_sec as "pbStaSec", d.pb_dyn_m as "pbDynM",
               d.depth_limit_m as "depthLimitM", b.target_depth_m as "targetDepthM", b.line_label as "lineLabel",
               bd.first_name as "buddyName", d.tags, s.max_depth_m as "maxDepthM",
               g.dived_on::text as "lastOn", g.depth_m as "lastDepth", g.outcome as "lastOutcome",
               (select count(*)::int from dive_incidents i where i.diver_id = d.id and i.occurred_at > now() - interval '180 days') as incidents
        from dive_bookings b join dive_divers d on d.id = b.diver_id
        join dive_sessions x on x.id = b.session_id join dive_sites s on s.id = x.site_id
        left join dive_divers bd on bd.id = b.buddy_diver_id
        left join lateral (select dived_on, depth_m, outcome from dive_logs l where l.diver_id = d.id
                           order by dived_on desc, recorded_at desc limit 1) g on true
        where b.session_id = ${session.id}`,
  );
  const byId = new Map(extra.map((e) => [e.diverId, e]));
  return base.map((a) => {
    const e = byId.get(a.diverId);
    const depth = allowedDepth(
      { certLevel: a.certLevel, pbCwtM: e?.pbCwtM ?? null, depthLimitM: e?.depthLimitM ?? null },
      rules.depth,
      session.siteKind === 'pool' ? undefined : e?.maxDepthM,
    );
    const flags = [...(e?.tags ?? [])];
    if ((e?.incidents ?? 0) > 0) flags.push('recent_incident');
    if (e?.lastOutcome && ['lmc', 'blackout', 'squeeze'].includes(e.lastOutcome))
      flags.push('last_dive_issue');
    if (a.certLevel <= 1) flags.push('first_timer');
    return {
      ...a,
      pbCwtM: e?.pbCwtM ?? null,
      pbStaSec: e?.pbStaSec ?? null,
      pbDynM: e?.pbDynM ?? null,
      allowedM: depth.maxM,
      limitedBy: depth.limitedBy,
      targetDepthM: e?.targetDepthM ?? null,
      lineLabel: e?.lineLabel ?? null,
      buddyName: e?.buddyName ?? null,
      lastDive: e?.lastOn
        ? { on: e.lastOn, depthM: e.lastDepth, outcome: e.lastOutcome ?? 'clean' }
        : null,
      flags,
    };
  });
}

export async function instructorDay(tx: Tx, staffId: string | null): Promise<InstructorDay> {
  const today = await todayIL(tx);
  const sea = await seaOutlook(tx, 2);
  const mine = staffId
    ? sql`(x.lead_staff_id = ${staffId} or x.assist_staff_id = ${staffId})`
    : sql`true`;
  const cards = await sessionCards(
    tx,
    sql`${mine} and x.status <> 'cancelled' and (x.starts_at at time zone 'Asia/Jerusalem')::date between app.today() and app.today() + 1`,
  );
  const sessions = [];
  for (const s of cards) {
    const l = await lineup(tx, s);
    const logged = await one<{ n: number }>(
      tx,
      sql`select count(*)::int as n from dive_logs where session_id = ${s.id}`,
    );
    sessions.push({
      ...s,
      lineup: l,
      suggested: planLines(
        l
          .filter((d) => d.status !== 'no_show')
          .map((d) => ({ id: d.diverId, targetM: d.targetDepthM ?? d.allowedM })),
        3,
      ),
      logged: logged?.n ?? 0,
    });
  }
  const students = staffId
    ? await rows<InstructorDay['students'][number]>(
        tx,
        sql`select e.id as "enrollmentId", d.first_name || ' ' || d.last_name as name, p.name_he as program,
                   coalesce(p.grants_level, 2) as level, e.skills as done, e.started_on::text as "startedOn"
            from dive_enrollments e join dive_divers d on d.id = e.diver_id join dive_programs p on p.id = e.program_id
            where e.status = 'active' and e.instructor_staff_id = ${staffId} order by e.started_on`,
      )
    : [];
  const recentLogs = await rows<InstructorDay['recentLogs'][number]>(
    tx,
    sql`select l.id, d.first_name || ' ' || d.last_name as name, l.discipline, l.depth_m as "depthM",
               l.distance_m as "distanceM", l.duration_sec as "durationSec", l.outcome, l.recorded_at as at
        from dive_logs l join dive_divers d on d.id = l.diver_id
        where l.dived_on >= app.today() - 1 ${staffId ? sql`and l.session_id in (select id from dive_sessions where lead_staff_id = ${staffId} or assist_staff_id = ${staffId})` : sql``}
        order by l.recorded_at desc limit 12`,
  );
  return {
    today,
    staffId,
    sea,
    sessions,
    students: students.map((s) => ({ ...s, skills: courseSkills(s.level) })),
    recentLogs,
  };
}

export function courseSkills(level: number): string[] {
  return [...((COURSE_SKILLS as Record<number, readonly string[]>)[level] ?? COURSE_SKILLS[2])];
}

// ─── Customer: my diving ────────────────────────────────────────────────────

export interface DiverHome {
  today: string;
  diver: DiverRecord;
  sea: Awaited<ReturnType<typeof seaOutlook>>;
  next: {
    bookingId: string;
    sessionId: string;
    startsAt: string;
    title: string;
    siteName: string;
    meetingPoint: string | null;
    status: string;
    targetDepthM: number | null;
    lineLabel: string | null;
    leadName: string | null;
  }[];
  readinessItems: ReadinessItem[];
  passes: {
    id: string;
    kind: string;
    remaining: number | null;
    total: number | null;
    daysLeft: number;
    validUntil: string;
    usable: boolean;
  }[];
  depthHistory: { on: string; depthM: number; discipline: string }[];
  enrollments: {
    id: string;
    program: string;
    status: string;
    level: number;
    done: string[];
    skills: string[];
    completedOn: string | null;
    certNumber: string | null;
  }[];
  logbook: {
    id: string;
    on: string;
    discipline: string;
    depthM: number | null;
    distanceM: number | null;
    durationSec: number | null;
    outcome: string;
    site: string | null;
  }[];
  bookable: {
    id: string;
    startsAt: string;
    title: string;
    siteName: string;
    kind: string;
    left: number;
    price: number;
    decision: ReturnType<typeof bookingDecision>;
  }[];
  allowed: ReturnType<typeof allowedDepth>;
  stats: { dives: number; sessions: number; deepest: number | null; hoursUnder: number };
}

export interface DiverRecord {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  origin: string;
  city: string | null;
  country: string | null;
  certLevel: number;
  certAgency: string | null;
  certName: string | null;
  certNumber: string | null;
  pbCwtM: number | null;
  pbFimM: number | null;
  pbStaSec: number | null;
  pbDynM: number | null;
  depthLimitM: number | null;
  medicalExpiresOn: string | null;
  waiverSignedOn: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  joinedOn: string;
}

async function diverRecord(tx: Tx, diverId: string): Promise<DiverRecord | undefined> {
  return one<DiverRecord>(
    tx,
    sql`select id, first_name as "firstName", last_name as "lastName", phone_e164 as phone, email, origin, city, country,
               cert_level as "certLevel", cert_agency as "certAgency", cert_name as "certName", cert_number as "certNumber",
               pb_cwt_m as "pbCwtM", pb_fim_m as "pbFimM", pb_sta_sec as "pbStaSec", pb_dyn_m as "pbDynM",
               depth_limit_m as "depthLimitM", medical_expires_on::text as "medicalExpiresOn",
               waiver_signed_on::text as "waiverSignedOn", emergency_name as "emergencyName",
               emergency_phone as "emergencyPhone", source, tags, notes, joined_on::text as "joinedOn"
        from dive_divers where id = ${diverId}`,
  );
}

export async function diverHome(tx: Tx, diverId: string): Promise<DiverHome | null> {
  const today = await todayIL(tx);
  const { rules } = await loadRules(tx);
  const diver = await diverRecord(tx, diverId);
  if (!diver) return null;
  const sea = await seaOutlook(tx, 3);
  const next = await rows<DiverHome['next'][number]>(
    tx,
    sql`select b.id as "bookingId", x.id as "sessionId", x.starts_at as "startsAt", coalesce(x.title, p.name_he) as title,
               s.name as "siteName", s.meeting_point as "meetingPoint", x.status, b.target_depth_m as "targetDepthM",
               b.line_label as "lineLabel", m.first_name as "leadName"
        from dive_bookings b join dive_sessions x on x.id = b.session_id join dive_programs p on p.id = x.program_id
        join dive_sites s on s.id = x.site_id left join staff_members m on m.id = x.lead_staff_id
        where b.diver_id = ${diverId} and b.status in ('booked', 'checked_in') and x.ends_at > now()
        order by x.starts_at limit 5`,
  );
  const passes = (
    await rows<{
      id: string;
      kind: string;
      total: number | null;
      validUntil: string;
      used: number;
    }>(
      tx,
      sql`select ps.id, ps.kind, ps.sessions_total as total, ps.valid_until::text as "validUntil",
                 (select count(*)::int from dive_bookings u where u.pass_id = ps.id and u.status in ('booked', 'checked_in', 'no_show')) as used
          from dive_passes ps where ps.diver_id = ${diverId} and ps.valid_until >= app.today() - 30
          order by ps.valid_until desc`,
    )
  ).map((p) => ({
    id: p.id,
    kind: p.kind,
    total: p.total,
    validUntil: p.validUntil,
    ...passBalance({ sessionsTotal: p.total, validUntil: p.validUntil, used: p.used }, today),
  }));
  const depthHistory = await rows<DiverHome['depthHistory'][number]>(
    tx,
    sql`select dived_on::text as on, max(depth_m)::int as "depthM", 'CWT' as discipline
        from dive_logs where diver_id = ${diverId} and discipline in ('CWT', 'CWTB', 'FIM')
          and depth_m is not null and outcome in ('clean', 'early_turn')
        group by dived_on order by dived_on`,
  );
  const enrollments = (
    await rows<{
      id: string;
      program: string;
      status: string;
      level: number;
      done: string[];
      completedOn: string | null;
      certNumber: string | null;
    }>(
      tx,
      sql`select e.id, p.name_he as program, e.status, coalesce(p.grants_level, 2) as level, e.skills as done,
                 e.completed_on::text as "completedOn", e.cert_number as "certNumber"
          from dive_enrollments e join dive_programs p on p.id = e.program_id
          where e.diver_id = ${diverId} order by e.started_on`,
    )
  ).map((e) => ({ ...e, skills: courseSkills(e.level) }));
  const logbook = await rows<DiverHome['logbook'][number]>(
    tx,
    sql`select l.id, l.dived_on::text as on, l.discipline, l.depth_m as "depthM", l.distance_m as "distanceM",
               l.duration_sec as "durationSec", l.outcome, s.name as site
        from dive_logs l left join dive_sessions x on x.id = l.session_id left join dive_sites s on s.id = x.site_id
        where l.diver_id = ${diverId} order by l.dived_on desc, l.recorded_at desc limit 12`,
  );
  const stats = (await one<DiverHome['stats']>(
    tx,
    sql`select count(*)::int as dives, count(distinct session_id)::int as sessions, max(depth_m)::int as deepest,
               round(coalesce(sum(coalesce(duration_sec, depth_m * 2.2)), 0) / 3600.0, 1)::float as "hoursUnder"
        from dive_logs where diver_id = ${diverId}`,
  )) as DiverHome['stats'];
  const usablePass = passes.find((p) => p.usable);
  const bookableRaw = await rows<{
    id: string;
    startsAt: string;
    title: string;
    siteName: string;
    kind: string;
    capacity: number;
    booked: number;
    status: string;
    minLevel: number;
    price: number;
    mine: boolean;
  }>(
    tx,
    sql`select x.id, x.starts_at as "startsAt", coalesce(x.title, p.name_he) as title, s.name as "siteName", p.kind,
               x.capacity, x.status, p.min_level as "minLevel", p.price_agorot as price,
               (select count(*)::int from dive_bookings b where b.session_id = x.id and b.status in ('booked', 'checked_in')) as booked,
               exists (select 1 from dive_bookings b where b.session_id = x.id and b.diver_id = ${diverId} and b.status <> 'cancelled') as mine
        from dive_sessions x join dive_programs p on p.id = x.program_id join dive_sites s on s.id = x.site_id
        where x.starts_at between now() and now() + interval '10 days' and p.kind in ('training', 'workshop', 'trip')
          and x.status <> 'cancelled'
        order by x.starts_at`,
  );
  const now = new Date();
  const bookable = bookableRaw
    .filter((b) => !b.mine)
    .map((b) => ({
      id: b.id,
      startsAt: b.startsAt,
      title: b.title,
      siteName: b.siteName,
      kind: b.kind,
      left: Math.max(0, b.capacity - b.booked),
      price: b.kind === 'training' && usablePass ? 0 : b.price,
      decision: bookingDecision(
        {
          capacity: b.capacity,
          booked: b.booked,
          status: b.status,
          startsAt: new Date(b.startsAt),
          minLevel: b.minLevel,
          diverLevel: diver.certLevel,
          alreadyBooked: b.mine,
        },
        now,
      ),
    }));
  const nextDate = next[0]
    ? new Date(next[0].startsAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' })
    : today;
  const readinessItems = readiness(
    {
      waiverSignedOn: diver.waiverSignedOn,
      medicalExpiresOn: diver.medicalExpiresOn,
      certLevel: diver.certLevel,
      paid: true,
    },
    { onDate: nextDate, minLevel: 0 },
    rules.paperwork,
  ).items.filter((i) => i.key === 'waiver' || i.key === 'medical');
  return {
    today,
    diver,
    sea,
    next,
    readinessItems,
    passes,
    depthHistory,
    enrollments,
    logbook,
    bookable,
    allowed: allowedDepth(diver, rules.depth),
    stats,
  };
}

// ─── Staff: a diver's whole story ───────────────────────────────────────────

export interface DiverFile extends DiverHome {
  sales: { id: string; soldAt: string; description: string; amount: number; method: string }[];
  rentals: { id: string; code: string; kind: string; outAt: string; returnedAt: string | null }[];
  incidents: IncidentRow[];
  bookings: { id: string; startsAt: string; title: string; status: string }[];
  lifetimeValue: number;
}

export async function diverFile(tx: Tx, diverId: string): Promise<DiverFile | null> {
  const home = await diverHome(tx, diverId);
  if (!home) return null;
  const sales = await rows<DiverFile['sales'][number]>(
    tx,
    sql`select id, sold_at as "soldAt", description, amount_agorot as amount, method from dive_sales
        where diver_id = ${diverId} order by sold_at desc`,
  );
  const rentals = await rows<DiverFile['rentals'][number]>(
    tx,
    sql`select r.id, g.code, g.kind, r.out_at as "outAt", r.returned_at as "returnedAt"
        from dive_rentals r join dive_gear g on g.id = r.gear_id where r.diver_id = ${diverId} order by r.out_at desc limit 10`,
  );
  const incidents = (await listIncidents(tx, 200)).filter(
    (i) => i.diverName === `${home.diver.firstName} ${home.diver.lastName}`,
  );
  const bookings = await rows<DiverFile['bookings'][number]>(
    tx,
    sql`select b.id, x.starts_at as "startsAt", coalesce(x.title, p.name_he) as title, b.status
        from dive_bookings b join dive_sessions x on x.id = b.session_id join dive_programs p on p.id = x.program_id
        where b.diver_id = ${diverId} order by x.starts_at desc limit 20`,
  );
  return {
    ...home,
    sales,
    rentals,
    incidents,
    bookings,
    lifetimeValue: sales.reduce((a, s) => a + s.amount, 0),
  };
}

export interface DiverListRow {
  id: string;
  name: string;
  origin: string;
  city: string | null;
  certLevel: number;
  certName: string | null;
  pbCwtM: number | null;
  lastDive: string | null;
  dives: number;
  value: number;
  medical: string;
  tags: string[];
}

export async function listDivers(tx: Tx, q?: string): Promise<DiverListRow[]> {
  const today = await todayIL(tx);
  const { rules } = await loadRules(tx);
  const like = q ? `%${q}%` : null;
  const list = await rows<Omit<DiverListRow, 'medical'> & { medicalExpiresOn: string | null }>(
    tx,
    sql`select d.id, d.first_name || ' ' || d.last_name as name, d.origin, d.city, d.cert_level as "certLevel",
               d.cert_name as "certName", d.pb_cwt_m as "pbCwtM", d.tags, d.medical_expires_on::text as "medicalExpiresOn",
               (select max(dived_on)::text from dive_logs l where l.diver_id = d.id) as "lastDive",
               (select count(*)::int from dive_logs l where l.diver_id = d.id) as dives,
               (select coalesce(sum(amount_agorot), 0)::int from dive_sales s where s.diver_id = d.id) as value
        from dive_divers d
        where ${like}::text is null or (d.first_name || ' ' || d.last_name) ilike ${like} or d.phone_e164 ilike ${like}
        order by value desc, d.first_name limit 200`,
  );
  return list.map(({ medicalExpiresOn, ...r }) => ({
    ...r,
    medical: expiryState(medicalExpiresOn, today, rules.paperwork.medical_warn_days),
  }));
}

/** The whole season at a glance, for the owner: days since the club's first session, divers, deepest dive. */
export async function clubRecords(tx: Tx): Promise<{
  deepest: number | null;
  deepestBy: string | null;
  longestSta: number | null;
  dives: number;
  certified90d: number;
}> {
  return (await one(
    tx,
    sql`select (select max(depth_m)::int from dive_logs where outcome = 'clean') as deepest,
               (select d.first_name from dive_logs l join dive_divers d on d.id = l.diver_id
                 where l.outcome = 'clean' order by l.depth_m desc nulls last limit 1) as "deepestBy",
               (select max(duration_sec)::int from dive_logs where discipline = 'STA' and outcome = 'clean') as "longestSta",
               (select count(*)::int from dive_logs where dived_on > app.today() - 30) as dives,
               (select count(*)::int from dive_enrollments where status = 'completed' and completed_on > app.today() - 90) as "certified90d"`,
  )) as {
    deepest: number | null;
    deepestBy: string | null;
    longestSta: number | null;
    dives: number;
    certified90d: number;
  };
}

export { daysBetween };

// ─── Platform: the whole network ────────────────────────────────────────────

export interface NetworkRow {
  organizationId: string;
  name: string;
  slug: string;
  vertical: 'swim' | 'freediving';
  planCode: string | null;
  status: string | null;
  customers: number;
  staff: number;
  sessions30d: number;
  revenue30d: number;
  incidents90d: number;
  next7d: number;
}

/** Every school and club on the platform side by side, for the platform admin (the function checks the caller). */
export async function listNetwork(tx: Tx): Promise<NetworkRow[]> {
  return rows<NetworkRow>(
    tx,
    sql`select organization_id as "organizationId", name, slug, vertical, plan_code as "planCode", status,
               customers::int, staff::int, sessions_30d::int as "sessions30d", revenue_30d::int as "revenue30d",
               incidents_90d::int as "incidents90d", next_7d::int as "next7d"
        from public.platform_network()`,
  );
}
