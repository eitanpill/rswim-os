/**
 * Phase 1 demo data for the R-SWIM demo tenant: venues with gender windows, programs and level ladders, two
 * versions of the price list, the org policy, staff certificates, availability and pay rules. All fake.
 * Venue names are invented; the E2E test configures its own Har Homa-style venue through the UI.
 */
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import { RSWIM_TAG_MAP } from '@rswim/domain-crm/policies';
import type pg from 'pg';

type Q = (text: string, params: unknown[]) => Promise<string>;

export interface CoreDataSummary {
  venues: number;
  windows: number;
  programs: number;
  priceItems: number;
}

const SEASON_START = '2026-09-01';
const PRICE_RAISE = '2027-01-01';

export async function seedCoreData(
  client: pg.PoolClient,
  orgId: string,
  staffIds: readonly string[],
): Promise<CoreDataSummary> {
  const q: Q = async (text, params) => (await client.query(text, params)).rows[0]?.id as string;
  const summary: CoreDataSummary = { venues: 0, windows: 0, programs: 0, priceItems: 0 };

  // ─── Venues ───────────────────────────────────────────────────────────────
  const venueSpecs = [
    {
      name: 'קאנטרי הדמו - ירושלים',
      kind: 'country_club',
      city: 'ירושלים',
      frontDesk: 'אנחנו מקבוצת השחייה (דמו)',
      lanes: 4,
      // Gender-separated days, as in religious neighbourhoods (brief §5).
      windows: [
        { weekday: 1, startsAt: '16:00', endsAt: '19:00', gender: 'female', lanes: [1, 2, 3, 4] },
        { weekday: 3, startsAt: '16:00', endsAt: '19:00', gender: 'male', lanes: [1, 2, 3, 4] },
        { weekday: 0, startsAt: '15:00', endsAt: '18:00', gender: 'mixed', lanes: [3, 4] },
      ],
    },
    {
      name: 'בריכת הדמו - גוש עציון',
      kind: 'municipal',
      city: 'גוש עציון',
      frontDesk: null,
      lanes: 6,
      windows: [
        { weekday: 2, startsAt: '15:30', endsAt: '19:30', gender: 'mixed', lanes: [5, 6] },
        { weekday: 4, startsAt: '15:30', endsAt: '19:30', gender: 'mixed', lanes: [5, 6] },
      ],
    },
  ] as const;
  const venueIds: string[] = [];
  for (const v of venueSpecs) {
    const venueId = await q(
      `insert into venues (organization_id, name, kind, status, city, front_desk_script, entry_instructions)
       values ($1, $2, $3, 'active', $4, $5, 'הכניסה מהשער הצדדי. להציג את אישור ההרשמה.') returning id`,
      [orgId, v.name, v.kind, v.city, v.frontDesk],
    );
    venueIds.push(venueId);
    summary.venues++;
    const poolId = await q(
      `insert into pools (organization_id, venue_id, name, indoor, temp_min_c, temp_max_c) values ($1, $2, 'בריכה מקורה', true, 28, 30) returning id`,
      [orgId, venueId],
    );
    const laneIds: string[] = [];
    for (let i = 1; i <= v.lanes; i++) {
      laneIds.push(
        await q(
          `insert into lanes (organization_id, pool_id, label, ordinal) values ($1, $2, $3, $4) returning id`,
          [orgId, poolId, String(i), i],
        ),
      );
    }
    for (const w of v.windows) {
      const windowId = await q(
        `insert into venue_operating_windows (organization_id, venue_id, pool_id, weekday, starts_at, ends_at, gender_restriction, effective_from)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [orgId, venueId, poolId, w.weekday, w.startsAt, w.endsAt, w.gender, SEASON_START],
      );
      for (const n of w.lanes) {
        await client.query(
          `insert into operating_window_lanes (organization_id, pool_id, window_id, lane_id) values ($1, $2, $3, $4)`,
          [orgId, poolId, windowId, laneIds[n - 1]],
        );
      }
      summary.windows++;
    }
  }
  const [jerusalem, gush] = venueIds as [string, string];
  await client.query(
    `insert into venue_contracts (organization_id, venue_id, kind, rent_model, amount_agorot, starts_on, ends_on, renewal_on)
     values ($1, $2, 'rent', 'per_lane_hour', 9000, '2026-09-01', '2027-08-31', '2027-06-01')`,
    [orgId, jerusalem],
  );
  await client.query(
    `insert into venue_closures (organization_id, venue_id, starts_on, ends_on, source, reason)
     values ($1, $2, '2026-12-14', '2026-12-16', 'technical', 'החלפת מסננים (דמו)')`,
    [orgId, gush],
  );

  // ─── Programs and levels ──────────────────────────────────────────────────
  const programSpecs = [
    {
      code: 'kids-group',
      kind: 'group_kids',
      he: 'קבוצת ילדים',
      dur: 45,
      cap: 6,
      min: 48,
      max: 168,
      levels: ['צפרדע', 'דג זהב', 'דולפין', 'כריש'],
    },
    {
      code: 'babies',
      kind: 'baby',
      he: 'שחיית תינוקות',
      dur: 30,
      cap: 6,
      min: 3,
      max: 36,
      parent: true,
      levels: ['היכרות עם המים', 'צלילות ראשונות'],
    },
    {
      code: 'private',
      kind: 'private',
      he: 'שיעור פרטי',
      dur: 30,
      cap: 1,
      min: null,
      max: null,
      levels: [],
    },
    {
      code: 'adults',
      kind: 'adult_beginner',
      he: 'מבוגרים מתחילים',
      dur: 45,
      cap: 8,
      min: 216,
      max: null,
      levels: ['ציפה ונשימה', 'חתירה'],
    },
  ] as const;
  const programIds: Record<string, string> = {};
  for (const [i, p] of programSpecs.entries()) {
    const pid = await q(
      `insert into programs (organization_id, code, kind, name_he, default_duration_min, default_capacity, min_age_months, max_age_months, parent_in_water, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [orgId, p.code, p.kind, p.he, p.dur, p.cap, p.min, p.max, 'parent' in p, i],
    );
    programIds[p.code] = pid;
    summary.programs++;
    for (const [j, name] of p.levels.entries()) {
      await client.query(
        `insert into levels (organization_id, program_id, code, name_he, ordinal, skills) values ($1, $2, $3, $4, $5, $6)`,
        [
          orgId,
          pid,
          `l${j + 1}`,
          name,
          j + 1,
          JSON.stringify([
            { code: 's1', he: 'נשיפות במים' },
            { code: 's2', he: 'ציפה על הגב' },
          ]),
        ],
      );
    }
  }
  const kids = programIds['kids-group'] as string;
  // Give every demo child of school age the first level, so the student screens show one.
  await client.query(
    `update students set level_id = (select id from levels where program_id = $2 and ordinal = 1)
     where organization_id = $1 and dob between '2013-01-01' and '2021-12-31'`,
    [orgId, kids],
  );

  // ─── Price lists: drafts first, then published (items are locked once a list is in effect) ──
  const priceList = async (
    name: string,
    venueId: string | null,
    from: string,
    items: [string, string, number, { dur?: number; sessions?: number }?][],
    publish: boolean,
  ) => {
    const listId = await q(
      `insert into price_lists (organization_id, name, venue_id, effective_from, status) values ($1, $2, $3, $4, 'draft') returning id`,
      [orgId, name, venueId, from],
    );
    for (const [code, kind, shekels, extra] of items) {
      await client.query(
        `insert into price_items (organization_id, price_list_id, program_id, kind, duration_min, sessions_count, amount_agorot)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          orgId,
          listId,
          programIds[code],
          kind,
          extra?.dur ?? null,
          extra?.sessions ?? null,
          shekels * 100,
        ],
      );
      summary.priceItems++;
    }
    if (publish)
      await client.query(`update price_lists set status = 'published' where id = $1`, [listId]);
  };
  await priceList(
    'מחירון תשפ״ז',
    null,
    SEASON_START,
    [
      ['kids-group', 'monthly', 320],
      ['kids-group', 'trial', 60],
      ['babies', 'monthly', 300],
      ['private', 'single', 180],
      ['private', 'single', 250, { dur: 45 }],
      ['private', 'package', 1600, { sessions: 10 }],
      // Adults have no price on purpose: the October run's review flags their seats (brief §10).
    ],
    true,
  );
  await priceList(
    'קאנטרי ירושלים תשפ״ז',
    jerusalem,
    SEASON_START,
    [['kids-group', 'monthly', 330]],
    true,
  );
  await priceList(
    'קאנטרי ירושלים מינואר',
    jerusalem,
    PRICE_RAISE,
    [['kids-group', 'monthly', 350]],
    true,
  );
  await priceList('טיוטת מחירון קיץ', null, '2027-07-01', [['kids-group', 'monthly', 360]], false);

  // ─── Policy: the documented defaults from the start of the season, plus one venue override ──
  await client.query(
    `insert into policy_sets (organization_id, scope_type, effective_from, rules, notes) values ($1, 'org', $2, $3, 'ברירות מחדל (דמו)')`,
    [orgId, SEASON_START, JSON.stringify(DEFAULT_ORG_RULES)],
  );
  await client.query(
    `insert into policy_sets (organization_id, scope_type, venue_id, effective_from, rules, notes)
     values ($1, 'venue', $2, $3, $4, 'כניסת אח נוסף בתשלום')`,
    [
      orgId,
      jerusalem,
      SEASON_START,
      JSON.stringify({ venue: { companions_per_child: 1, extra_child_fee_agorot: 2000 } }),
    ],
  );

  // ─── Staff details ────────────────────────────────────────────────────────
  const [reut, asaf, noa, dani, lia] = staffIds as [string, string, string, string, string];
  await client.query(
    `update staff_members set skills = '{babies,water_fear,advanced}' where id = $1`,
    [reut],
  );
  await client.query(`update staff_members set skills = '{adults,advanced}' where id = $1`, [asaf]);
  await client.query(`update staff_members set skills = '{babies,water_fear}' where id = $1`, [
    noa,
  ]);
  const cert = (staff: string, type: string, expires: string | null) =>
    client.query(
      `insert into certifications (organization_id, staff_member_id, type, issuer, expires_on) values ($1, $2, $3, 'מכון וינגייט (דמו)', $4)`,
      [orgId, staff, type, expires],
    );
  await cert(reut, 'swim_instructor', null);
  await cert(reut, 'lifeguard', '2027-06-30');
  await cert(asaf, 'swim_instructor', null);
  await cert(noa, 'lifeguard', '2026-11-15'); // expiring soon: shows the warning badge
  await cert(dani, 'first_aid', '2026-08-01'); // expired
  await cert(lia, 'swim_instructor', null);
  for (const [staff, weekday, venue] of [
    [noa, 1, jerusalem],
    [noa, 3, jerusalem],
    [asaf, 3, jerusalem],
    [dani, 2, gush],
    [dani, 4, gush],
  ] as const) {
    await client.query(
      `insert into availability_rules (organization_id, staff_member_id, weekday, starts_at, ends_at, venue_id, effective_from)
       values ($1, $2, $3, '15:00', '20:00', $4, $5)`,
      [orgId, staff, weekday, venue, SEASON_START],
    );
  }
  const pay = (
    staff: string,
    basis: string,
    shekels: number,
    routing: string,
    program: string | null,
  ) =>
    client.query(
      `insert into pay_rules (organization_id, staff_member_id, basis, amount_agorot, routing, program_id, effective_from)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, staff, basis, shekels * 100, routing, program, SEASON_START],
    );
  await pay(noa, 'per_hour', 85, 'payslip', null);
  await pay(asaf, 'per_hour', 90, 'payslip', kids);
  await pay(asaf, 'per_session', 120, 'transfer', programIds.private as string); // hybrid: privates by invoice
  await pay(dani, 'per_session', 110, 'transfer', null);

  // ─── Siblings (every household with two or more children) ─────────────────
  await client.query(
    `insert into student_relations (organization_id, student_id, related_student_id, type)
     select a.organization_id, a.id, b.id, 'sibling' from students a
     join students b on b.household_id = a.household_id and a.id < b.id
     where a.organization_id = $1`,
    [orgId],
  );

  // ─── GHL: a fake location id and the R-SWIM tag vocabulary ────────────────
  await client.query(
    `update org_settings set integrations = jsonb_set(integrations, '{ghl}', $2::jsonb) where organization_id = $1`,
    [orgId, JSON.stringify({ locationId: 'demo-location-0001', tagMap: RSWIM_TAG_MAP })],
  );

  return summary;
}
