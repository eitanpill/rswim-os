import { z } from 'zod';

/** Institutions that buy swimming for their children (brief §6.11): schools, councils, after-school frameworks. */
export const INSTITUTION_KINDS = [
  'school',
  'municipality',
  'after_school',
  'community_center',
  'other',
] as const;
export const InstitutionKind = z.enum(INSTITUTION_KINDS);
export type InstitutionKind = z.infer<typeof InstitutionKind>;

/** How a contract prices a month: per child on the roster, per lesson held, or a fixed monthly sum. */
export const CONTRACT_PRICING = ['per_child_month', 'per_session', 'fixed_month'] as const;
export const ContractPricing = z.enum(CONTRACT_PRICING);
export type ContractPricing = z.infer<typeof ContractPricing>;

/**
 * A monthly institution invoice: drafted from the roster, issued (the worker prints the tax invoice), paid in full,
 * or cancelled before it was issued.
 */
export const INSTITUTION_INVOICE_STATUSES = [
  'draft',
  'issuing',
  'issued',
  'paid',
  'cancelled',
] as const;
export const InstitutionInvoiceStatus = z.enum(INSTITUTION_INVOICE_STATUSES);
export type InstitutionInvoiceStatus = z.infer<typeof InstitutionInvoiceStatus>;

export const INSTITUTION_PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'other'] as const;
export const InstitutionPaymentMethod = z.enum(INSTITUTION_PAYMENT_METHODS);
export type InstitutionPaymentMethod = z.infer<typeof InstitutionPaymentMethod>;

/** Hebrew wording on an institution's tax invoice (a legal document, so not translated per viewer). */
export const INSTITUTION_FISCAL_TEXT_HE = {
  lessons: 'שיעורי שחייה',
  month: 'חודש',
  children: 'ילדים',
  sessions: 'שיעורים',
} as const;
