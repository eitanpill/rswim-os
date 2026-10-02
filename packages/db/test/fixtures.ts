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

  return {
    orgId,
    users,
    staff: { instructor: instructorStaff, escort: escortStaff, admin: adminStaff },
    households: { mine: hMine, other: hOther },
    students: { mine: sMine, other: sOther },
    guardians: { mine: gMine, other: gOther },
  };
}
