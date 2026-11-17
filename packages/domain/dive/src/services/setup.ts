/**
 * Setting a club up (SaaS stage 4). A new club gets the starter kit the moment it opens (the common programs and its
 * three forms as drafts), and its owner or manager adds the dive sites, edits programs and prices, and puts sessions
 * on the calendar from `/dive/setup`. The database is the gate: only the office (owner, admins) writes these tables,
 * and the plan's limits count divers and open sites.
 */
import { z } from 'zod';
import {
  checkbox,
  DIVE_AGENCIES,
  DIVE_PROGRAM_KINDS,
  DIVE_SITE_KINDS,
  DIVE_STARTER_FORMS,
  DIVE_STARTER_PROGRAMS,
  optionalInt,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
} from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { guarded, one, rows } from './shared';

// ─── The starter kit ────────────────────────────────────────────────────────

/**
 * Adds the starter programs and draft forms to a club that has none of them. Running it again adds nothing: a club
 * that already has programs (or a form of a kind) keeps its own.
 */
export async function installDiveStarterKit(tx: Tx, ctx: ServiceContext) {
  const has = await one<{ programs: number }>(
    tx,
    sql`select count(*)::int programs from dive_programs`,
  );
  let programs = 0;
  if (!has?.programs) {
    for (const p of DIVE_STARTER_PROGRAMS) {
      await guarded(() =>
        tx.execute(
          sql`insert into dive_programs (organization_id, code, name_he, name_en, kind, agency, min_level, grants_level,
                                         days, duration_min, max_depth_m, price_agorot, color, description)
              values (${ctx.orgId}, ${p.code}, ${p.nameHe}, ${p.nameEn}, ${p.kind}, ${p.agency}, ${p.minLevel},
                      ${p.grantsLevel}, ${p.days}, ${p.durationMin}, ${p.maxDepthM}, ${p.priceAgorot}, ${p.color},
                      ${p.description})`,
        ),
      );
      programs++;
    }
  }
  const kinds = new Set(
    (await rows<{ kind: string }>(tx, sql`select distinct kind from dive_form_templates`)).map(
      (r) => r.kind,
    ),
  );
  let forms = 0;
  for (const f of DIVE_STARTER_FORMS) {
    if (kinds.has(f.kind)) continue;
    await guarded(() =>
      tx.execute(
        sql`insert into dive_form_templates (organization_id, kind, version, title, body, questions, created_by)
            values (${ctx.orgId}, ${f.kind}, 1, ${f.title}, ${f.body}, ${JSON.stringify(f.questions)}::jsonb,
                    ${ctx.userId})`,
      ),
    );
    forms++;
  }
  return { programs, forms };
}

// ─── What the setup screen shows ────────────────────────────────────────────

export interface SetupSite {
  id: string;
  name: string;
  kind: string;
  maxDepthM: number;
  hasLine: boolean;
  meetingPoint: string | null;
  active: boolean;
}
export interface SetupProgram {
  id: string;
  code: string;
  nameHe: string;
  kind: string;
  agency: string;
  minLevel: number;
  durationMin: number;
  priceAgorot: number;
  active: boolean;
}
export interface ClubSetup {
  sites: SetupSite[];
  programs: SetupProgram[];
  instructors: { id: string; name: string }[];
  upcomingSessions: number;
  publishedForms: number;
  /** The first steps, done or not, in the order a new club takes them. */
  steps: { key: 'site' | 'programs' | 'forms' | 'session' | 'staff'; done: boolean }[];
}

export async function clubSetup(tx: Tx): Promise<ClubSetup> {
  const sites = await rows<SetupSite>(
    tx,
    sql`select id, name, kind, max_depth_m "maxDepthM", has_line "hasLine", meeting_point "meetingPoint", active
        from dive_sites order by active desc, name`,
  );
  const programs = await rows<SetupProgram>(
    tx,
    sql`select id, code, name_he "nameHe", kind, agency, min_level "minLevel", duration_min "durationMin",
               price_agorot "priceAgorot", active
        from dive_programs order by active desc, min_level, name_he`,
  );
  const instructors = await rows<{ id: string; name: string }>(
    tx,
    sql`select id, btrim(first_name || ' ' || coalesce(last_name, '')) as name
        from staff_members where status = 'active' order by first_name`,
  );
  const f = await one<{ upcoming: number; published: number; touched: number; invites: number }>(
    tx,
    sql`select (select count(*)::int from dive_sessions where starts_at > now() and status <> 'cancelled') upcoming,
               (select count(*)::int from staff_invites where revoked_at is null) invites,
               (select count(distinct kind)::int from dive_form_templates where published_at is not null) published,
               ((select count(*) from dive_programs where updated_at > created_at)
                 + (select count(*) from dive_sessions))::int touched`,
  );
  const facts = f ?? { upcoming: 0, published: 0, touched: 0, invites: 0 };
  return {
    sites,
    programs,
    instructors,
    upcomingSessions: facts.upcoming,
    publishedForms: facts.published,
    steps: [
      { key: 'site', done: sites.some((s) => s.active) },
      { key: 'programs', done: facts.touched > 0 },
      { key: 'forms', done: facts.published > 0 },
      { key: 'session', done: facts.upcoming > 0 },
      { key: 'staff', done: instructors.length + facts.invites > 0 },
    ],
  };
}

// ─── Sites ──────────────────────────────────────────────────────────────────

const optionalId = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.uuid().optional(),
);

export const SiteInput = z.object({
  id: optionalId,
  name: requiredText(80),
  kind: z.enum(DIVE_SITE_KINDS, { message: 'forms.errors.invalid' }),
  maxDepthM: requiredInt(1, 150),
  hasLine: checkbox(),
  meetingPoint: optionalText(200),
  active: checkbox(),
});
export type SiteInput = z.output<typeof SiteInput>;

/** Adds a dive site, or edits one. A site already used by sessions is closed (not deleted) by unticking "open". */
export async function saveSite(tx: Tx, ctx: ServiceContext, input: SiteInput): Promise<string> {
  if (input.id) {
    const done = await guarded(() =>
      rows<{ id: string }>(
        tx,
        sql`update dive_sites set name = ${input.name}, kind = ${input.kind}, max_depth_m = ${input.maxDepthM},
                   has_line = ${input.hasLine}, meeting_point = ${input.meetingPoint}, active = ${input.active}
            where id = ${input.id} returning id`,
      ),
    );
    if (!done.length) throw new DomainError('common.errors.notFound');
    return input.id;
  }
  const r = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`insert into dive_sites (organization_id, name, kind, max_depth_m, has_line, meeting_point, active)
          values (${ctx.orgId}, ${input.name}, ${input.kind}, ${input.maxDepthM}, ${input.hasLine},
                  ${input.meetingPoint}, true)
          returning id`,
    ),
  );
  return (r as { id: string }).id;
}

// ─── Programs ───────────────────────────────────────────────────────────────

/** Shekels from the form ("390" or "390.50") into agorot. */
const shekels = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : Math.round(Number(v) * 100)),
  z.int('forms.errors.number').min(0, 'forms.errors.range').max(10_000_000, 'forms.errors.range'),
);

export const ProgramInput = z.object({
  id: optionalId,
  nameHe: requiredText(80),
  kind: z.enum(DIVE_PROGRAM_KINDS, { message: 'forms.errors.invalid' }),
  agency: z.enum(DIVE_AGENCIES, { message: 'forms.errors.invalid' }).default('club'),
  minLevel: requiredInt(0, 5),
  durationMin: requiredInt(15, 720),
  price: shekels,
  active: checkbox(),
});
export type ProgramInput = z.output<typeof ProgramInput>;

/** Edits a program's name, price and who may join, or adds a new one (its code is made from the time). */
export async function saveProgram(
  tx: Tx,
  ctx: ServiceContext,
  input: ProgramInput,
): Promise<string> {
  if (input.id) {
    const done = await guarded(() =>
      rows<{ id: string }>(
        tx,
        sql`update dive_programs set name_he = ${input.nameHe}, kind = ${input.kind}, agency = ${input.agency},
                   min_level = ${input.minLevel}, duration_min = ${input.durationMin},
                   price_agorot = ${input.price}, active = ${input.active}
            where id = ${input.id} returning id`,
      ),
    );
    if (!done.length) throw new DomainError('common.errors.notFound');
    return input.id;
  }
  const r = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`insert into dive_programs (organization_id, code, name_he, name_en, kind, agency, min_level, duration_min,
                                     price_agorot, active)
          values (${ctx.orgId}, 'p' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS'), ${input.nameHe},
                  ${input.nameHe}, ${input.kind}, ${input.agency}, ${input.minLevel}, ${input.durationMin},
                  ${input.price}, true)
          returning id`,
    ),
  );
  return (r as { id: string }).id;
}

// ─── Sessions ───────────────────────────────────────────────────────────────

export const SessionsInput = z.object({
  programId: z.uuid('forms.errors.required'),
  siteId: z.uuid('forms.errors.required'),
  date: requiredDate(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'forms.errors.invalid'),
  capacity: requiredInt(1, 60),
  leadStaffId: optionalId,
  /** The same day and hour every week, this many weeks (1 = just this one). */
  weeks: optionalInt(1, 26),
});
export type SessionsInput = z.output<typeof SessionsInput>;

/**
 * Puts a session on the calendar (Israel time), or the same session weekly for a few weeks. It lasts as long as its
 * program. Returns how many were added. A date in the past is refused.
 */
export async function addSessions(
  tx: Tx,
  ctx: ServiceContext,
  input: SessionsInput,
): Promise<number> {
  const weeks = input.weeks ?? 1;
  const program = await one<{ duration: number; active: boolean }>(
    tx,
    sql`select duration_min duration, active from dive_programs where id = ${input.programId}`,
  );
  if (!program || !program.active) throw new DomainError('dive.setup.errors.program');
  const site = await one<{ active: boolean }>(
    tx,
    sql`select active from dive_sites where id = ${input.siteId}`,
  );
  if (!site || !site.active) throw new DomainError('dive.setup.errors.site');
  const past = await one<{ past: boolean }>(
    tx,
    sql`select ((${input.date}::date + ${input.time}::time) at time zone 'Asia/Jerusalem') < now() as past`,
  );
  if (past?.past) throw new DomainError('dive.setup.errors.past');
  const added = await guarded(() =>
    rows<{ id: string }>(
      tx,
      sql`insert into dive_sessions (organization_id, program_id, site_id, starts_at, ends_at, lead_staff_id, capacity)
          select ${ctx.orgId}, ${input.programId}, ${input.siteId}, s, s + make_interval(mins => ${program.duration}),
                 ${input.leadStaffId ?? null}, ${input.capacity}
          from generate_series(0, ${weeks - 1}) w,
               lateral (select ((${input.date}::date + w * 7) + ${input.time}::time) at time zone 'Asia/Jerusalem' s) x
          returning id`,
    ),
  );
  return added.length;
}

// ─── Divers brought in from a file ──────────────────────────────────────────

export interface NewDiver {
  firstName: string;
  lastName: string;
  phoneE164: string | null;
  email: string | null;
  dob: string | null;
  gender: 'female' | 'male' | null;
  certLevel: number;
  certAgency: string | null;
  certNumber: string | null;
  city: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  notes: string | null;
  source: string;
}

/** Adds a diver the office already knows (an import from the club's previous system). The plan's limit applies. */
export async function addDiver(tx: Tx, ctx: ServiceContext, d: NewDiver): Promise<string> {
  const r = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`insert into dive_divers (organization_id, first_name, last_name, phone_e164, email, dob, gender, cert_level,
                                   cert_agency, cert_number, city, emergency_name, emergency_phone, notes, source)
          values (${ctx.orgId}, ${d.firstName}, ${d.lastName}, ${d.phoneE164}, ${d.email}, ${d.dob}, ${d.gender},
                  ${d.certLevel}, ${d.certAgency}, ${d.certNumber}, ${d.city}, ${d.emergencyName},
                  ${d.emergencyPhone}, ${d.notes}, ${d.source})
          returning id`,
    ),
  );
  return (r as { id: string }).id;
}
