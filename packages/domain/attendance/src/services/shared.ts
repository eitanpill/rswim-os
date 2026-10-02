/** Loaders shared by the attendance services. */
import { sql, type Tx } from '@rswim/db';
import { DomainError, toDomainError } from '@rswim/domain-core';
import { sessionFacts, type SessionFacts } from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { attendanceRulesFrom } from '../policies';

export async function sessionOrThrow(tx: Tx, sessionId: string): Promise<SessionFacts> {
  const [s] = await sessionFacts(tx, [sessionId]);
  if (!s) throw new DomainError('common.errors.notFound');
  return s;
}

/** The regulations in force for a session (its date, venue, program and group), with their version key. */
export async function rulesForSession(tx: Tx, s: SessionFacts) {
  const resolved = await resolvePolicyFor(tx, {
    date: s.date,
    venueId: s.venueId,
    programId: s.programId,
    classTemplateId: s.classTemplateId,
  });
  return { versionKey: resolved.versionKey, rules: attendanceRulesFrom(resolved.rules) };
}

/** Whether the caller is the office (owner, admin or the worker), as the database sees it. */
export async function isOffice(tx: Tx): Promise<boolean> {
  const r = await tx.execute<{ ok: boolean }>(sql`select app.is_owner_or_admin() as ok`);
  return (r.rows[0] as { ok: boolean }).ok;
}

export async function todayIL(tx: Tx): Promise<string> {
  const r = await tx.execute<{ d: string }>(sql`select app.today()::text as d`);
  return (r.rows[0] as { d: string }).d;
}

/** Runs a statement one of our triggers may refuse (RSW01, an i18n code) and rethrows the refusal as a DomainError. */
export async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toDomainError(e) ?? e;
  }
}
