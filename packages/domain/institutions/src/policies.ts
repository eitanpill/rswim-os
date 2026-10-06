/**
 * Pure institution rules (brief §6.11, docs/POLICIES.md §14): what a contract charges for a month, when the invoice
 * falls due, how much of it is paid, and whether a payment may be recorded. Every amount is agorot; every refusal is
 * an i18n code; every invoice carries its explanation.
 */
import { addDays } from '@rswim/calendar';
import {
  INSTITUTION_FISCAL_TEXT_HE,
  type ContractPricing,
  type InstitutionInvoiceStatus,
} from '@rswim/contracts';

export type Explanation = { code: string; params: Record<string, string | number> };
export type Check = { ok: true } | { ok: false; code: string };

const refuse = (code: string): Check => ({ ok: false, code: `institutions.errors.${code}` });

export interface ContractTerms {
  name: string;
  pricing: ContractPricing;
  amountAgorot: number;
  startsOn: string;
  endsOn: string;
  paymentTermsDays: number;
}

/** "YYYY-MM" → first and last day. */
export function monthRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${period}-01`, to: `${period}-${String(last).padStart(2, '0')}` };
}

/** The part of a month the contract runs, or null when it does not run that month at all. */
export function contractMonth(
  terms: Pick<ContractTerms, 'startsOn' | 'endsOn'>,
  period: string,
): { from: string; to: string } | null {
  const m = monthRange(period);
  const from = terms.startsOn > m.from ? terms.startsOn : m.from;
  const to = terms.endsOn < m.to ? terms.endsOn : m.to;
  return from <= to ? { from, to } : null;
}

export interface MonthFacts {
  period: string;
  /** Children on the roster that month (a place in one of the contract's groups, inside the contract's dates). */
  children: number;
  /** The contract's lessons that month, with their status. */
  lessons: { date: string; status: string }[];
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitAgorot: number;
  amountAgorot: number;
}

export interface InvoiceDraft {
  amountAgorot: number;
  lines: InvoiceLine[];
  explanation: Explanation;
}

const held = (status: string) => !status.startsWith('cancelled');

/**
 * A month's invoice: per child on the roster, per lesson held (cancelled ones are not charged), or the fixed monthly
 * sum. The line text is the Hebrew the tax invoice prints.
 */
export function invoiceFor(terms: ContractTerms, facts: MonthFacts): InvoiceDraft {
  const lessonsHeld = facts.lessons.filter((l) => held(l.status)).length;
  const quantity =
    terms.pricing === 'per_child_month'
      ? facts.children
      : terms.pricing === 'per_session'
        ? lessonsHeld
        : 1;
  const amountAgorot = quantity * terms.amountAgorot;
  const t = INSTITUTION_FISCAL_TEXT_HE;
  const month = `${t.month} ${facts.period.slice(5)}/${facts.period.slice(0, 4)}`;
  const counted =
    terms.pricing === 'per_child_month'
      ? ` (${quantity} ${t.children})`
      : terms.pricing === 'per_session'
        ? ` (${quantity} ${t.sessions})`
        : '';
  return {
    amountAgorot,
    lines: [
      {
        description: `${t.lessons} – ${terms.name} – ${month}${counted}`,
        quantity,
        unitAgorot: terms.amountAgorot,
        amountAgorot,
      },
    ],
    explanation: {
      code: `institutions.decision.${terms.pricing}`,
      params: {
        count: quantity,
        price: terms.amountAgorot,
        total: amountAgorot,
        cancelled: facts.lessons.length - lessonsHeld,
      },
    },
  };
}

/** The due date: the contract's payment terms counted from the day the invoice is issued. */
export function dueOn(issuedOn: string, terms: Pick<ContractTerms, 'paymentTermsDays'>): string {
  return addDays(issuedOn, terms.paymentTermsDays);
}

export type InvoiceState =
  'draft' | 'issuing' | 'open' | 'partial' | 'overdue' | 'paid' | 'cancelled';

export interface InvoiceBalance {
  paidAgorot: number;
  balanceAgorot: number;
  state: InvoiceState;
  /** Days past the due date (0 when not overdue). */
  daysLate: number;
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Where an invoice stands on a day: paid so far, what is left, and whether it is late. */
export function invoiceBalance(
  inv: { status: InvoiceStatusLike; amountAgorot: number; dueOn: string | null },
  payments: readonly number[],
  today: string,
): InvoiceBalance {
  const paidAgorot = payments.reduce((a, b) => a + b, 0);
  const balanceAgorot = Math.max(0, inv.amountAgorot - paidAgorot);
  const base = { paidAgorot, balanceAgorot, daysLate: 0 };
  if (inv.status === 'draft' || inv.status === 'issuing' || inv.status === 'cancelled') {
    return { ...base, state: inv.status };
  }
  if (balanceAgorot === 0) return { ...base, state: 'paid' };
  if (inv.dueOn && today > inv.dueOn) {
    return { ...base, state: 'overdue', daysLate: daysBetween(inv.dueOn, today) };
  }
  return { ...base, state: paidAgorot > 0 ? 'partial' : 'open' };
}

type InvoiceStatusLike = InstitutionInvoiceStatus;

/** A payment is recorded against an issued invoice, for no more than what is left on it. */
export function paymentCheck(
  inv: { status: InvoiceStatusLike; amountAgorot: number },
  paidSoFar: number,
  amount: number,
): Check {
  if (inv.status === 'paid') return refuse('alreadyPaid');
  if (inv.status !== 'issued') return refuse('notIssued');
  if (amount > inv.amountAgorot - paidSoFar) return refuse('overpaid');
  return { ok: true };
}
