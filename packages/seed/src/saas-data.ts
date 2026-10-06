/**
 * Phase 10 demo SaaS data (all fake): the three plans, the demo school on the top plan (and the isolation tenant on
 * the middle one), the platform admin, and the marketplace's first templates, built from the demo school's own
 * regulations, catalog and message wording.
 */
import { ACCOUNT_PERSONAS, DEMO_ORG, SECOND_ORG } from '@rswim/db/personas';
import { createDb, type Tx } from '@rswim/db';
import { currentAsTemplate } from '@rswim/domain-platform';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import type pg from 'pg';

export interface SaasDataSummary {
  plans: number;
  templates: number;
}

/** Prices in agorot, limits per plan (null = unlimited). Demo numbers, not a price offer. */
export const DEMO_PLANS = [
  {
    code: 'starter',
    he: 'בסיסי',
    en: 'Starter',
    price: 14900,
    students: 60,
    staff: 3,
    venues: 1,
    features: [],
  },
  {
    code: 'growth',
    he: 'צמיחה',
    en: 'Growth',
    price: 34900,
    students: 300,
    staff: 15,
    venues: 5,
    features: ['reports', 'courses', 'transport'],
  },
  {
    code: 'pro',
    he: 'מקצועי',
    en: 'Pro',
    price: 74900,
    students: null,
    staff: null,
    venues: null,
    features: ['reports', 'courses', 'transport', 'institutions', 'copilot'],
  },
] as const;

export const TEMPLATE_NAMES = {
  regulations: 'תקנון R-SWIM',
  catalog: 'קטלוג חוגים ומחירון לדוגמה',
  messages: 'נוסחי הודעות WhatsApp',
} as const;

export async function seedSaasData(client: pg.PoolClient): Promise<SaasDataSummary> {
  for (const [i, p] of DEMO_PLANS.entries()) {
    await client.query(
      `insert into plans (code, name_he, name_en, price_agorot, max_students, max_staff, max_venues, features, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (code) do update set name_he = excluded.name_he, name_en = excluded.name_en,
         price_agorot = excluded.price_agorot, max_students = excluded.max_students, max_staff = excluded.max_staff,
         max_venues = excluded.max_venues, features = excluded.features, sort_order = excluded.sort_order`,
      [p.code, p.he, p.en, p.price, p.students, p.staff, p.venues, p.features, i],
    );
  }
  await client.query(
    `insert into org_subscriptions (organization_id, plan_code, status, mandate_id)
     values ($1, 'pro', 'active', 'fake-mandate-demo'), ($2, 'growth', 'active', 'fake-mandate-second')`,
    [DEMO_ORG.id, SECOND_ORG.id],
  );
  await client.query(`insert into platform_admins (user_id) values ($1) on conflict do nothing`, [
    ACCOUNT_PERSONAS.platform.userId,
  ]);

  // The marketplace's own templates, from the demo school as it is set up (read as that school, under RLS).
  await client.query(
    `delete from templates where source_organization_id is null and name = any($1)`,
    [Object.values(TEMPLATE_NAMES)],
  );
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [DEMO_ORG.id],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const catalog = await currentAsTemplate(tx, 'catalog');
  const messages = (await currentAsTemplate(tx, 'messages')) as {
    messages: { locale: string }[];
  };
  await client.query('reset role');

  const insert = (kind: string, name: string, description: string, payload: unknown) =>
    client.query(
      `insert into templates (kind, status, name, description, payload) values ($1, 'published', $2, $3, $4)`,
      [kind, name, description, JSON.stringify(payload)],
    );
  await insert(
    'regulations',
    TEMPLATE_NAMES.regulations,
    'התקנון שבית הספר של רעות עובד לפיו: הודעה על היעדרות, השלמות, הקפאות, עזיבה וחיוב.',
    { rules: DEFAULT_ORG_RULES },
  );
  await insert(
    'catalog',
    TEMPLATE_NAMES.catalog,
    'קבוצות ילדים, תינוקות, פרטיים ומבוגרים, עם רמות ומחירון חודשי לדוגמה (טיוטה לבדיקה לפני פרסום).',
    catalog,
  );
  await insert(
    'messages',
    TEMPLATE_NAMES.messages,
    'כל ההודעות להורים בעברית: אישורי רישום, תזכורות, השלמות, ביטולים והסעות.',
    { messages: messages.messages.filter((m) => m.locale === 'he') },
  );
  return { plans: DEMO_PLANS.length, templates: 3 };
}
