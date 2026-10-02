/**
 * Digital forms and the regulations (brief §6.2): versioned texts, a family's acceptance with the hash of the exact
 * text, and which forms a household still owes.
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  FORM_CHANNELS,
  FORM_KINDS,
  PER_STUDENT_FORMS,
  requiredDate,
  requiredText,
  type FormKind,
} from '@rswim/contracts';
import { and, asc, desc, eq, isNotNull, lte, schema, sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { getHousehold } from '@rswim/domain-people';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { enrollmentRulesFrom, formsDue, type FormDue } from '../policies';

const { formSubmissions, formTemplates } = schema;

export const FormTemplateInput = z.object({
  kind: z.enum(FORM_KINDS),
  title: requiredText(120),
  body: requiredText(20_000),
  /** One yes/no question per line. */
  questions: z
    .string()
    .default('')
    .transform((s) =>
      s
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((he, i) => ({ code: `q${i + 1}`, he })),
    ),
  effectiveFrom: requiredDate(),
});
export type FormTemplateInput = z.input<typeof FormTemplateInput>;

export type FormTemplateRow = typeof formTemplates.$inferSelect;

export async function listFormTemplates(tx: Tx): Promise<FormTemplateRow[]> {
  return tx
    .select()
    .from(formTemplates)
    .orderBy(asc(formTemplates.kind), desc(formTemplates.version));
}

export async function getFormTemplate(tx: Tx, id: string) {
  const [row] = await tx.select().from(formTemplates).where(eq(formTemplates.id, id));
  return row ?? null;
}

/** A new draft version of a form kind (the next number). */
export async function createFormVersion(
  tx: Tx,
  ctx: ServiceContext,
  raw: FormTemplateInput,
): Promise<string> {
  const input = FormTemplateInput.parse(raw);
  const r = await tx.execute<{ v: number }>(
    sql`select coalesce(max(version), 0)::int + 1 as v from form_templates where kind = ${input.kind}`,
  );
  const [row] = await tx
    .insert(formTemplates)
    .values({
      ...input,
      organizationId: ctx.orgId,
      version: (r.rows[0] as { v: number }).v,
      createdBy: ctx.userId,
    })
    .returning({ id: formTemplates.id });
  return (row as { id: string }).id;
}

/** Edits a draft; a published version is frozen (guard_form_template). */
export async function updateFormDraft(tx: Tx, id: string, raw: FormTemplateInput) {
  const input = FormTemplateInput.parse(raw);
  const rows = await tx
    .update(formTemplates)
    .set({
      title: input.title,
      body: input.body,
      questions: input.questions,
      effectiveFrom: input.effectiveFrom,
    })
    .where(and(eq(formTemplates.id, id), sql`${formTemplates.publishedAt} is null`))
    .returning({ id: formTemplates.id });
  if (rows.length === 0) throw new DomainError('settings.errors.versionLocked');
}

export async function publishFormVersion(tx: Tx, ctx: ServiceContext, id: string) {
  const rows = await tx
    .update(formTemplates)
    .set({ publishedAt: sql`now()` })
    .where(and(eq(formTemplates.id, id), sql`${formTemplates.publishedAt} is null`))
    .returning({ id: formTemplates.id, kind: formTemplates.kind, version: formTemplates.version });
  const row = rows[0];
  if (!row) throw new DomainError('settings.errors.versionLocked');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'enrollment.form_published',
    payload: { formTemplateId: id, kind: row.kind, version: row.version },
    idempotencyKey: `enrollment.form_published:${id}`,
  });
}

/** The version of each kind in effect on a date: the latest published one that has started. */
export async function currentForms(tx: Tx, date: string): Promise<FormTemplateRow[]> {
  const rows = await tx
    .select()
    .from(formTemplates)
    .where(and(isNotNull(formTemplates.publishedAt), lte(formTemplates.effectiveFrom, date)))
    .orderBy(desc(formTemplates.effectiveFrom), desc(formTemplates.version));
  const byKind = new Map<string, FormTemplateRow>();
  for (const r of rows) if (!byKind.has(r.kind)) byKind.set(r.kind, r);
  return [...byKind.values()];
}

async function today(tx: Tx): Promise<string> {
  const r = await tx.execute<{ d: string }>(sql`select app.today()::text as d`);
  return (r.rows[0] as { d: string }).d;
}

/** What a household still has to accept, per the regulations in force today. */
export async function formsDueFor(
  tx: Tx,
  householdId: string,
): Promise<{ due: FormDue[]; current: FormTemplateRow[] }> {
  const date = await today(tx);
  const [household, current, resolved, submissions] = await Promise.all([
    getHousehold(tx, householdId),
    currentForms(tx, date),
    resolvePolicyFor(tx, { date }),
    tx
      .select({
        formTemplateId: formSubmissions.formTemplateId,
        studentId: formSubmissions.studentId,
        acceptedAt: formSubmissions.acceptedAt,
        kind: formTemplates.kind,
        version: formTemplates.version,
      })
      .from(formSubmissions)
      .innerJoin(formTemplates, eq(formTemplates.id, formSubmissions.formTemplateId))
      .where(eq(formSubmissions.householdId, householdId)),
  ]);
  if (!household) throw new DomainError('common.errors.notFound');
  const due = formsDue(
    {
      current: current.map((f) => ({ id: f.id, kind: f.kind as FormKind, version: f.version })),
      acceptances: submissions.map((s) => ({
        formTemplateId: s.formTemplateId,
        kind: s.kind as FormKind,
        version: s.version,
        studentId: s.studentId,
        acceptedOn: s.acceptedAt.toISOString().slice(0, 10),
      })),
      studentIds: household.students.map((s) => s.id),
      today: date,
    },
    enrollmentRulesFrom(resolved.rules),
  );
  return { due, current };
}

/** Forms a child still owes before taking a seat (the household's forms and the child's own). */
export async function formsDueForStudent(tx: Tx, householdId: string, studentId: string) {
  const { due } = await formsDueFor(tx, householdId);
  return due.filter((d) => d.studentId === null || d.studentId === studentId);
}

export const SubmissionInput = z.object({
  formTemplateId: z.uuid(),
  householdId: z.uuid(),
  studentId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()).default(null),
  guardianId: z.preprocess((v) => (v === '' ? null : v), z.uuid().nullable()).default(null),
  answers: z.record(z.string(), z.boolean()).default({}),
  channel: z.enum(FORM_CHANNELS).default('parent_portal'),
});
export type SubmissionInput = z.input<typeof SubmissionInput>;

export const textHash = (body: string) => createHash('sha256').update(body, 'utf8').digest('hex');

/**
 * Records a family's acceptance of a published form version, with the hash of the text they saw. The office records
 * phone or paper acceptances on the family's behalf; families accept in the portal.
 */
export async function submitForm(
  tx: Tx,
  ctx: ServiceContext,
  raw: SubmissionInput,
): Promise<string> {
  const input = SubmissionInput.parse(raw);
  const form = await getFormTemplate(tx, input.formTemplateId);
  if (!form?.publishedAt) throw new DomainError('enrollment.errors.formNotPublished');
  const perStudent = PER_STUDENT_FORMS.includes(form.kind as FormKind);
  const household = await getHousehold(tx, input.householdId);
  if (!household) throw new DomainError('common.errors.notFound');
  if (perStudent && !household.students.some((s) => s.id === input.studentId)) {
    throw new DomainError('enrollment.errors.studentRequired');
  }
  const questions = form.questions as { code: string }[];
  if (questions.some((q) => input.answers[q.code] === undefined)) {
    throw new DomainError('enrollment.errors.answerAll');
  }
  const [row] = await tx
    .insert(formSubmissions)
    .values({
      organizationId: ctx.orgId,
      formTemplateId: form.id,
      householdId: input.householdId,
      studentId: perStudent ? input.studentId : null,
      guardianId: input.guardianId,
      answers: input.answers,
      textHash: textHash(form.body),
      channel: input.channel,
      recordedBy: ctx.userId,
    })
    .returning({ id: formSubmissions.id });
  const id = (row as { id: string }).id;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'enrollment.form_accepted',
    payload: {
      submissionId: id,
      formTemplateId: form.id,
      kind: form.kind,
      version: form.version,
      householdId: input.householdId,
      studentId: perStudent ? input.studentId : null,
      // A "yes" to a health question is a limitation the office should look at.
      flagged: Object.values(input.answers).some(Boolean),
    },
    idempotencyKey: `enrollment.form_accepted:${id}`,
  });
  return id;
}

export async function submissionsOfHousehold(tx: Tx, householdId: string) {
  return tx
    .select({
      id: formSubmissions.id,
      formTemplateId: formSubmissions.formTemplateId,
      studentId: formSubmissions.studentId,
      acceptedAt: formSubmissions.acceptedAt,
      channel: formSubmissions.channel,
      answers: formSubmissions.answers,
      kind: formTemplates.kind,
      version: formTemplates.version,
      title: formTemplates.title,
    })
    .from(formSubmissions)
    .innerJoin(formTemplates, eq(formTemplates.id, formSubmissions.formTemplateId))
    .where(eq(formSubmissions.householdId, householdId))
    .orderBy(desc(formSubmissions.acceptedAt));
}
