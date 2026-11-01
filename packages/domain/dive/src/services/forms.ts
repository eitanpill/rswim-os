/**
 * The club's forms: the health declaration, the liability waiver and the diver's insurance. The club writes the texts
 * (versioned; a published version is frozen), a diver signs them on their phone or on the desk's tablet, the office
 * clears a health declaration that answered "yes" to a flagged question, and everyone sees until when each counts.
 * The database stamps what must not come from the signer (text hash, time, review, validity) and keeps the diver's
 * file in step (waiver date, medical and insurance expiry).
 */
import { z } from 'zod';
import {
  DIVE_FORM_KINDS,
  DiveFormQuestions,
  SignatureStrokes,
  type DiveFormKind,
  type DiveFormQuestion,
  type DiveFormReview,
} from '@rswim/contracts';
import { sql, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { formState, formsToSign, type PaperworkState } from '../policies';
import { guarded, loadRules, myDiverId, one, rows, todayIL } from './shared';

const id = z.uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'forms.errors.date');

// ─── Templates ──────────────────────────────────────────────────────────────

export interface FormTemplate {
  id: string;
  kind: DiveFormKind;
  version: number;
  title: string;
  body: string;
  questions: DiveFormQuestion[];
  publishedAt: string | null;
  signatures: number;
}

const parseQuestions = (v: unknown): DiveFormQuestion[] => {
  const r = DiveFormQuestions.safeParse(v);
  return r.success ? r.data : [];
};

/** Every version of every form, newest first (staff). */
export async function listFormTemplates(tx: Tx): Promise<FormTemplate[]> {
  const list = await rows<Omit<FormTemplate, 'questions'> & { questions: unknown }>(
    tx,
    sql`select t.id, t.kind, t.version, t.title, t.body, t.questions, t.published_at as "publishedAt",
               (select count(*)::int from dive_form_signatures s where s.template_id = t.id) as signatures
        from dive_form_templates t order by t.kind, t.version desc`,
  );
  return list.map((t) => ({ ...t, questions: parseQuestions(t.questions) }));
}

/** The version of a form divers sign today: the latest published one. */
export async function currentForm(tx: Tx, kind: DiveFormKind): Promise<FormTemplate | null> {
  const t = await one<Omit<FormTemplate, 'questions' | 'signatures'> & { questions: unknown }>(
    tx,
    sql`select id, kind, version, title, body, questions, published_at as "publishedAt"
        from dive_form_templates where kind = ${kind} and published_at is not null
        order by version desc limit 1`,
  );
  return t ? { ...t, questions: parseQuestions(t.questions), signatures: 0 } : null;
}

/** One question per line; a line starting with `!` is flagged (a "yes" needs the club's medical clearance). */
export function questionsFromText(text: string): DiveFormQuestion[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const flag = l.startsWith('!');
      return { code: `q${i + 1}`, he: (flag ? l.slice(1) : l).trim(), flag };
    });
}

export const FormDraftInput = z.object({
  kind: z.enum(DIVE_FORM_KINDS),
  title: z.string().trim().min(2, 'forms.errors.required').max(120),
  body: z.string().trim().min(20, 'dive.errors.formBodyShort').max(20_000),
  questions: z
    .string()
    .default('')
    .transform((s) => questionsFromText(s))
    .pipe(DiveFormQuestions),
});

/**
 * Saves the next text of a form as a draft: edits the open draft of that kind, or opens a new version. Only the owner
 * and the manager may (RLS); a published version never changes.
 */
export async function saveFormDraft(
  tx: Tx,
  ctx: ServiceContext,
  input: z.output<typeof FormDraftInput>,
): Promise<string> {
  const draft = await one<{ id: string }>(
    tx,
    sql`select id from dive_form_templates where kind = ${input.kind} and published_at is null
        order by version desc limit 1`,
  );
  const questions = JSON.stringify(input.questions);
  if (draft) {
    const done = await guarded(() =>
      rows(
        tx,
        sql`update dive_form_templates set title = ${input.title}, body = ${input.body},
                   questions = ${questions}::jsonb
            where id = ${draft.id} returning id`,
      ),
    );
    if (done.length === 0) throw new DomainError('common.errors.forbidden');
    return draft.id;
  }
  const created = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`insert into dive_form_templates (organization_id, kind, version, title, body, questions, created_by)
          values (${ctx.orgId}, ${input.kind},
                  (select coalesce(max(version), 0) + 1 from dive_form_templates where kind = ${input.kind}),
                  ${input.title}, ${input.body}, ${questions}::jsonb, ${ctx.userId})
          returning id`,
    ),
  );
  return (created as { id: string }).id;
}

export const TemplateRef = z.object({ templateId: id });

/** Publishes a draft: from now on divers sign this text. Earlier signatures keep pointing at the text they signed. */
export async function publishForm(tx: Tx, ctx: ServiceContext, raw: z.input<typeof TemplateRef>) {
  const { templateId } = TemplateRef.parse(raw);
  const done = await guarded(() =>
    rows<{ kind: string; version: number }>(
      tx,
      sql`update dive_form_templates set published_at = now()
          where id = ${templateId} and published_at is null returning kind, version`,
    ),
  );
  const row = done[0];
  if (!row) throw new DomainError('dive.errors.formLocked');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.form_published',
    payload: { templateId, kind: row.kind, version: row.version },
    idempotencyKey: `dive.form_published:${templateId}`,
  });
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * A signed form from the browser. Answers arrive as `q_<code>` = yes/no fields; the signature as the pad's strokes
 * (JSON). The database checks every answer against the version signed.
 */
export const SignFormInput = z
  .object({
    templateId: id,
    diverId: id.optional(),
    signerName: z
      .string({ error: 'dive.errors.signerName' })
      .trim()
      .min(2, 'dive.errors.signerName')
      .max(120),
    signature: z
      .string({ error: 'dive.errors.signatureMissing' })
      .min(2, 'dive.errors.signatureMissing')
      .max(120_000, 'dive.errors.signatureMissing')
      .transform((s, c) => {
        try {
          return JSON.parse(s) as unknown;
        } catch {
          c.addIssue({ code: 'custom', message: 'dive.errors.signatureMissing' });
          return z.NEVER;
        }
      })
      .pipe(SignatureStrokes),
    agree: z.literal('on', { error: 'dive.errors.mustAgree' }),
    answers: z.record(z.string(), z.enum(['yes', 'no'])).default({}),
    insurer: z.string().trim().max(120).optional(),
    policyNumber: z.string().trim().max(80).optional(),
    insuranceValidUntil: isoDate.optional(),
    fileId: id.optional(),
  })
  .strict();
export type SignFormInput = z.input<typeof SignFormInput>;
export type SignFormData = z.output<typeof SignFormInput>;

/**
 * Collects `q_<code>` fields of a submitted form into `answers` and drops empty fields and the page's own fields
 * (server actions call this on the raw form).
 */
export function collectAnswers(
  raw: Record<string, unknown>,
  drop: readonly string[] = [],
): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('q_')) answers[k.slice(2)] = v;
    else if (v !== '' && !drop.includes(k)) out[k] = v;
  }
  return { ...out, answers };
}

export interface SignedForm {
  id: string;
  kind: DiveFormKind;
  review: DiveFormReview;
  validUntil: string | null;
}

/**
 * Signs one form. A customer signs for themself (online); the office signs on the desk's tablet for the diver it
 * names (the diver signs with their own hand there). Emits `dive.form_signed`; a flagged health declaration also
 * tells the office it waits for clearance.
 */
export async function signForm(
  tx: Tx,
  ctx: ServiceContext,
  input: SignFormData,
): Promise<SignedForm> {
  const diverId = input.diverId ?? (await myDiverId(tx));
  if (!diverId) throw new DomainError('dive.errors.noDiver');
  const row = await guarded(() =>
    one<SignedForm>(
      tx,
      sql`insert into dive_form_signatures (organization_id, diver_id, template_id, kind, answers, text_hash,
                                            signer_name, signature, channel, insurer, policy_number, valid_until,
                                            file_id)
          values (${ctx.orgId}, ${diverId}, ${input.templateId}, 'waiver', ${JSON.stringify(input.answers)}::jsonb,
                  '', ${input.signerName}, ${JSON.stringify(input.signature)}::jsonb,
                  ${input.diverId ? 'desk' : 'online'}, ${input.insurer ?? null}, ${input.policyNumber ?? null},
                  ${input.insuranceValidUntil ?? null}::date, ${input.fileId ?? null})
          returning id, kind, review, valid_until::text as "validUntil"`,
    ),
  );
  const signed = row as SignedForm;
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.form_signed',
    payload: { signatureId: signed.id, diverId, kind: signed.kind, review: signed.review },
    idempotencyKey: `dive.form_signed:${signed.id}`,
  });
  return signed;
}

export const ReviewInput = z.object({
  signatureId: id,
  decision: z.enum(['cleared', 'refused']),
  note: z.string().trim().max(500).optional(),
  fileId: id.optional(),
});

/** The office clears (with a doctor's note) or refuses a health declaration that waits for it. */
export async function reviewHealth(tx: Tx, ctx: ServiceContext, raw: z.input<typeof ReviewInput>) {
  const input = ReviewInput.parse(raw);
  const done = await guarded(() =>
    rows<{ diverId: string }>(
      tx,
      sql`update dive_form_signatures set review = ${input.decision}, review_note = ${input.note ?? null},
                 file_id = coalesce(${input.fileId ?? null}::uuid, file_id)
          where id = ${input.signatureId} returning diver_id as "diverId"`,
    ),
  );
  const row = done[0];
  if (!row) throw new DomainError('dive.errors.reviewNotPending');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'dive.form_reviewed',
    payload: { signatureId: input.signatureId, diverId: row.diverId, decision: input.decision },
    idempotencyKey: `dive.form_reviewed:${input.signatureId}`,
  });
}

// ─── Reading ────────────────────────────────────────────────────────────────

export interface PaperworkItem {
  kind: DiveFormKind;
  state: PaperworkState;
  until: string | null;
  days: number | null;
  signatureId: string | null;
  signedAt: string | null;
  channel: string | null;
  insurer: string | null;
  policyNumber: string | null;
  reviewNote: string | null;
  /** Whether the club has a published text to sign. */
  available: boolean;
}

export interface Paperwork {
  today: string;
  items: PaperworkItem[];
  /** The kinds the diver should sign now, in order. */
  toSign: DiveFormKind[];
  history: {
    id: string;
    kind: DiveFormKind;
    version: number;
    signedAt: string;
    validUntil: string | null;
    review: DiveFormReview;
    channel: string;
  }[];
}

/** Where each of a diver's forms stands, and every signature they gave. RLS limits a customer to their own. */
export async function diverPaperwork(tx: Tx, diverId: string): Promise<Paperwork> {
  const [{ rules }, today] = await Promise.all([loadRules(tx), todayIL(tx)]);
  const history = await rows<
    Paperwork['history'][number] & {
      insurer: string | null;
      policyNumber: string | null;
      reviewNote: string | null;
    }
  >(
    tx,
    sql`select s.id, s.kind, t.version, s.signed_at as "signedAt", s.valid_until::text as "validUntil", s.review,
               s.channel, s.insurer, s.policy_number as "policyNumber", s.review_note as "reviewNote"
        from dive_form_signatures s join dive_form_templates t on t.id = s.template_id
        where s.diver_id = ${diverId} order by s.signed_at desc`,
  );
  const published = await rows<{ kind: DiveFormKind }>(
    tx,
    sql`select distinct kind from dive_form_templates where published_at is not null`,
  );
  const kinds = DIVE_FORM_KINDS.filter(
    (k) => k !== 'insurance' || rules.paperwork.insurance !== 'off',
  );
  const items = kinds.map((kind): PaperworkItem => {
    const latest = history.find((h) => h.kind === kind) ?? null;
    const st = formState(kind, latest, today, rules.paperwork);
    return {
      kind,
      ...st,
      signatureId: latest?.id ?? null,
      signedAt: latest?.signedAt ?? null,
      channel: latest?.channel ?? null,
      insurer: latest?.insurer ?? null,
      policyNumber: latest?.policyNumber ?? null,
      reviewNote: latest?.reviewNote ?? null,
      available: published.some((p) => p.kind === kind),
    };
  });
  const states = Object.fromEntries(items.map((i) => [i.kind, i.state])) as Record<
    DiveFormKind,
    PaperworkState
  >;
  states.insurance ??= 'ok';
  return {
    today,
    items,
    toSign: formsToSign(states, rules.paperwork).filter((k) =>
      items.some((i) => i.kind === k && i.available),
    ),
    history: history.map(({ insurer: _i, policyNumber: _p, reviewNote: _r, ...h }) => h),
  };
}

export interface SignatureView {
  id: string;
  diverId: string;
  diverName: string;
  kind: DiveFormKind;
  version: number;
  title: string;
  body: string;
  questions: DiveFormQuestion[];
  answers: Record<string, string>;
  textHash: string;
  signerName: string;
  signature: number[][][];
  signedAt: string;
  validUntil: string | null;
  channel: string;
  recordedByName: string | null;
  insurer: string | null;
  policyNumber: string | null;
  fileId: string | null;
  review: DiveFormReview;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
}

/** One signed form exactly as it was signed, for the screen and for printing. */
export async function signatureView(tx: Tx, signatureId: string): Promise<SignatureView | null> {
  const r = await one<Omit<SignatureView, 'questions'> & { questions: unknown }>(
    tx,
    sql`select s.id, s.diver_id as "diverId", d.first_name || ' ' || d.last_name as "diverName", s.kind, t.version,
               t.title, t.body, t.questions, s.answers, s.text_hash as "textHash", s.signer_name as "signerName",
               s.signature, s.signed_at as "signedAt", s.valid_until::text as "validUntil", s.channel,
               case when s.channel = 'desk' then (select sm.first_name || ' ' || sm.last_name from memberships m
                  join staff_members sm on sm.id = m.staff_member_id
                  where m.user_id = s.recorded_by and m.organization_id = s.organization_id limit 1) end as "recordedByName",
               s.insurer, s.policy_number as "policyNumber", s.file_id as "fileId", s.review,
               s.review_note as "reviewNote", s.reviewed_at as "reviewedAt",
               (select sm.first_name || ' ' || sm.last_name from memberships m
                  join staff_members sm on sm.id = m.staff_member_id
                  where m.user_id = s.reviewed_by and m.organization_id = s.organization_id limit 1) as "reviewedByName"
        from dive_form_signatures s join dive_form_templates t on t.id = s.template_id
        join dive_divers d on d.id = s.diver_id
        where s.id = ${signatureId}`,
  );
  return r ? { ...r, questions: parseQuestions(r.questions) } : null;
}

export interface PaperworkQueue {
  /** Health declarations waiting for the club's clearance. */
  pending: {
    signatureId: string;
    diverId: string;
    name: string;
    signedAt: string;
    flagged: string[];
    nextOn: string | null;
  }[];
  /** Active divers (dived in 90 days or booked) whose insurance runs out within the warning days, or has. */
  insurance: { diverId: string; name: string; until: string | null; nextOn: string | null }[];
  /** Divers booked in the coming week with a form missing or out of date by their dive. */
  unsignedBooked: {
    diverId: string;
    name: string;
    nextOn: string;
    waiver: boolean;
    medical: boolean;
  }[];
}

/** The office's paperwork to chase: medical clearances, insurance running out, and booked divers missing a form. */
export async function paperworkQueue(tx: Tx): Promise<PaperworkQueue> {
  const { rules } = await loadRules(tx);
  const p = rules.paperwork;
  const next = sql`(select min((x.starts_at at time zone 'Asia/Jerusalem')::date)::text from dive_bookings b
                    join dive_sessions x on x.id = b.session_id
                    where b.diver_id = d.id and b.status in ('booked', 'pending_payment') and x.starts_at > now())`;
  const pendingRows = await rows<
    Omit<PaperworkQueue['pending'][number], 'flagged'> & { questions: unknown; answers: unknown }
  >(
    tx,
    sql`select s.id as "signatureId", d.id as "diverId", d.first_name || ' ' || d.last_name as name,
               s.signed_at as "signedAt", t.questions, s.answers, ${next} as "nextOn"
        from dive_form_signatures s join dive_divers d on d.id = s.diver_id
        join dive_form_templates t on t.id = s.template_id
        where s.review = 'pending' order by s.signed_at`,
  );
  const pending = pendingRows.map(({ questions, answers, ...r }) => ({
    ...r,
    flagged: parseQuestions(questions)
      .filter((q) => q.flag && (answers as Record<string, string>)[q.code] === 'yes')
      .map((q) => q.he),
  }));
  const insurance =
    p.insurance === 'off'
      ? []
      : await rows<PaperworkQueue['insurance'][number]>(
          tx,
          sql`select d.id as "diverId", d.first_name || ' ' || d.last_name as name,
                     d.insurance_expires_on::text as until, ${next} as "nextOn"
              from dive_divers d
              where d.insurance_expires_on is not null
                and d.insurance_expires_on <= app.today() + ${p.insurance_warn_days}::int
                and (exists (select 1 from dive_logs l where l.diver_id = d.id and l.dived_on > app.today() - 90)
                     or ${next} is not null)
              order by d.insurance_expires_on`,
        );
  const unsignedBooked = await rows<PaperworkQueue['unsignedBooked'][number]>(
    tx,
    sql`select * from (
          select d.id as "diverId", d.first_name || ' ' || d.last_name as name, ${next} as "nextOn",
                 (d.waiver_signed_on is null
                   or d.waiver_signed_on + make_interval(months => ${p.waiver_valid_months}::int) < app.today() + 7) as waiver,
                 (d.medical_expires_on is null or d.medical_expires_on < app.today() + 7) as medical
          from dive_divers d) q
        where q."nextOn" is not null and q."nextOn"::date <= app.today() + 7 and (q.waiver or q.medical)
        order by q."nextOn", q.name`,
  );
  return { pending, insurance, unsignedBooked };
}

/** Records an uploaded document's row (the bytes are already in the file store under `path`). */
export const FileRecord = z.object({
  path: z.string().min(3).max(300),
  mime: z.string().min(3).max(80),
  sizeBytes: z.int().min(1),
  purpose: z.enum(['dive_insurance', 'dive_medical', 'dive_cert']),
});

export async function recordFile(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof FileRecord>,
): Promise<string> {
  const input = FileRecord.parse(raw);
  const r = await guarded(() =>
    one<{ id: string }>(
      tx,
      sql`insert into files (organization_id, bucket, path, mime, size_bytes, purpose, created_by)
          values (${ctx.orgId}, 'dive', ${input.path}, ${input.mime}, ${input.sizeBytes}, ${input.purpose},
                  ${ctx.userId}) returning id`,
    ),
  );
  return (r as { id: string }).id;
}

/** A stored file the signed-in person may read (RLS decides), for the download route. */
export async function readableFile(
  tx: Tx,
  fileId: string,
): Promise<{ path: string; mime: string } | null> {
  return (
    (await one<{ path: string; mime: string }>(
      tx,
      sql`select path, mime from files where id = ${fileId} and bucket = 'dive'`,
    )) ?? null
  );
}

/** A diver's full name, as they sign it by default. */
export async function diverName(tx: Tx, diverId: string): Promise<string | null> {
  const r = await one<{ name: string }>(
    tx,
    sql`select first_name || ' ' || last_name as name from dive_divers where id = ${diverId}`,
  );
  return r?.name ?? null;
}
