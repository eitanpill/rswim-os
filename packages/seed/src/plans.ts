/**
 * The plans a school can buy (docs/saas/DECISIONS.md, approved by Pit 2026-11-06). Prices are monthly, in agorot,
 * before VAT; limits are per school (null = unlimited). The demo seed and the production seed both write these rows,
 * so the demo always shows the real offer.
 */
export const PLAN_CATALOG = [
  {
    code: 'starter',
    he: 'בסיסי',
    en: 'Starter',
    price: 19900,
    students: 80,
    staff: 3,
    venues: 1,
    features: [],
  },
  {
    code: 'growth',
    he: 'צמיחה',
    en: 'Growth',
    price: 39900,
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

/** Inserts or updates the plan rows. Safe to run again: existing subscriptions keep their plan code. */
export async function upsertPlans(client: {
  query: (sql: string, params: unknown[]) => Promise<unknown>;
}): Promise<number> {
  for (const [i, p] of PLAN_CATALOG.entries()) {
    await client.query(
      `insert into plans (code, name_he, name_en, price_agorot, max_students, max_staff, max_venues, features, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (code) do update set name_he = excluded.name_he, name_en = excluded.name_en,
         price_agorot = excluded.price_agorot, max_students = excluded.max_students, max_staff = excluded.max_staff,
         max_venues = excluded.max_venues, features = excluded.features, sort_order = excluded.sort_order`,
      [p.code, p.he, p.en, p.price, p.students, p.staff, p.venues, p.features, i],
    );
  }
  return PLAN_CATALOG.length;
}
