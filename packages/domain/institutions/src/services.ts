/**
 * Institutions (brief §6.11): schools, councils and after-school frameworks that pay for their children's swimming.
 * A contract names the groups it pays for; the roster is the children placed in them; each month gets one invoice
 * (a tax invoice the worker prints through the invoicing provider), and payments are tracked against it.
 */
import { z } from 'zod';
import {
  BillingPeriod,
  ContractPricing,
  InstitutionKind,
  type InstitutionInvoiceStatus,
  InstitutionPaymentMethod,
  optionalPhone,
  optionalText,
  requiredDate,
  requiredInt,
  requiredText,
} from '@rswim/contracts';
import { and, asc, desc, eq, gte, inArray, lte, ne, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import { marksOfSessions } from '@rswim/domain-attendance';
import { studentsByIds } from '@rswim/domain-people';
import { groupTexts, lessonsOfGroups, placesInGroups, todayIL } from '@rswim/domain-scheduling';
import type { InvoicingProvider } from '@rswim/integrations';
import { agorot } from '@rswim/money';
import { addDays } from '@rswim/calendar';
import {
  contractMonth,
  dueOn,
  invoiceBalance,
  invoiceFor,
  paymentCheck,
  type ContractTerms,
  type InvoiceBalance,
  type InvoiceLine,
} from './policies';

const {
  institutions,
  institutionContracts,
  institutionContractGroups,
  institutionInvoices,
  institutionPayments,
} = schema;

async function guarded<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new DomainError('forms.errors.duplicate');
    throw e;
  }
}

const amountAgorot = () =>
  z
    .number({ error: 'forms.errors.amount' })
    .int('forms.errors.amount')
    .min(0, 'forms.errors.amount')
    .max(100_000_000, 'forms.errors.amount');

// ─── Institutions ───────────────────────────────────────────────────────────

export const InstitutionInput = z.object({
  name: requiredText(160),
  kind: InstitutionKind,
  taxId: optionalText(20),
  contactName: optionalText(120),
  contactPhone: optionalPhone(),
  contactEmail: z
    .preprocess((v) => (v === '' ? null : v), z.email('forms.errors.email').nullable())
    .default(null),
  address: optionalText(300),
  notes: optionalText(1000),
});
export type InstitutionInput = z.input<typeof InstitutionInput>;

export async function createInstitution(tx: Tx, ctx: ServiceContext, raw: InstitutionInput) {
  const input = InstitutionInput.parse(raw);
  const [row] = await guarded(() =>
    tx
      .insert(institutions)
      .values({ organizationId: ctx.orgId, ...input })
      .returning({ id: institutions.id }),
  );
  return (row as { id: string }).id;
}

export async function updateInstitution(tx: Tx, id: string, raw: InstitutionInput) {
  const input = InstitutionInput.parse(raw);
  await guarded(() => tx.update(institutions).set(input).where(eq(institutions.id, id)));
}

export async function listInstitutions(tx: Tx) {
  return tx.select().from(institutions).orderBy(desc(institutions.active), asc(institutions.name));
}

// ─── Contracts and their groups ─────────────────────────────────────────────

export const ContractInput = z
  .object({
    institutionId: z.uuid('forms.errors.required'),
    name: requiredText(160),
    startsOn: requiredDate(),
    endsOn: requiredDate(),
    pricing: ContractPricing,
    amountAgorot: amountAgorot(),
    paymentTermsDays: requiredInt(0, 180),
    notes: optionalText(1000),
  })
  .refine((c) => c.endsOn >= c.startsOn, {
    message: 'forms.errors.datesReversed',
    path: ['endsOn'],
  });
export type ContractInput = z.input<typeof ContractInput>;

export async function createContract(tx: Tx, ctx: ServiceContext, raw: ContractInput) {
  const input = ContractInput.parse(raw);
  const [row] = await tx
    .insert(institutionContracts)
    .values({ organizationId: ctx.orgId, ...input })
    .returning({ id: institutionContracts.id });
  return (row as { id: string }).id;
}

export async function updateContract(tx: Tx, id: string, raw: ContractInput) {
  const input = ContractInput.parse(raw);
  await tx.update(institutionContracts).set(input).where(eq(institutionContracts.id, id));
}

export const ContractGroupInput = z.object({
  contractId: z.uuid(),
  classTemplateId: z.uuid('forms.errors.required'),
});

/** A group is paid by one contract at a time: two contracts whose dates overlap cannot share it. */
export async function attachContractGroup(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof ContractGroupInput>,
) {
  const input = ContractGroupInput.parse(raw);
  const [contract] = await tx
    .select()
    .from(institutionContracts)
    .where(eq(institutionContracts.id, input.contractId));
  if (!contract) throw new DomainError('common.errors.notFound');
  const clash = await tx
    .select({ id: institutionContracts.id })
    .from(institutionContractGroups)
    .innerJoin(
      institutionContracts,
      eq(institutionContracts.id, institutionContractGroups.contractId),
    )
    .where(
      and(
        eq(institutionContractGroups.classTemplateId, input.classTemplateId),
        ne(institutionContracts.id, contract.id),
        lte(institutionContracts.startsOn, contract.endsOn),
        gte(institutionContracts.endsOn, contract.startsOn),
      ),
    );
  if (clash.length > 0) throw new DomainError('institutions.errors.groupTaken');
  await guarded(() =>
    tx.insert(institutionContractGroups).values({ organizationId: ctx.orgId, ...input }),
  );
}

export async function detachContractGroup(tx: Tx, raw: z.input<typeof ContractGroupInput>) {
  const input = ContractGroupInput.parse(raw);
  await tx
    .delete(institutionContractGroups)
    .where(
      and(
        eq(institutionContractGroups.contractId, input.contractId),
        eq(institutionContractGroups.classTemplateId, input.classTemplateId),
      ),
    );
}

export interface ContractView {
  id: string;
  institutionId: string;
  institutionName: string;
  name: string;
  startsOn: string;
  endsOn: string;
  pricing: ContractPricing;
  amountAgorot: number;
  paymentTermsDays: number;
  notes: string | null;
  groups: { id: string; name: string; venueName: string; weekday: number; time: string }[];
}

export async function listContracts(
  tx: Tx,
  filter: { institutionId?: string; ids?: readonly string[] } = {},
): Promise<ContractView[]> {
  const rows = await tx
    .select({ c: institutionContracts, institutionName: institutions.name })
    .from(institutionContracts)
    .innerJoin(institutions, eq(institutions.id, institutionContracts.institutionId))
    .where(
      and(
        filter.institutionId
          ? eq(institutionContracts.institutionId, filter.institutionId)
          : undefined,
        filter.ids ? inArray(institutionContracts.id, [...filter.ids]) : undefined,
      ),
    )
    .orderBy(desc(institutionContracts.startsOn), asc(institutionContracts.name));
  const links = rows.length
    ? await tx
        .select()
        .from(institutionContractGroups)
        .where(
          inArray(
            institutionContractGroups.contractId,
            rows.map((r) => r.c.id),
          ),
        )
    : [];
  const texts = await groupTexts(tx, [...new Set(links.map((l) => l.classTemplateId))]);
  return rows.map(({ c, institutionName }) => ({
    id: c.id,
    institutionId: c.institutionId,
    institutionName,
    name: c.name,
    startsOn: c.startsOn,
    endsOn: c.endsOn,
    pricing: c.pricing as ContractPricing,
    amountAgorot: c.amountAgorot,
    paymentTermsDays: c.paymentTermsDays,
    notes: c.notes,
    groups: links
      .filter((l) => l.contractId === c.id)
      .map((l) => texts.find((g) => g.id === l.classTemplateId))
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => ({
        id: g.id,
        name: g.name,
        venueName: g.venueName,
        weekday: g.weekday,
        time: g.time,
      })),
  }));
}

export async function getContract(tx: Tx, id: string) {
  return (await listContracts(tx, { ids: [id] }))[0] ?? null;
}

/**
 * Groups an institution pays for during [from, to]: families are not billed for places in them (billing asks this
 * when it drafts a month).
 */
export async function institutionPaidGroups(tx: Tx, from: string, to: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: institutionContractGroups.classTemplateId })
    .from(institutionContractGroups)
    .innerJoin(
      institutionContracts,
      eq(institutionContracts.id, institutionContractGroups.contractId),
    )
    .where(and(lte(institutionContracts.startsOn, to), gte(institutionContracts.endsOn, from)));
  return rows.map((r) => r.id);
}

// ─── The month: roster and attendance ───────────────────────────────────────

const termsOf = (c: ContractView): ContractTerms => ({
  name: c.name,
  pricing: c.pricing,
  amountAgorot: c.amountAgorot,
  startsOn: c.startsOn,
  endsOn: c.endsOn,
  paymentTermsDays: c.paymentTermsDays,
});

export interface MonthReport {
  contract: ContractView;
  period: string;
  range: { from: string; to: string } | null;
  roster: { studentId: string; name: string; groupIds: string[] }[];
  lessons: { id: string; classTemplateId: string; date: string; status: string }[];
  /** Per lesson: who was marked present, late or absent. */
  marks: { sessionId: string; studentId: string; status: string }[];
}

/** The contract's month: who was on the roster, which lessons ran, and the attendance marks. */
export async function contractMonthReport(
  tx: Tx,
  contractId: string,
  rawPeriod: string,
): Promise<MonthReport | null> {
  const period = BillingPeriod.parse(rawPeriod);
  const contract = await getContract(tx, contractId);
  if (!contract) return null;
  const range = contractMonth(contract, period);
  const groupIds = contract.groups.map((g) => g.id);
  if (!range || groupIds.length === 0) {
    return { contract, period, range, roster: [], lessons: [], marks: [] };
  }
  const [places, lessons] = await Promise.all([
    placesInGroups(tx, groupIds, range.from, addDays(range.to, 1)),
    lessonsOfGroups(tx, groupIds, range.from, range.to),
  ]);
  const kids = await studentsByIds(tx, [...new Set(places.map((p) => p.studentId))]);
  const roster = kids
    .map((k) => ({
      studentId: k.id,
      name: `${k.firstName} ${k.lastName}`,
      groupIds: [
        ...new Set(
          places.filter((p) => p.studentId === k.id).map((p) => p.classTemplateId as string),
        ),
      ],
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const marks = await marksOfSessions(
    tx,
    lessons.map((l) => l.id),
  );
  return {
    contract,
    period,
    range,
    roster,
    lessons: lessons.map((l) => ({
      id: l.id,
      classTemplateId: l.classTemplateId as string,
      date: l.date,
      status: l.status,
    })),
    marks,
  };
}

// ─── Invoices ───────────────────────────────────────────────────────────────

export const DraftInvoiceInput = z.object({ contractId: z.uuid(), period: BillingPeriod });

/**
 * Drafts (or redrafts) a month's invoice from the roster and the lessons held, with the explanation. An issued
 * invoice is never redrafted: it is final once printed.
 */
export async function draftInstitutionInvoice(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof DraftInvoiceInput>,
) {
  const input = DraftInvoiceInput.parse(raw);
  const report = await contractMonthReport(tx, input.contractId, input.period);
  if (!report) throw new DomainError('common.errors.notFound');
  if (!report.range) throw new DomainError('institutions.errors.outsideContract');
  const [existing] = await tx
    .select()
    .from(institutionInvoices)
    .where(
      and(
        eq(institutionInvoices.contractId, input.contractId),
        eq(institutionInvoices.period, input.period),
        ne(institutionInvoices.status, 'cancelled'),
      ),
    );
  if (existing && existing.status !== 'draft') throw new DomainError('institutions.errors.issued');
  const draft = invoiceFor(termsOf(report.contract), {
    period: input.period,
    children: report.roster.length,
    lessons: report.lessons,
  });
  const values = {
    amountAgorot: draft.amountAgorot,
    lines: draft.lines,
    explanation: draft.explanation,
  };
  if (existing) {
    await tx.update(institutionInvoices).set(values).where(eq(institutionInvoices.id, existing.id));
    return existing.id;
  }
  const [row] = await tx
    .insert(institutionInvoices)
    .values({
      organizationId: ctx.orgId,
      contractId: input.contractId,
      period: input.period,
      createdBy: ctx.userId,
      ...values,
    })
    .returning({ id: institutionInvoices.id });
  return (row as { id: string }).id;
}

/** The office approves a draft: the worker prints the tax invoice and sets the due date. */
export async function issueInstitutionInvoice(tx: Tx, ctx: ServiceContext, id: string) {
  const rows = await tx
    .update(institutionInvoices)
    .set({ status: 'issuing' })
    .where(and(eq(institutionInvoices.id, id), eq(institutionInvoices.status, 'draft')))
    .returning({ id: institutionInvoices.id });
  if (rows.length === 0) throw new DomainError('institutions.errors.notDraft');
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'institutions.invoice_approved',
    payload: { invoiceId: id },
    idempotencyKey: `institutions.invoice_approved:${id}`,
  });
}

export async function cancelInstitutionInvoice(tx: Tx, id: string) {
  const rows = await tx
    .update(institutionInvoices)
    .set({ status: 'cancelled' })
    .where(and(eq(institutionInvoices.id, id), eq(institutionInvoices.status, 'draft')))
    .returning({ id: institutionInvoices.id });
  if (rows.length === 0) throw new DomainError('institutions.errors.notDraft');
}

const clientOf = (inst: typeof institutions.$inferSelect) => ({
  name: inst.name,
  ...(inst.taxId ? { nationalId: inst.taxId } : {}),
  ...(inst.contactEmail ? { email: inst.contactEmail } : {}),
});

async function invoiceWithInstitution(tx: Tx, invoiceId: string) {
  const [row] = await tx
    .select({ inv: institutionInvoices, contract: institutionContracts, inst: institutions })
    .from(institutionInvoices)
    .innerJoin(institutionContracts, eq(institutionContracts.id, institutionInvoices.contractId))
    .innerJoin(institutions, eq(institutions.id, institutionContracts.institutionId))
    .where(eq(institutionInvoices.id, invoiceId));
  return row ?? null;
}

/** The worker's step: print the tax invoice (once, by idempotency key) and record its number and due date. */
export async function printInstitutionInvoice(
  tx: Tx,
  ctx: ServiceContext,
  invoicing: InvoicingProvider,
  invoiceId: string,
) {
  const row = await invoiceWithInstitution(tx, invoiceId);
  if (!row || row.inv.status !== 'issuing') return null;
  const today = await todayIL(tx);
  const due = dueOn(today, row.contract);
  const out = await invoicing.issueTaxInvoice(
    { organizationId: ctx.orgId, idempotencyKey: `institution-invoice:${invoiceId}` },
    {
      client: clientOf(row.inst),
      lines: (row.inv.lines as InvoiceLine[]).map((l) => ({
        description: l.description,
        amount: agorot(l.unitAgorot),
        quantity: l.quantity,
      })),
      dueOn: due,
    },
  );
  await tx
    .update(institutionInvoices)
    .set({
      status: 'issued',
      issuedAt: new Date(),
      dueOn: due,
      documentId: out.documentId,
      documentNumber: out.number,
      pdfUrl: out.pdfUrl,
    })
    .where(eq(institutionInvoices.id, invoiceId));
  return out.number;
}

export interface InvoiceView {
  id: string;
  contractId: string;
  contractName: string;
  institutionId: string;
  institutionName: string;
  period: string;
  amountAgorot: number;
  lines: InvoiceLine[];
  explanation: { code: string; params: Record<string, string | number> };
  status: string;
  dueOn: string | null;
  documentNumber: string | null;
  pdfUrl: string | null;
  balance: InvoiceBalance;
  payments: (typeof institutionPayments.$inferSelect)[];
}

/** Invoices with what was paid and whether they are late, newest month first. */
export async function listInstitutionInvoices(
  tx: Tx,
  filter: { institutionId?: string; contractId?: string; ids?: readonly string[] } = {},
): Promise<InvoiceView[]> {
  const rows = await tx
    .select({ inv: institutionInvoices, contract: institutionContracts, inst: institutions })
    .from(institutionInvoices)
    .innerJoin(institutionContracts, eq(institutionContracts.id, institutionInvoices.contractId))
    .innerJoin(institutions, eq(institutions.id, institutionContracts.institutionId))
    .where(
      and(
        filter.institutionId ? eq(institutions.id, filter.institutionId) : undefined,
        filter.contractId ? eq(institutionContracts.id, filter.contractId) : undefined,
        filter.ids ? inArray(institutionInvoices.id, [...filter.ids]) : undefined,
      ),
    )
    .orderBy(desc(institutionInvoices.period), asc(institutions.name));
  const payments = rows.length
    ? await tx
        .select()
        .from(institutionPayments)
        .where(
          inArray(
            institutionPayments.invoiceId,
            rows.map((r) => r.inv.id),
          ),
        )
        .orderBy(asc(institutionPayments.paidOn))
    : [];
  const today = await todayIL(tx);
  return rows.map(({ inv, contract, inst }) => {
    const mine = payments.filter((p) => p.invoiceId === inv.id);
    return {
      id: inv.id,
      contractId: contract.id,
      contractName: contract.name,
      institutionId: inst.id,
      institutionName: inst.name,
      period: inv.period,
      amountAgorot: inv.amountAgorot,
      lines: inv.lines as InvoiceLine[],
      explanation: inv.explanation as InvoiceView['explanation'],
      status: inv.status,
      dueOn: inv.dueOn,
      documentNumber: inv.documentNumber,
      pdfUrl: inv.pdfUrl,
      balance: invoiceBalance(
        {
          status: inv.status as InstitutionInvoiceStatus,
          amountAgorot: inv.amountAgorot,
          dueOn: inv.dueOn,
        },
        mine.map((p) => p.amountAgorot),
        today,
      ),
      payments: mine,
    };
  });
}

export const PaymentInput = z.object({
  invoiceId: z.uuid(),
  amountAgorot: amountAgorot().refine((n) => n > 0, 'forms.errors.amount'),
  paidOn: requiredDate(),
  method: InstitutionPaymentMethod,
  reference: optionalText(120),
});
export type PaymentInput = z.input<typeof PaymentInput>;

/**
 * Records a payment against an issued invoice (never more than what is left). In full, the invoice is paid. The
 * worker then prints the receipt.
 */
export async function recordInstitutionPayment(tx: Tx, ctx: ServiceContext, raw: PaymentInput) {
  const input = PaymentInput.parse(raw);
  const [inv] = await listInstitutionInvoices(tx, { ids: [input.invoiceId] });
  if (!inv) throw new DomainError('common.errors.notFound');
  const check = paymentCheck(
    { status: inv.status as InstitutionInvoiceStatus, amountAgorot: inv.amountAgorot },
    inv.balance.paidAgorot,
    input.amountAgorot,
  );
  if (!check.ok) throw new DomainError(check.code);
  const [row] = await tx
    .insert(institutionPayments)
    .values({ organizationId: ctx.orgId, ...input, recordedBy: ctx.userId })
    .returning({ id: institutionPayments.id });
  const id = (row as { id: string }).id;
  if (inv.balance.paidAgorot + input.amountAgorot >= inv.amountAgorot) {
    await tx
      .update(institutionInvoices)
      .set({ status: 'paid' })
      .where(eq(institutionInvoices.id, inv.id));
  }
  await emit(tx, {
    organizationId: ctx.orgId,
    type: 'institutions.payment_recorded',
    payload: { paymentId: id },
    idempotencyKey: `institutions.payment_recorded:${id}`,
  });
  return id;
}

/** The worker's step: print the receipt for a payment (once) and keep its number. */
export async function printInstitutionReceipt(
  tx: Tx,
  ctx: ServiceContext,
  invoicing: InvoicingProvider,
  paymentId: string,
) {
  const [p] = await tx
    .select()
    .from(institutionPayments)
    .where(eq(institutionPayments.id, paymentId));
  if (!p || p.receiptNumber) return null;
  const row = await invoiceWithInstitution(tx, p.invoiceId);
  if (!row?.inv.documentId) return null;
  const out = await invoicing.issueReceipt(
    { organizationId: ctx.orgId, idempotencyKey: `institution-receipt:${paymentId}` },
    {
      client: clientOf(row.inst),
      invoiceDocumentId: row.inv.documentId,
      amount: agorot(p.amountAgorot),
      paymentMethod: p.method,
    },
  );
  await tx
    .update(institutionPayments)
    .set({ receiptDocumentId: out.documentId, receiptNumber: out.number })
    .where(eq(institutionPayments.id, paymentId));
  return out.number;
}

/** Open money across institutions: what is owed and what is late (the office's dashboard line). */
export async function institutionDebts(tx: Tx) {
  const open = (await listInstitutionInvoices(tx)).filter((i) =>
    ['open', 'partial', 'overdue'].includes(i.balance.state),
  );
  return {
    owedAgorot: open.reduce((a, i) => a + i.balance.balanceAgorot, 0),
    overdueAgorot: open
      .filter((i) => i.balance.state === 'overdue')
      .reduce((a, i) => a + i.balance.balanceAgorot, 0),
    invoices: open,
  };
}
