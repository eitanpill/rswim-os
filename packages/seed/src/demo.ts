/**
 * Fake demo data for local development and demos. Two orgs: the R-SWIM demo tenant and a second tenant that
 * exists to show isolation. Re-running replaces both orgs. NEVER put real client data here.
 */
import { randomUUID } from 'node:crypto';
import { DEMO_ORG, PERSONAS, SECOND_ORG } from '@rswim/db/personas';
import { createDataKey, encryptField } from '@rswim/domain-core';
import type pg from 'pg';
import { seedAttendanceData, type AttendanceDataSummary } from './attendance-data';
import { seedBillingData, type BillingDataSummary } from './billing-data';
import { seedCommsData, type CommsDataSummary } from './comms-data';
import { seedCoreData, type CoreDataSummary } from './core-data';
import { seedSchedulingData, type SchedulingDataSummary } from './scheduling-data';
import { FIRST_BOYS, FIRST_GIRLS, LAST, PARENT_MEN, PARENT_WOMEN } from './names';

export interface SeedOptions {
  /** 32-byte master key. Without it, encrypted fields (medical notes, ID numbers) are left empty. */
  masterKey?: Buffer;
  /** Creates auth users. Plain Postgres: insert into auth.users. Supabase: pass a function using the admin API. */
  ensureUser?: (u: { id: string; email?: string; phone?: string }) => Promise<void>;
}

export interface SeedSummary {
  orgs: number;
  households: number;
  students: number;
  guardians: number;
  staff: number;
  memberships: number;
  /** Phase 1 venues, programs, prices and policies (demo org only). */
  core?: CoreDataSummary;
  /** Phase 2 term, groups, sessions, enrollments, slots and waitlist (demo org only). */
  scheduling?: SchedulingDataSummary;
  /** Phase 3 forms, attendance, notices, credits, makeups, trials and progress (demo org only). */
  attendance?: AttendanceDataSummary;
  /** Phase 4 standing orders, September's approved run and payments, October's draft for review (demo org only). */
  billing?: BillingDataSummary;
  comms?: CommsDataSummary;
}

/** Small deterministic PRNG so the demo data is the same on every run. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

let phoneCounter = 1000;
const fakePhone = () => `+9725000${String(phoneCounter++).padStart(5, '0')}`; // 050-000xxxx: reserved-looking, fake

interface StudentSpec {
  first: string;
  gender: 'female' | 'male';
  dob: string;
  waterFear?: boolean;
  requiresFemaleInstructor?: boolean;
  custodyPattern?: string;
  isSelfGuardian?: boolean;
  medical?: string;
  photoConsent?: boolean;
}

interface HouseholdSpec {
  last: string;
  notes?: string;
  guardians: { first: string; relation: string; phone?: string; billing?: boolean }[];
  students: StudentSpec[];
}

/** The edge cases the brief asks for (§10), each as one household. */
function edgeCaseHouseholds(): HouseholdSpec[] {
  return [
    {
      last: 'כהן',
      notes: 'משפחת דמו של משתמשת ההורה',
      guardians: [
        { first: 'מיכל', relation: 'mother', phone: PERSONAS.parent.phone, billing: true },
      ],
      students: [
        { first: 'יואב', gender: 'male', dob: '2019-03-14' },
        {
          first: 'נועה',
          gender: 'female',
          dob: '2021-07-02',
          waterFear: true,
          medical: 'פחד ממים, להתחיל לאט',
        },
      ],
    },
    {
      last: 'לוי',
      notes: 'תאומים',
      guardians: [{ first: 'רונית', relation: 'mother', billing: true }],
      students: [
        { first: 'תמר', gender: 'female', dob: '2018-11-20' },
        { first: 'איתי', gender: 'male', dob: '2018-11-20' },
      ],
    },
    {
      last: 'מזרחי',
      notes: 'הורים גרושים, שבוע-שבוע. שני ההורים מקבלים עדכונים',
      guardians: [
        { first: 'אורית', relation: 'mother', billing: true },
        { first: 'אבי', relation: 'father' },
      ],
      students: [
        { first: 'מאיה', gender: 'female', dob: '2017-05-09', custodyPattern: 'alternating_weeks' },
      ],
    },
    {
      last: 'פרידמן',
      notes: 'משפחה דתית: מדריכה בלבד, שעות נשים',
      guardians: [{ first: 'אפרת', relation: 'mother', billing: true }],
      students: [
        { first: 'אביגיל', gender: 'female', dob: '2016-09-01', requiresFemaleInstructor: true },
        {
          first: 'הדס',
          gender: 'female',
          dob: '2019-01-15',
          requiresFemaleInstructor: true,
          photoConsent: false,
        },
      ],
    },
    {
      last: 'אזולאי',
      notes: 'ארבעה ילדים, הנחת אחים',
      guardians: [
        { first: 'ליאת', relation: 'mother', billing: true },
        { first: 'יוסי', relation: 'father' },
      ],
      students: [
        { first: 'עידו', gender: 'male', dob: '2014-02-11' },
        { first: 'שירה', gender: 'female', dob: '2016-06-30' },
        { first: 'נדב', gender: 'male', dob: '2018-10-05' },
        { first: 'אלה', gender: 'female', dob: '2021-12-24' },
      ],
    },
    {
      last: 'עמר',
      notes: 'ממומן על ידי מוסד (בית הילד, דמו). חשבוניות למוסד',
      guardians: [{ first: 'סיגל', relation: 'caseworker', billing: true }],
      students: [{ first: 'עומר', gender: 'male', dob: '2015-04-18' }],
    },
    {
      last: 'שפירא',
      notes: 'מצב החזר: משרד הביטחון. קבלות עם הנוסח "טיפולי הידרותרפיה"',
      guardians: [{ first: 'דוד', relation: 'self', billing: true }],
      students: [
        {
          first: 'דוד',
          gender: 'male',
          dob: '1972-08-03',
          isSelfGuardian: true,
          medical: 'שיקום כתף, הידרותרפיה',
        },
      ],
    },
    {
      last: 'גולן',
      notes: 'עולה רמה באמצע החודש',
      guardians: [{ first: 'דנה', relation: 'mother', billing: true }],
      students: [{ first: 'רועי', gender: 'male', dob: '2017-03-27' }],
    },
    {
      last: 'רוזן',
      notes: 'שחיית תינוקות עם אמא במים',
      guardians: [{ first: 'קרן', relation: 'mother', billing: true }],
      students: [{ first: 'מיקה', gender: 'female', dob: '2026-02-10' }],
    },
  ];
}

function regularHouseholds(count: number, random: () => number): HouseholdSpec[] {
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)] as T;
  return Array.from({ length: count }, () => {
    const kids = 1 + Math.floor(random() * 3);
    return {
      last: pick(LAST),
      guardians: [
        { first: pick(PARENT_WOMEN), relation: 'mother', billing: true },
        ...(random() > 0.5 ? [{ first: pick(PARENT_MEN), relation: 'father' }] : []),
      ],
      students: Array.from({ length: kids }, () => {
        const gender = random() > 0.5 ? 'female' : 'male';
        const year = 2014 + Math.floor(random() * 9);
        const month = String(1 + Math.floor(random() * 12)).padStart(2, '0');
        return {
          first: pick(gender === 'female' ? FIRST_GIRLS : FIRST_BOYS),
          gender,
          dob: `${year}-${month}-15`,
        } as StudentSpec;
      }),
    };
  });
}

async function plainPostgresUser(pool: pg.Pool, u: { id: string; email?: string; phone?: string }) {
  await pool.query(
    `insert into auth.users (id, email, phone) values ($1, $2, $3)
     on conflict (id) do update set email = excluded.email, phone = excluded.phone`,
    [u.id, u.email ?? null, u.phone ?? null],
  );
}

/** Seeds both demo orgs. Runs as the database owner in one transaction. */
export async function seedDemo(pool: pg.Pool, options: SeedOptions = {}): Promise<SeedSummary> {
  const ensureUser = options.ensureUser ?? ((u) => plainPostgresUser(pool, u));
  const summary: SeedSummary = {
    orgs: 0,
    households: 0,
    students: 0,
    guardians: 0,
    staff: 0,
    memberships: 0,
  };
  phoneCounter = 1000;

  for (const p of Object.values(PERSONAS)) {
    await ensureUser({
      id: p.userId,
      email: 'email' in p ? p.email : undefined,
      phone: 'phone' in p ? p.phone : undefined,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('delete from organizations where id = any($1)', [
      [DEMO_ORG.id, SECOND_ORG.id],
    ]);
    const q = async (text: string, params: unknown[]) =>
      (await client.query(text, params)).rows[0]?.id as string;

    for (const org of [DEMO_ORG, SECOND_ORG]) {
      const isDemo = org.id === DEMO_ORG.id;
      await client.query(
        `insert into organizations (id, slug, name, legal_name, tax_status) values ($1, $2, $3, $4, 'licensed')`,
        [org.id, org.slug, org.name, `${org.name} (עוסק מורשה, דמו)`],
      );
      await client.query(`insert into org_settings (organization_id) values ($1)`, [org.id]);
      summary.orgs++;

      let dek: Buffer | null = null;
      if (options.masterKey) {
        const k = createDataKey(options.masterKey, org.id);
        dek = k.dek;
        await client.query(`insert into org_keys (organization_id, wrapped_dek) values ($1, $2)`, [
          org.id,
          k.wrapped,
        ]);
      }

      // Staff
      const staffSpecs: [string, string, 'female' | 'male', string][] = isDemo
        ? [
            ['רעות', 'דמו', 'female', 'employee'],
            ['אסף', 'דמו', 'male', 'hybrid'], // payslip for groups + transfer for privates
            ['נועה', 'דמו', 'female', 'employee'],
            ['דני', 'דמו', 'male', 'freelancer_exempt'],
            ['ליה', 'בדיקה', 'female', 'freelancer_licensed'],
          ]
        : [['גלית', 'הדגמה', 'female', 'employee']];
      const staffIds: string[] = [];
      for (const [first, last, gender, type] of staffSpecs) {
        const id = randomUUID();
        await client.query(
          `insert into staff_members (id, organization_id, first_name, last_name, gender, employment_type, phone_e164, start_date, enc_national_id)
           values ($1, $2, $3, $4, $5, $6, $7, '2025-09-01', $8)`,
          [
            id,
            org.id,
            first,
            last,
            gender,
            type,
            fakePhone(),
            dek
              ? encryptField(dek, '000000018', {
                  table: 'staff_members',
                  column: 'enc_national_id',
                  rowId: id,
                })
              : null,
          ],
        );
        staffIds.push(id);
        summary.staff++;
      }

      // Households
      const households = isDemo
        ? [...edgeCaseHouseholds(), ...regularHouseholds(16, rng(5787))]
        : regularHouseholds(3, rng(42));
      let parentGuardianId: string | null = null;
      for (const h of households) {
        const hid = await q(
          `insert into households (organization_id, display_name, notes) values ($1, $2, $3) returning id`,
          [org.id, `משפחת ${h.last}`, h.notes ?? null],
        );
        summary.households++;
        for (const g of h.guardians) {
          const gid = await q(
            `insert into guardians (organization_id, household_id, first_name, last_name, relation, phone_e164, whatsapp_opt_in, is_billing_contact)
             values ($1, $2, $3, $4, $5, $6, true, $7) returning id`,
            [org.id, hid, g.first, h.last, g.relation, g.phone ?? fakePhone(), g.billing ?? false],
          );
          summary.guardians++;
          if (isDemo && g.phone === PERSONAS.parent.phone) parentGuardianId = gid;
        }
        for (const s of h.students) {
          const sid = randomUUID();
          await client.query(
            `insert into students (id, organization_id, household_id, first_name, last_name, dob, gender, water_fear,
                                   requires_female_instructor, custody_pattern, is_self_guardian, photo_consent, enc_medical_notes)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
              sid,
              org.id,
              hid,
              s.first,
              h.last,
              s.dob,
              s.gender,
              s.waterFear ?? false,
              s.requiresFemaleInstructor ?? false,
              s.custodyPattern ?? null,
              s.isSelfGuardian ?? false,
              s.photoConsent ?? true,
              dek && s.medical
                ? encryptField(dek, s.medical, {
                    table: 'students',
                    column: 'enc_medical_notes',
                    rowId: sid,
                  })
                : null,
            ],
          );
          summary.students++;
        }
      }

      if (isDemo) {
        summary.core = await seedCoreData(client, org.id, staffIds);
        summary.scheduling = await seedSchedulingData(client, org.id, staffIds, fakePhone);
        summary.attendance = await seedAttendanceData(client, org.id);
        summary.billing = await seedBillingData(client, org.id, staffIds);
        summary.comms = await seedCommsData(client, org.id, PERSONAS.parent.phone);
      }

      // Memberships (demo org only: the personas)
      if (isDemo) {
        const m = async (
          userId: string,
          role: string,
          extra: { staff?: string; guardian?: string | null; permissions?: string[] } = {},
        ) => {
          await client.query(
            `insert into memberships (organization_id, user_id, role, staff_member_id, guardian_id, permissions) values ($1, $2, $3, $4, $5, $6)`,
            [
              org.id,
              userId,
              role,
              extra.staff ?? null,
              extra.guardian ?? null,
              extra.permissions ?? [],
            ],
          );
          summary.memberships++;
        };
        await m(PERSONAS.owner.userId, 'owner', { staff: staffIds[0] });
        await m(PERSONAS.admin.userId, 'admin', { permissions: ['billing.read', 'billing.write'] });
        await m(PERSONAS.instructor.userId, 'instructor', { staff: staffIds[2] });
        await m(PERSONAS.escort.userId, 'escort', { staff: staffIds[3] });
        await m(PERSONAS.accountant.userId, 'accountant', {
          permissions: ['billing.read', 'payroll.read'],
        });
        await m(PERSONAS.parent.userId, 'parent', { guardian: parentGuardianId });
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
  return summary;
}
