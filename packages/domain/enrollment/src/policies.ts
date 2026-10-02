/**
 * Pure enrollment rules (brief §6.2, docs/POLICIES.md §3 and §8): how much of a trial fee offsets the first payment,
 * until when, and which forms a family still has to accept before a child takes a seat.
 */
import { PER_STUDENT_FORMS, type FormKind, type PolicyRules } from '@rswim/contracts';

export type Explanation = { code: string; params: Record<string, string | number> };

const explain = (code: string, params: Record<string, string | number> = {}): Explanation => ({
  code: `enrollment.decision.${code}`,
  params,
});

export interface EnrollmentRules {
  offsetEnabled: boolean;
  offsetAmount: 'full_trial_fee' | 'fixed';
  offsetFixedAgorot: number;
  offsetValidDays: number;
  healthRequired: boolean;
  healthValidMonths: number;
  regulationsRequired: boolean;
}

export function enrollmentRulesFrom(rules: PolicyRules): EnrollmentRules {
  return {
    offsetEnabled: rules.trial?.offset?.enabled ?? true,
    offsetAmount: rules.trial?.offset?.amount ?? 'full_trial_fee',
    offsetFixedAgorot: rules.trial?.offset?.fixed_agorot ?? 0,
    offsetValidDays: rules.trial?.offset?.valid_days ?? 14,
    healthRequired: rules.health?.declaration_required ?? true,
    healthValidMonths: rules.health?.declaration_valid_months ?? 12,
    regulationsRequired: rules.regulations?.acceptance_required ?? true,
  };
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

/** Last day the trial fee still offsets the first payment. */
export const offerValidUntil = (
  trialDate: string,
  rules: Pick<EnrollmentRules, 'offsetValidDays'>,
) => addDays(trialDate, rules.offsetValidDays);

/**
 * The trial fee's offset against the first payment (always printed on the payment link, Phase 4): the whole fee or a
 * fixed amount (never more than the fee), when the child enrolls within `trial.offset.valid_days` of the trial.
 */
export function trialOffset(
  input: { feeAgorot: number | null; trialDate: string; enrollDate: string },
  rules: Pick<
    EnrollmentRules,
    'offsetEnabled' | 'offsetAmount' | 'offsetFixedAgorot' | 'offsetValidDays'
  >,
): { offsetAgorot: number; explanation: Explanation } {
  if (!rules.offsetEnabled) return { offsetAgorot: 0, explanation: explain('offsetOff') };
  if (input.feeAgorot === null || input.feeAgorot === 0) {
    return { offsetAgorot: 0, explanation: explain('noFee') };
  }
  const until = offerValidUntil(input.trialDate, rules);
  if (input.enrollDate > until) {
    return { offsetAgorot: 0, explanation: explain('offsetExpired', { until }) };
  }
  const offsetAgorot =
    rules.offsetAmount === 'fixed'
      ? Math.min(rules.offsetFixedAgorot, input.feeAgorot)
      : input.feeAgorot;
  return { offsetAgorot, explanation: explain('offsetApplied', { amount: offsetAgorot, until }) };
}

export interface CurrentForm {
  id: string;
  kind: FormKind;
  version: number;
}

export interface Acceptance {
  formTemplateId: string;
  kind: FormKind;
  version: number;
  studentId: string | null;
  acceptedOn: string;
}

export interface FormDue {
  kind: FormKind;
  formTemplateId: string;
  studentId: string | null;
  why: Explanation;
}

/**
 * Forms a household still owes: the regulations once per household, a health declaration per child (renewed every
 * `health.declaration_valid_months`), each for the current version. Kinds the regulations do not require are skipped.
 */
export function formsDue(
  input: {
    current: readonly CurrentForm[];
    acceptances: readonly Acceptance[];
    studentIds: readonly string[];
    today: string;
  },
  rules: Pick<EnrollmentRules, 'healthRequired' | 'healthValidMonths' | 'regulationsRequired'>,
): FormDue[] {
  const required: FormKind[] = [
    ...(rules.regulationsRequired ? (['regulations'] as const) : []),
    ...(rules.healthRequired ? (['health_declaration'] as const) : []),
  ];
  const due: FormDue[] = [];
  for (const kind of required) {
    const form = input.current.find((f) => f.kind === kind);
    if (!form) continue;
    const perStudent = PER_STUDENT_FORMS.includes(kind);
    for (const studentId of perStudent ? input.studentIds : [null]) {
      const mine = input.acceptances.filter(
        (a) => a.kind === kind && (!perStudent || a.studentId === studentId),
      );
      const ofCurrent = mine
        .filter((a) => a.formTemplateId === form.id)
        .sort((a, b) => b.acceptedOn.localeCompare(a.acceptedOn))[0];
      let why: Explanation | null = null;
      if (!ofCurrent) why = explain(mine.length > 0 ? 'newVersion' : 'missing');
      else if (
        kind === 'health_declaration' &&
        addMonths(ofCurrent.acceptedOn, rules.healthValidMonths) <= input.today
      )
        why = explain('renew', { months: rules.healthValidMonths });
      if (why) due.push({ kind, formTemplateId: form.id, studentId, why });
    }
  }
  return due;
}
