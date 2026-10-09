import { DiveRules, resolveDiveRules, type ResolvedDiveRules } from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { toDomainError } from '@rswim/domain-core';

export const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

export async function one<T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T | undefined> {
  return (await rows<T>(tx, q))[0];
}

export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}

/** Today in Israel, as the database sees it. */
export async function todayIL(tx: Tx): Promise<string> {
  const r = await one<{ d: string }>(tx, sql`select app.today()::text as d`);
  return (r as { d: string }).d;
}

/** The club's rules in effect on a date, and the version they came from (null = defaults only). */
export async function loadRules(
  tx: Tx,
  onDate?: string,
): Promise<{ rules: ResolvedDiveRules; ruleSetId: string | null }> {
  const r = await one<{ id: string; rules: unknown }>(
    tx,
    sql`select id, rules from dive_rule_sets
        where effective_from <= coalesce(${onDate ?? null}::date, app.today())
        order by effective_from desc limit 1`,
  );
  if (!r) return { rules: resolveDiveRules(null), ruleSetId: null };
  const parsed = DiveRules.safeParse(r.rules);
  return { rules: resolveDiveRules(parsed.success ? parsed.data : null), ruleSetId: r.id };
}

/** The signed-in staff member (instructor) and the signed-in customer's diver record. */
export async function myStaffId(tx: Tx): Promise<string | null> {
  const r = await one<{ id: string | null }>(tx, sql`select app.current_staff_member_id() as id`);
  return r?.id ?? null;
}

export async function myDiverId(tx: Tx): Promise<string | null> {
  const r = await one<{ id: string }>(
    tx,
    sql`select id from dive_divers where id in (select app.dive_my_diver_ids()) order by created_at limit 1`,
  );
  return r?.id ?? null;
}

/** Local (Israel) date of a timestamp column, for SQL. */
export const localDate = (col: ReturnType<typeof sql>) =>
  sql`(${col} at time zone 'Asia/Jerusalem')::date`;
