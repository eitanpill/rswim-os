/** Loaders shared by the scheduling services: the facts the pure rules need, read inside the caller's transaction. */
import { z } from 'zod';
import type { StaffGender } from '@rswim/contracts';
import { asc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError } from '@rswim/domain-core';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { getStaff } from '@rswim/domain-staff';
import { windowsOfPool } from '@rswim/domain-venues';
import {
  schedulingRulesFrom,
  staffingRulesFrom,
  type InstructorFacts,
  type OtherTemplate,
  type RuleIssue,
  type WindowRow,
} from '../policies';

const { classTemplates, classTemplateLanes } = schema;

/** An optional <select> of ids: "" means none. */
export const optionalUuid = () =>
  z.preprocess((v) => (v === '' ? undefined : v), z.uuid().optional()).transform((v) => v ?? null);

/** Throws the first hard-rule violation as a DomainError, so a form shows it in Hebrew. */
export function refuse(violations: readonly RuleIssue[]): void {
  const first = violations[0];
  if (first) throw new DomainError(first.code, first.params);
}

/** The pool's windows from the venues module, in the shape the rules take. */
export async function poolWindows(tx: Tx, poolId: string): Promise<WindowRow[]> {
  const rows = await windowsOfPool(tx, poolId);
  return rows.map((w) => ({ ...w, id: w.id as string }));
}

/** Every active group of the org, in the shape the pure rules compare against. */
export async function activeTemplates(tx: Tx): Promise<(OtherTemplate & { programId: string })[]> {
  const rows = await tx
    .select()
    .from(classTemplates)
    .where(eq(classTemplates.status, 'active'))
    .orderBy(asc(classTemplates.weekday), asc(classTemplates.startsAt));
  const links = rows.length
    ? await tx
        .select()
        .from(classTemplateLanes)
        .where(
          inArray(
            classTemplateLanes.classTemplateId,
            rows.map((r) => r.id),
          ),
        )
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    programId: r.programId,
    venueId: r.venueId,
    poolId: r.poolId,
    weekday: r.weekday,
    startsAt: r.startsAt,
    durationMin: r.durationMin,
    laneIds: links.filter((l) => l.classTemplateId === r.id).map((l) => l.laneId),
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    leadStaffId: r.leadStaffId,
  }));
}

/** An instructor's profile and availability from the staff module, in the shape the rules take. */
export async function instructorFacts(tx: Tx, staffId: string): Promise<InstructorFacts> {
  const detail = await getStaff(tx, staffId);
  if (!detail) throw new DomainError('common.errors.notFound');
  const s = detail.staff;
  return {
    id: s.id,
    name: `${s.firstName} ${s.lastName}`,
    gender: (s.gender as StaffGender | null) ?? null,
    status: s.status,
    skills: s.skills,
    availability: detail.availability,
    exceptions: detail.exceptions.map((e) => ({
      ...e,
      kind: e.kind as 'unavailable' | 'available',
    })),
  };
}

export interface ScopeOn {
  date: string;
  venueId: string;
  programId: string;
  classTemplateId?: string | null;
}

export async function rulesFor(tx: Tx, scope: ScopeOn) {
  const resolved = await resolvePolicyFor(tx, scope);
  return {
    resolved,
    scheduling: schedulingRulesFrom(resolved.rules),
    staffing: staffingRulesFrom(resolved.rules),
  };
}

/** `date + local time` in Asia/Jerusalem as a timestamptz SQL expression. */
export const localInstant = (date: string, time: string) =>
  sql`((${date}::date + ${time}::time) at time zone 'Asia/Jerusalem')`;

/** Today in Israel, from the database clock so tests and the server agree. */
export async function todayIL(tx: Tx): Promise<string> {
  const r = await tx.execute<{ d: string }>(sql`select app.today()::text as d`);
  return (r.rows[0] as { d: string }).d;
}

export const byIds = <T extends { id: string }>(rows: readonly T[]) =>
  new Map(rows.map((r) => [r.id, r] as const));
