import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { OrgRole, Permission } from '@rswim/contracts';

export interface OrgFixture {
  orgId: string;
  /** user id per role */
  users: Record<
    'owner' | 'admin' | 'adminSensitive' | 'instructor' | 'escort' | 'accountant' | 'parent',
    string
  >;
  staff: { instructor: string; escort: string; admin: string };
  households: { mine: string; other: string };
  students: { mine: string; other: string };
  guardians: { mine: string; other: string };
  /** Phase 1 core data, one row per table. */
  core: {
    venue: string;
    pool: string;
    lane: string;
    window: string;
    closure: string;
    contract: string;
    program: string;
    level: string;
    policySet: string;
    priceList: string;
    priceItem: string;
    certification: string;
    availabilityRule: string;
    availabilityException: string;
    payRule: string;
    invite: string;
    importRun: string;
  };
}

async function user(pool: pg.Pool, label: string): Promise<string> {
  const id = randomUUID();
  await pool.query(`insert into auth.users (id, email) values ($1, $2)`, [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
  ]);
  return id;
}

async function member(
  pool: pg.Pool,
  orgId: string,
  userId: string,
  role: OrgRole,
  extra: { permissions?: Permission[]; staffMemberId?: string; guardianId?: string } = {},
) {
  await pool.query(
    `insert into memberships (organization_id, user_id, role, permissions, staff_member_id, guardian_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      orgId,
      userId,
      role,
      extra.permissions ?? [],
      extra.staffMemberId ?? null,
      extra.guardianId ?? null,
    ],
  );
}

/** Builds one fully populated org using the owner connection (bypasses RLS). Data is fake. */
export async function createOrgFixture(pool: pg.Pool, slug: string): Promise<OrgFixture> {
  const q = async (text: string, params: unknown[]) =>
    (await pool.query(text, params)).rows[0].id as string;
  const orgId = await q(`insert into organizations (slug, name) values ($1, $2) returning id`, [
    slug,
    `ארגון ${slug}`,
  ]);
  await pool.query(`insert into org_settings (organization_id) values ($1)`, [orgId]);
  await pool.query(`insert into org_keys (organization_id, wrapped_dek) values ($1, '\\x00')`, [
    orgId,
  ]);
  await pool.query(
    `insert into feature_flags (organization_id, key, enabled) values ($1, 'demo', true)`,
    [orgId],
  );

  const staff = async (first: string, type = 'employee') =>
    q(
      `insert into staff_members (organization_id, first_name, last_name, employment_type, enc_national_id)
       values ($1, $2, 'בדיקה', $3, '\\x01') returning id`,
      [orgId, first, type],
    );
  const instructorStaff = await staff('נועה');
  const escortStaff = await staff('דני', 'freelancer_exempt');
  const adminStaff = await staff('אסף', 'hybrid');

  const household = async (name: string) =>
    q(`insert into households (organization_id, display_name) values ($1, $2) returning id`, [
      orgId,
      name,
    ]);
  const hMine = await household('משפחת כהן');
  const hOther = await household('משפחת לוי');
  const guardian = async (h: string, first: string) =>
    q(
      `insert into guardians (organization_id, household_id, first_name, last_name, phone_e164)
       values ($1, $2, $3, 'בדיקה', '+972500000000') returning id`,
      [orgId, h, first],
    );
  const gMine = await guardian(hMine, 'מיכל');
  const gOther = await guardian(hOther, 'רונית');
  const student = async (h: string, first: string) =>
    q(
      `insert into students (organization_id, household_id, first_name, last_name, enc_medical_notes)
       values ($1, $2, $3, 'בדיקה', '\\xdeadbeef') returning id`,
      [orgId, h, first],
    );
  const sMine = await student(hMine, 'יואב');
  const sOther = await student(hOther, 'תמר');

  const users = {
    owner: await user(pool, 'owner'),
    admin: await user(pool, 'admin'),
    adminSensitive: await user(pool, 'admin-sensitive'),
    instructor: await user(pool, 'instructor'),
    escort: await user(pool, 'escort'),
    accountant: await user(pool, 'accountant'),
    parent: await user(pool, 'parent'),
  };
  await member(pool, orgId, users.owner, 'owner');
  await member(pool, orgId, users.admin, 'admin', { staffMemberId: adminStaff });
  await member(pool, orgId, users.adminSensitive, 'admin', {
    permissions: ['sensitive.read', 'audit.read'],
  });
  await member(pool, orgId, users.instructor, 'instructor', { staffMemberId: instructorStaff });
  await member(pool, orgId, users.escort, 'escort', { staffMemberId: escortStaff });
  await member(pool, orgId, users.accountant, 'accountant', {
    permissions: ['billing.read', 'payroll.read'],
  });
  await member(pool, orgId, users.parent, 'parent', { guardianId: gMine });

  const core = await createCoreData(pool, orgId, instructorStaff, sMine, sOther);

  return {
    orgId,
    users,
    core,
    staff: { instructor: instructorStaff, escort: escortStaff, admin: adminStaff },
    households: { mine: hMine, other: hOther },
    students: { mine: sMine, other: sOther },
    guardians: { mine: gMine, other: gOther },
  };
}

async function createCoreData(
  pool: pg.Pool,
  orgId: string,
  instructorStaff: string,
  s1: string,
  s2: string,
): Promise<OrgFixture['core']> {
  const q = async (text: string, params: unknown[]) =>
    (await pool.query(text, params)).rows[0].id as string;
  const venue = await q(
    `insert into venues (organization_id, name, kind) values ($1, 'בריכת בדיקה', 'country_club') returning id`,
    [orgId],
  );
  const poolId = await q(
    `insert into pools (organization_id, venue_id, name) values ($1, $2, 'בריכה מקורה') returning id`,
    [orgId, venue],
  );
  const lane = await q(
    `insert into lanes (organization_id, pool_id, label, ordinal) values ($1, $2, '1', 1) returning id`,
    [orgId, poolId],
  );
  const window = await q(
    `insert into venue_operating_windows (organization_id, venue_id, pool_id, weekday, starts_at, ends_at, gender_restriction, effective_from)
     values ($1, $2, $3, 1, '15:00', '19:00', 'female', '2026-09-01') returning id`,
    [orgId, venue, poolId],
  );
  await pool.query(
    `insert into operating_window_lanes (organization_id, pool_id, window_id, lane_id) values ($1, $2, $3, $4)`,
    [orgId, poolId, window, lane],
  );
  const closure = await q(
    `insert into venue_closures (organization_id, venue_id, starts_on, ends_on, source, reason)
     values ($1, $2, '2026-12-01', '2026-12-03', 'technical', 'תקלה במערכת החימום') returning id`,
    [orgId, venue],
  );
  const contract = await q(
    `insert into venue_contracts (organization_id, venue_id, rent_model, amount_agorot) values ($1, $2, 'fixed_monthly', 1000000) returning id`,
    [orgId, venue],
  );
  const program = await q(
    `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity)
     values ($1, 'group', 'group_kids', 'קבוצת ילדים', 40, 6) returning id`,
    [orgId],
  );
  const level = await q(
    `insert into levels (organization_id, program_id, code, name_he, ordinal) values ($1, $2, 'beginners', 'מתחילים', 1) returning id`,
    [orgId, program],
  );
  const policySet = await q(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules) values ($1, 'org', '2026-01-01', '{"absence":{"notice_min_hours":12}}') returning id`,
    [orgId],
  );
  const priceList = await q(
    `insert into price_lists (organization_id, name, effective_from) values ($1, 'מחירון', '2026-09-01') returning id`,
    [orgId],
  );
  const priceItem = await q(
    `insert into price_items (organization_id, price_list_id, program_id, kind, amount_agorot) values ($1, $2, $3, 'monthly', 33000) returning id`,
    [orgId, priceList, program],
  );
  await pool.query(`update price_lists set status = 'published' where id = $1`, [priceList]);
  const certification = await q(
    `insert into certifications (organization_id, staff_member_id, type, expires_on) values ($1, $2, 'lifeguard', '2027-06-30') returning id`,
    [orgId, instructorStaff],
  );
  const availabilityRule = await q(
    `insert into availability_rules (organization_id, staff_member_id, weekday, starts_at, ends_at, effective_from)
     values ($1, $2, 0, '14:00', '19:00', '2026-09-01') returning id`,
    [orgId, instructorStaff],
  );
  const availabilityException = await q(
    `insert into availability_exceptions (organization_id, staff_member_id, kind, starts_on, ends_on) values ($1, $2, 'unavailable', '2026-11-01', '2026-11-07') returning id`,
    [orgId, instructorStaff],
  );
  const payRule = await q(
    `insert into pay_rules (organization_id, staff_member_id, basis, amount_agorot, effective_from) values ($1, $2, 'per_session', 8000, '2026-01-01') returning id`,
    [orgId, instructorStaff],
  );
  const invite = await q(
    `insert into staff_invites (organization_id, role, email, token_hash, expires_at)
     values ($1, 'instructor', 'new@example.test', encode(sha256(convert_to($2, 'UTF8')), 'hex'), now() + interval '7 days') returning id`,
    [orgId, `token-${orgId}`],
  );
  const [a, b] = [s1, s2].sort();
  await pool.query(
    `insert into student_relations (organization_id, student_id, related_student_id, type) values ($1, $2, $3, 'friend')`,
    [orgId, a, b],
  );
  const importRun = await q(
    `insert into import_runs (organization_id, provider, kind) values ($1, 'ghl', 'contacts') returning id`,
    [orgId],
  );
  return {
    venue,
    pool: poolId,
    lane,
    window,
    closure,
    contract,
    program,
    level,
    policySet,
    priceList,
    priceItem,
    certification,
    availabilityRule,
    availabilityException,
    payRule,
    invite,
    importRun,
  };
}
