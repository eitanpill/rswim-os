/**
 * Invoice-receipts (brief §6.7): every successful payment gets a legal document from the invoicing provider. The
 * worker decides what the payment paid (first in, first out over the ledger), builds the documents (reimbursement
 * wording, ID number, lesson dates, method, one per month when the profile says so), stores exactly what it sends,
 * and only then calls the provider, with an idempotency key per document.
 */
import { and, desc, eq, inArray, schema, type Tx } from '@rswim/db';
import { decryptField, orgDataKey, type ServiceContext } from '@rswim/domain-core';
import { getHousehold, studentsByIds } from '@rswim/domain-people';
import type { InvoicingProvider } from '@rswim/integrations';
import type { PaymentMethod } from '@rswim/contracts';
import { allocate, receiptDocuments, type CoveredItem } from '../policies';
import { ledgerFacts } from './ledger';

const {
  billingRunLines,
  fiscalDocuments,
  householdBilling,
  ledgerEntries,
  payments,
  reimbursementProfiles,
} = schema;

export type FiscalDocumentRow = typeof fiscalDocuments.$inferSelect;

/** Who the receipt is made out to: the billing details, else the billing guardian, else the household's name. */
async function payerOf(tx: Tx, ctx: ServiceContext, householdId: string) {
  const [billing] = await tx
    .select({
      id: householdBilling.id,
      payerName: householdBilling.payerName,
      payerEmail: householdBilling.payerEmail,
      enc: householdBilling.encPayerNationalId,
      profileId: householdBilling.reimbursementProfileId,
    })
    .from(householdBilling)
    .where(eq(householdBilling.householdId, householdId));
  const family = await getHousehold(tx, householdId);
  const guardian =
    family?.guardians.find((g) => g.isBillingContact) ?? family?.guardians[0] ?? null;
  let nationalId: string | null = null;
  if (billing?.enc) {
    const dek = await orgDataKey(tx, ctx.orgId);
    if (dek) {
      nationalId = decryptField(dek, billing.enc, {
        table: 'household_billing',
        column: 'enc_payer_national_id',
        rowId: billing.id,
      });
    }
  }
  const [profile] = billing?.profileId
    ? await tx
        .select()
        .from(reimbursementProfiles)
        .where(eq(reimbursementProfiles.id, billing.profileId))
    : [];
  return {
    client: {
      name:
        billing?.payerName ??
        (guardian
          ? `${guardian.firstName} ${guardian.lastName}`
          : (family?.household.displayName ?? '')),
      nationalId,
      email: billing?.payerEmail ?? guardian?.email ?? null,
    },
    profile: profile
      ? {
          wording: profile.wording,
          requiresNationalId: profile.requiresNationalId,
          includeSessionDates: profile.includeSessionDates,
          splitPerMonth: profile.splitPerMonth,
        }
      : null,
  };
}

/** What a payment paid, as receipt lines: the run lines (with their dates) or the manual entries it settled. */
async function coveredBy(
  tx: Tx,
  householdId: string,
  paymentEntryId: string,
): Promise<CoveredItem[]> {
  const facts = (await ledgerFacts(tx, [householdId])).get(householdId) ?? [];
  const paid = allocate(facts).byPayment[paymentEntryId] ?? [];
  if (paid.length === 0) return [];
  const keys = paid.map((p) => p.key);
  const [lines, entries] = await Promise.all([
    tx.select().from(billingRunLines).where(inArray(billingRunLines.id, keys)),
    tx.select().from(ledgerEntries).where(inArray(ledgerEntries.id, keys)),
  ]);
  const studentIds = [...lines, ...entries].map((x) => x.studentId).filter((x): x is string => !!x);
  const names = new Map(
    (await studentsByIds(tx, [...new Set(studentIds)])).map((s) => [s.id, s.firstName]),
  );
  return paid.map((p) => {
    const line = lines.find((l) => l.id === p.key);
    const entry = entries.find((e) => e.id === p.key);
    const src = line ?? entry;
    return {
      description: src?.description ?? '',
      period: src?.period ?? null,
      studentName: src?.studentId ? (names.get(src.studentId) ?? null) : null,
      sessionDates: line ? (line.sessionDates as string[]) : [],
      amount: p.amount,
    };
  });
}

/**
 * Issues the invoice-receipt(s) of a successful payment. Documents already issued are left alone; one the rules
 * refuse (no ID number for a reimbursement profile that needs it) is stored as failed with the reason, for the office.
 */
export async function issueReceipts(
  tx: Tx,
  ctx: ServiceContext,
  invoicing: InvoicingProvider,
  paymentId: string,
  providerName = 'green_invoice',
) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!p || p.kind !== 'payment' || p.status !== 'succeeded') return [];
  const [entry] = await tx
    .select({ id: ledgerEntries.id })
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.paymentId, paymentId), eq(ledgerEntries.type, 'payment')));
  if (!entry) return [];
  const { client, profile } = await payerOf(tx, ctx, p.householdId);
  const decision = receiptDocuments({
    payment: { amount: p.amountAgorot, method: p.method as PaymentMethod, paidOn: p.paidOn ?? '' },
    client,
    profile,
    covered: await coveredBy(tx, p.householdId, entry.id),
  });
  if (!decision.ok) {
    await tx
      .insert(fiscalDocuments)
      .values({
        organizationId: ctx.orgId,
        householdId: p.householdId,
        paymentId,
        status: 'failed',
        provider: providerName,
        totalAgorot: p.amountAgorot,
        request: {},
        error: decision.explanation,
        idempotencyKey: `receipt:${paymentId}:refused`,
      })
      .onConflictDoNothing({
        target: [fiscalDocuments.organizationId, fiscalDocuments.idempotencyKey],
      });
    return [];
  }
  const issued: string[] = [];
  for (const doc of decision.documents) {
    const key = `receipt:${paymentId}:${doc.period ?? 'all'}`;
    const request = {
      client: doc.client,
      lines: doc.lines,
      paymentMethod: doc.paymentMethod,
      notes: doc.notes,
    };
    await tx
      .insert(fiscalDocuments)
      .values({
        organizationId: ctx.orgId,
        householdId: p.householdId,
        paymentId,
        status: 'pending',
        period: doc.period,
        provider: providerName,
        totalAgorot: doc.total,
        request,
        idempotencyKey: key,
      })
      .onConflictDoNothing({
        target: [fiscalDocuments.organizationId, fiscalDocuments.idempotencyKey],
      });
    const [row] = await tx
      .select()
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.idempotencyKey, key));
    if (!row || row.status === 'issued') continue;
    const out = await invoicing.issueInvoiceReceipt(
      { organizationId: ctx.orgId, idempotencyKey: key },
      request,
    );
    await tx
      .update(fiscalDocuments)
      .set({
        status: 'issued',
        externalId: out.documentId,
        number: out.number,
        pdfUrl: out.pdfUrl,
        issuedAt: new Date(),
        error: null,
      })
      .where(eq(fiscalDocuments.id, row.id));
    issued.push(row.id);
  }
  return issued;
}

export async function documentsOf(tx: Tx, householdId: string) {
  return tx
    .select()
    .from(fiscalDocuments)
    .where(eq(fiscalDocuments.householdId, householdId))
    .orderBy(desc(fiscalDocuments.createdAt));
}
