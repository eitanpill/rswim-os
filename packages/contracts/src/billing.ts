import { z } from 'zod';

/** Billing, payments and receipts (brief §5 "Money", §6.7). Amounts are integer agorot everywhere. */

/**
 * A ledger entry's kind. Amounts are signed: positive is owed by the family (charge, refund paid out to them),
 * negative reduces what they owe (discount, credit, payment, write-off). Adjustments may go either way.
 */
export const LEDGER_ENTRY_TYPES = [
  'charge',
  'discount',
  'credit',
  'payment',
  'refund',
  'write_off',
  'adjustment',
] as const;
export const LedgerEntryType = z.enum(LEDGER_ENTRY_TYPES);
export type LedgerEntryType = z.infer<typeof LedgerEntryType>;

/** Where an entry came from. */
export const LEDGER_SOURCES = [
  'billing_run',
  'manual',
  'trial_offset',
  'closure_credit',
  'payment',
  'refund',
  'reversal',
] as const;
export const LedgerSource = z.enum(LEDGER_SOURCES);
export type LedgerSource = z.infer<typeof LedgerSource>;

/** What a billing run line charges for. */
export const BILLING_LINE_KINDS = [
  'seat',
  'slots',
  'package',
  'trial',
  'sibling_discount',
] as const;
export const BillingLineKind = z.enum(BILLING_LINE_KINDS);
export type BillingLineKind = z.infer<typeof BillingLineKind>;

/** A run is drafted, reviewed, then posted to the ledger (approving posts it) or discarded. */
export const BILLING_RUN_STATUSES = ['draft', 'posted', 'discarded'] as const;
export const BillingRunStatus = z.enum(BILLING_RUN_STATUSES);
export type BillingRunStatus = z.infer<typeof BillingRunStatus>;

/** What the pre-run review flags (brief §6.7). */
export const ANOMALY_KINDS = [
  'charge_without_enrollment',
  'enrollment_without_charge',
  'duplicate_mandate',
  'missing_mandate',
  'amount_changed',
] as const;
export const AnomalyKind = z.enum(ANOMALY_KINDS);
export type AnomalyKind = z.infer<typeof AnomalyKind>;

export const PAYMENT_METHODS = [
  'credit_card',
  'standing_order',
  'bit',
  'paybox',
  'cash',
  'bank_transfer',
  'cheque',
  'other',
] as const;
export const PaymentMethod = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** Methods the office records by hand (the rest come from the payment provider). */
export const MANUAL_PAYMENT_METHODS = [
  'bit',
  'paybox',
  'cash',
  'bank_transfer',
  'cheque',
  'other',
] as const satisfies readonly PaymentMethod[];

export const PAYMENT_STATUSES = ['pending', 'succeeded', 'failed', 'cancelled'] as const;
export const PaymentStatus = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

/** `payment` collects money; `refund` returns it (through the provider, or off-platform with proof). */
export const PAYMENT_KINDS = ['payment', 'refund'] as const;
export const PaymentKind = z.enum(PAYMENT_KINDS);
export type PaymentKind = z.infer<typeof PaymentKind>;

/** `failing`: the last charge failed and a dunning case is open. */
export const STANDING_ORDER_STATUSES = ['active', 'failing', 'cancelled'] as const;
export const StandingOrderStatus = z.enum(STANDING_ORDER_STATUSES);
export type StandingOrderStatus = z.infer<typeof StandingOrderStatus>;

export const PAYMENT_LINK_STATUSES = ['open', 'paid', 'cancelled'] as const;
export const PaymentLinkStatus = z.enum(PAYMENT_LINK_STATUSES);
export type PaymentLinkStatus = z.infer<typeof PaymentLinkStatus>;

export const FISCAL_DOCUMENT_KINDS = ['invoice_receipt', 'credit_note'] as const;
export const FiscalDocumentKind = z.enum(FISCAL_DOCUMENT_KINDS);
export type FiscalDocumentKind = z.infer<typeof FiscalDocumentKind>;

export const FISCAL_DOCUMENT_STATUSES = ['pending', 'issued', 'failed'] as const;
export const FiscalDocumentStatus = z.enum(FISCAL_DOCUMENT_STATUSES);
export type FiscalDocumentStatus = z.infer<typeof FiscalDocumentStatus>;

/** `open`: retrying; `escalated`: the owner has it; `resolved`: paid; `written_off`: given up. */
export const DUNNING_STATUSES = ['open', 'escalated', 'resolved', 'written_off'] as const;
export const DunningStatus = z.enum(DUNNING_STATUSES);
export type DunningStatus = z.infer<typeof DunningStatus>;

export const REIMBURSEMENT_KINDS = [
  'ministry_of_defense',
  'insurance',
  'reservists',
  'employer',
  'other',
] as const;
export const ReimbursementKind = z.enum(REIMBURSEMENT_KINDS);
export type ReimbursementKind = z.infer<typeof ReimbursementKind>;

/** How a household prefers to pay. `standing_order` follows billing.method_required; the rest get a link or pay by hand. */
export const PREFERRED_METHODS = ['standing_order', 'payment_link', 'manual'] as const;
export const PreferredMethod = z.enum(PREFERRED_METHODS);
export type PreferredMethod = z.infer<typeof PreferredMethod>;

export const FREEZE_STATUSES = ['requested', 'approved', 'rejected', 'cancelled'] as const;
export const FreezeStatus = z.enum(FREEZE_STATUSES);
export type FreezeStatus = z.infer<typeof FreezeStatus>;

export const FREEZE_REASONS = ['medical', 'vacation', 'other'] as const;
export const FreezeReason = z.enum(FREEZE_REASONS);
export type FreezeReason = z.infer<typeof FreezeReason>;

/** A family's own request from the portal, processed by the worker with the office's rules (Phase 7). */
export const PORTAL_REQUEST_KINDS = ['freeze', 'cancellation'] as const;
export const PortalRequestKind = z.enum(PORTAL_REQUEST_KINDS);
export type PortalRequestKind = z.infer<typeof PortalRequestKind>;
export const PORTAL_REQUEST_STATUSES = ['pending', 'done', 'refused', 'withdrawn'] as const;
export const PortalRequestStatus = z.enum(PORTAL_REQUEST_STATUSES);
export type PortalRequestStatus = z.infer<typeof PortalRequestStatus>;

export const CANCELLATION_STATUSES = ['active', 'withdrawn'] as const;
export const CancellationStatus = z.enum(CANCELLATION_STATUSES);
export type CancellationStatus = z.infer<typeof CancellationStatus>;

/**
 * Text printed on legal documents (invoice-receipts). It is fiscal content sent to the invoicing provider in Hebrew
 * whatever the reader's UI language, not interface text; a reimbursement profile adds its own wording on top.
 */
export const FISCAL_TEXT_HE = {
  methods: {
    credit_card: 'כרטיס אשראי',
    standing_order: 'הוראת קבע (כרטיס אשראי)',
    bit: 'ביט',
    paybox: 'פייבוקס',
    cash: 'מזומן',
    bank_transfer: 'העברה בנקאית',
    cheque: 'המחאה',
    other: 'אחר',
  } satisfies Record<PaymentMethod, string>,
  sessionDates: 'תאריכי המפגשים',
  nationalId: 'ת.ז.',
  prepayment: 'תשלום על חשבון (יתרת זכות)',
  period: 'חודש',
} as const;

/** "YYYY-MM": a billing period (a calendar month in Israel). */
export const BillingPeriod = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'forms.errors.period');
export type BillingPeriod = z.infer<typeof BillingPeriod>;

/** An Israeli ID number (9 digits with the check digit; shorter ones are left-padded with zeros). */
export function isValidIsraeliId(raw: string): boolean {
  const s = raw.trim();
  if (!/^\d{5,9}$/.test(s)) return false;
  const digits = s.padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    const d = Number(digits[i]) * ((i % 2) + 1);
    sum += d > 9 ? d - 9 : d;
  }
  return sum % 10 === 0;
}
