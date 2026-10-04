/**
 * Recruitment, ATS-lite (brief §6.9): applicants with their source, stage, certifications, rate expectation,
 * availability, a trial day and a short scorecard. The talent pool is a stage: people to call when substitutes run out.
 */
import { z } from 'zod';
import {
  ApplicantSource,
  ApplicantStage,
  optionalDate,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredText,
} from '@rswim/contracts';
import { asc, eq, schema, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { parseShekels } from '@rswim/money';

const { applicants } = schema;

const score = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : Number(v)),
  z.number().int().min(1).max(5).optional(),
);

export const ApplicantInput = z.object({
  firstName: requiredText(80),
  lastName: optionalText(80),
  phone: optionalPhone(),
  email: optionalEmail(),
  gender: z.preprocess((v) => (v === '' ? null : v), z.enum(['female', 'male']).nullable()),
  source: ApplicantSource,
  certifications: optionalText(300),
  // Shekels as typed, or agorot already parsed (the web form validates before the service re-parses).
  rateExpectation: z.union([
    z.number().int().nonnegative().nullable(),
    z
      .string()
      .trim()
      .optional()
      .transform((v, c) => {
        if (!v) return null;
        const a = parseShekels(v);
        if (a === null) {
          c.addIssue({ code: 'custom', message: 'forms.errors.amount' });
          return z.NEVER;
        }
        return a;
      }),
  ]),
  availability: optionalText(300),
  notes: optionalText(1000),
});
export type ApplicantInput = z.input<typeof ApplicantInput>;

export async function createApplicant(tx: Tx, ctx: ServiceContext, raw: ApplicantInput) {
  const input = ApplicantInput.parse(raw);
  const [row] = await tx
    .insert(applicants)
    .values({
      organizationId: ctx.orgId,
      firstName: input.firstName,
      lastName: input.lastName,
      phoneE164: input.phone,
      email: input.email,
      gender: input.gender,
      source: input.source,
      certifications: input.certifications,
      rateExpectationAgorot: input.rateExpectation,
      availability: input.availability,
      notes: input.notes,
      createdBy: ctx.userId,
    })
    .returning({ id: applicants.id });
  return (row as { id: string }).id;
}

export const ApplicantStageInput = z.object({
  id: z.uuid(),
  stage: ApplicantStage,
  trialDayOn: optionalDate(),
  water: score,
  kids: score,
  reliability: score,
  notes: optionalText(1000),
});
export type ApplicantStageInput = z.input<typeof ApplicantStageInput>;

/** Moves an applicant along the pipeline, with the trial day and scorecard as they fill in. */
export async function updateApplicantStage(tx: Tx, raw: ApplicantStageInput) {
  const input = ApplicantStageInput.parse(raw);
  const [current] = await tx.select().from(applicants).where(eq(applicants.id, input.id));
  if (!current) throw new DomainError('common.errors.notFound');
  const scorecard = {
    ...(current.scorecard as Record<string, number>),
    ...(input.water ? { water: input.water } : {}),
    ...(input.kids ? { kids: input.kids } : {}),
    ...(input.reliability ? { reliability: input.reliability } : {}),
  };
  await tx
    .update(applicants)
    .set({
      stage: input.stage,
      trialDayOn: input.trialDayOn ?? current.trialDayOn,
      scorecard,
      notes: input.notes ?? current.notes,
    })
    .where(eq(applicants.id, input.id));
}

export async function listApplicants(tx: Tx) {
  return tx.select().from(applicants).orderBy(asc(applicants.stage), asc(applicants.createdAt));
}
