/**
 * The public live demo (deploy/demo): the fake seed under a neutral school name, so it can be shown to any school.
 * A profile (@rswim/db/demo-profiles) can also dress the data for another kind of school, e.g. freediving. Only the
 * demo tenant's own rows and the marketplace sample are changed; every name is still invented.
 */
import type pg from 'pg';
import type { DemoProfile } from '@rswim/db/demo-profiles';
import { DEMO_ORG } from '@rswim/db/personas';

const SEED_OWNER = 'רעות';
const SEED_BRAND = 'R-SWIM';

export async function rebrandLiveDemo(pool: pg.Pool, profile: DemoProfile): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const org = DEMO_ORG.id;
    const school = profile.schoolName.replace(/\s*\(דמו\)\s*$/, '');
    await client.query(
      `update organizations set name = $2, legal_name = $3 || ' (עוסק מורשה, דמו)' where id = $1`,
      [org, profile.schoolName, school],
    );
    await client.query(
      `update org_settings set branding = branding || jsonb_build_object('displayName', $2::text)
       where organization_id = $1`,
      [org, profile.schoolName],
    );
    await client.query(
      `update staff_members set first_name = $2 where organization_id = $1 and first_name = $3`,
      [org, profile.ownerFirstName, SEED_OWNER],
    );
    // Draft payroll keeps a snapshot of each instructor's name.
    await client.query(
      `update payroll_runs set totals = replace(totals::text, $2, $3)::jsonb
       where organization_id = $1 and totals::text like '%' || $2 || '%'`,
      [org, SEED_OWNER, profile.ownerFirstName],
    );
    // The marketplace's sample regulations are R-SWIM's own.
    await client.query(
      `update templates set name = replace(name, $1, $2), description = replace(description, $3, $4)
       where name like '%' || $1 || '%' or description like '%' || $3 || '%'`,
      [SEED_BRAND, school, `בית הספר של ${SEED_OWNER}`, 'בית הספר'],
    );
    if (profile.key === 'freediving') await dressForFreediving(client, org);
    await client.query('commit');
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

/** [table, column, seed text, freediving text]: substring replacements inside the demo tenant, applied in order. */
const FREEDIVING_TEXT: [string, string, string, string][] = [
  ['venues', 'name', 'בריכת הדמו - גוש עציון', 'בריכת עומק – מודיעין (דמו)'],
  ['venues', 'name', 'קאנטרי הדמו - ירושלים', 'חוף אכזיב – אתר ים (דמו)'],
  ['programs', 'name_he', 'קבוצת ילדים', 'נבחרת נוער – צלילה חופשית'],
  ['programs', 'name_he', 'שחיית תינוקות', 'סדנת נשימה ורגיעה'],
  ['programs', 'name_he', 'שיעור פרטי', 'אימון אישי'],
  ['programs', 'name_he', 'מבוגרים מתחילים', 'קורס צלילה חופשית למבוגרים'],
  ['programs', 'name_he', 'קורס שחייה מרוכז', 'סדנת סוף שבוע בים'],
  ['programs', 'name_he', 'קייטנת שחייה', 'מחנה צלילה בים'],
  ['class_templates', 'name', 'אופק – כיתות ג׳', 'אופק – נבחרת נוער'],
  ['class_templates', 'name', 'פחד ממים', 'רגיעה במים'],
  ['class_templates', 'name', 'תינוקות', 'סדנת נשימה'],
  ['class_templates', 'name', 'מבוגרים גוש', 'מבוגרים מודיעין'],
  ['class_templates', 'name', 'גוש', 'מודיעין'],
  ['class_templates', 'name', 'מעורבת', 'נוער מעורבת'],
  ['class_templates', 'name', 'בנות', 'נוער בנות'],
  ['class_templates', 'name', 'בנים', 'נוער בנים'],
  ['class_templates', 'name', 'צפרדע', 'שלב 1'],
  ['class_templates', 'name', 'דג זהב', 'שלב 2'],
  ['class_templates', 'name', 'דולפין', 'שלב 3'],
  ['class_templates', 'name', 'כריש', 'שלב 4'],
  ['class_templates', 'name', 'קייטנה', 'מחנה צלילה'],
  ['class_templates', 'name', 'קורס חנוכה', 'סדנת חנוכה בים'],
  ['cohorts', 'name', 'קורס חנוכה מרוכז', 'סדנת חנוכה בים – סוף שבוע'],
  ['cohorts', 'name', 'קייטנת קיץ', 'מחנה צלילה קיץ'],
  ['terms', 'name', 'קורס חנוכה', 'סדנת חנוכה בים'],
  ['price_lists', 'name', 'קאנטרי ירושלים', 'חוף אכזיב'],
  ['price_lists', 'name', 'קורסים וקייטנות', 'סדנאות ומחנות'],
  ['form_templates', 'title', 'בית הספר לשחייה', 'בית הספר לצלילה חופשית'],
  ['form_templates', 'title', 'הצהרת בריאות', 'הצהרת בריאות ואישור רפואי לצלילה'],
];

/** Levels by program code and level code: a freediving ladder in place of the swimming one. */
const FREEDIVING_LEVELS: Record<string, Record<string, string>> = {
  'kids-group': {
    l1: 'שלב 1 – נשימה ורגיעה',
    l2: 'שלב 2 – צלילה סטטית',
    l3: 'שלב 3 – צלילה דינמית',
    l4: 'שלב 4 – ירידה בים',
  },
  adults: { l1: 'Freediver – מתחילים', l2: 'Advanced Freediver' },
  babies: { l1: 'בסיס', l2: 'מתקדמים' },
};

const FREEDIVING_SKILLS: Record<string, string> = {
  s1: 'נשימת הכנה ורגיעה',
  s2: 'השוואת לחצים (פרנזל)',
};

/** Free text in the seed (messages, candidates, notes) that speaks of swimming, after the names above. */
const FREEDIVING_FREE_TEXT: [string, string][] = [
  ['חוג שחייה לבן 6', 'קורס צלילה חופשית לבן 16'],
  ['מדריכת שחייה', 'מדריכת צלילה חופשית'],
  ['מדריך שחייה', 'מדריך צלילה חופשית'],
  ['גוש עציון', 'מודיעין'],
  ['השחייה', 'הצלילה'],
  ['שחייה', 'צלילה'],
];

const NAMED: [string, string][] = [
  ['venues', 'name'],
  ['programs', 'name_he'],
  ['class_templates', 'name'],
  ['cohorts', 'name'],
  ['terms', 'name'],
  ['price_lists', 'name'],
];

async function namesById(client: pg.PoolClient, org: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const [table, column] of NAMED) {
    const { rows } = await client.query<{ id: string; v: string }>(
      `select id, ${column} v from ${table} where organization_id = $1`,
      [org],
    );
    for (const r of rows) names.set(`${table}:${r.id}`, r.v);
  }
  return names;
}

async function dressForFreediving(client: pg.PoolClient, org: string): Promise<void> {
  // Renames only, on a throwaway demo database: the guards that keep published price lists, the ledger and signed
  // forms immutable would refuse them, so triggers are off until the transaction ends.
  await client.query(`set local session_replication_role = replica`);
  const before = await namesById(client, org);
  for (const [table, column, from, to] of FREEDIVING_TEXT) {
    await client.query(
      `update ${table} set ${column} = replace(${column}, $2, $3)
       where organization_id = $1 and ${column} like '%' || $2 || '%'`,
      [org, from, to],
    );
  }
  // Charges, receipts, payroll lines and messages carry copies of those names: rename every copy, longest first.
  const after = await namesById(client, org);
  const copies: [string, string][] = [];
  for (const [key, old] of before) {
    const now = after.get(key);
    if (now && now !== old) copies.push([old, now]);
  }
  copies.sort((a, b) => b[0].length - a[0].length);
  await replaceEverywhere(client, org, [...copies, ...FREEDIVING_FREE_TEXT]);

  await client.query(
    `update venues set city = case when name like '%אכזיב%' then 'אכזיב' else 'מודיעין' end,
       kind = case when name like '%אכזיב%' then 'other' else 'municipal' end
     where organization_id = $1`,
    [org],
  );
  await client.query(
    `update pools p set
       name = case when v.name like '%אכזיב%' then 'אתר צלילה – מצוף 20 מ׳' else 'בריכת עומק 5 מ׳' end,
       indoor = v.name not like '%אכזיב%',
       depth_max_cm = case when v.name like '%אכזיב%' then 2000 else 500 end
     from venues v where v.id = p.venue_id and p.organization_id = $1`,
    [org],
  );
  for (const [program, levels] of Object.entries(FREEDIVING_LEVELS)) {
    for (const [code, name] of Object.entries(levels)) {
      await client.query(
        `update levels l set name_he = $4 from programs p
         where p.id = l.program_id and l.organization_id = $1 and p.code = $2 and l.code = $3`,
        [org, program, code, name],
      );
    }
  }
  await client.query(
    `update levels set skills = (
       select coalesce(jsonb_agg(case when $2::jsonb ? (s->>'code')
         then jsonb_set(s, '{he}', $2::jsonb -> (s->>'code')) else s end), '[]'::jsonb)
       from jsonb_array_elements(skills) s)
     where organization_id = $1`,
    [org, JSON.stringify(FREEDIVING_SKILLS)],
  );
  // Freedivers are teenagers and adults: the seed's young children become 10 years older, and no program has a
  // parent in the water.
  await client.query(
    `update students set dob = dob - interval '10 years'
     where organization_id = $1 and dob > (current_date - interval '12 years')`,
    [org],
  );
  await client.query(
    `update programs set parent_in_water = false, min_age_months = case when min_age_months is null then null
       else greatest(min_age_months, 120) end, max_age_months = null
     where organization_id = $1`,
    [org],
  );
  // The marketplace's sample catalog (shared by every school on the demo platform).
  await client.query(
    `update templates set description = replace(description, 'קבוצות ילדים, תינוקות, פרטיים ומבוגרים', 'קבוצות נוער, סדנאות, אימונים אישיים ומבוגרים')
     where description like '%קבוצות ילדים, תינוקות%'`,
  );
  // Freediving has no baby swimming: that program and its instructors become adults'.
  await client.query(
    `update programs set kind = 'adult_style' where organization_id = $1 and kind = 'baby'`,
    [org],
  );
  for (const [table, column] of [
    ['staff_members', 'skills'],
    ['class_templates', 'required_skills'],
  ] as const) {
    await client.query(
      `update ${table} set ${column} = array(select distinct unnest(array_replace(${column}, 'babies', 'adults')))
       where organization_id = $1 and 'babies' = any(${column})`,
      [org],
    );
  }
}

/**
 * Replaces each pair, in order, in every text, jsonb and text[] column of the tenant's tables. One statement per
 * column, touching only rows that contain one of the strings.
 */
async function replaceEverywhere(
  client: pg.PoolClient,
  org: string,
  pairs: [string, string][],
): Promise<void> {
  if (pairs.length === 0) return;
  const { rows: columns } = await client.query<{ t: string; c: string; type: string }>(
    `select c.table_name t, c.column_name c, c.data_type type
     from information_schema.columns c
     join information_schema.columns o
       on o.table_schema = c.table_schema and o.table_name = c.table_name and o.column_name = 'organization_id'
     join information_schema.tables tb
       on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and (c.data_type in ('text', 'character varying', 'jsonb') or (c.data_type = 'ARRAY' and c.udt_name = '_text'))`,
  );
  const params: string[] = [org];
  let chain = 'VALUE';
  for (const [from, to] of pairs) {
    params.push(from, to);
    chain = `replace(${chain}, $${params.length - 1}, $${params.length})`;
  }
  const any = pairs.map((_, i) => `'%' || $${2 + i * 2} || '%'`).join(', ');
  for (const { t, c, type } of columns) {
    const col = `"${c}"`;
    const value =
      type === 'jsonb'
        ? `(${chain.replace('VALUE', `${col}::text`)})::jsonb`
        : type === 'ARRAY'
          ? `array(select ${chain.replace('VALUE', 'x')} from unnest(${col}) x)`
          : chain.replace('VALUE', col);
    await client.query(
      `update "${t}" set ${col} = ${value}
       where organization_id = $1 and ${col}::text like any (array[${any}]::text[])`,
      params,
    );
  }
}
