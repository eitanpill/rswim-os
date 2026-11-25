/**
 * A booking's money (docs/LODGING.md, "Deposits and payments"), as pure functions: the deposit it asks for, what the
 * guest has paid and still owes, and until when a held booking waits for its deposit. Nothing here reads a clock or
 * a database.
 */
import type { LodgingPaymentKind } from '@rswim/contracts';

/** The deposit for a price: a percent of it, rounded to a whole shekel; none when the booking has no price. */
export function depositFor(totalAgorot: number | null, percent: number): number | null {
  if (totalAgorot === null) return null;
  if (percent <= 0) return 0;
  return Math.min(totalAgorot, Math.round((totalAgorot * percent) / 10_000) * 100);
}

export interface MoneyLine {
  kind: LodgingPaymentKind;
  amountAgorot: number;
}

export interface BookingMoney {
  /** Null when a night of the booking has no price. */
  totalAgorot: number | null;
  /** Payments less refunds. */
  paidAgorot: number;
  /** What is still owed (0 once paid in full); null without a price. */
  dueAgorot: number | null;
  /** Paid beyond the price (to refund). */
  overpaidAgorot: number;
  /** The deposit asked for (0 when none); null without a price. */
  depositAgorot: number | null;
  /** The deposit still missing (0 once covered). Without a price, any payment covers it. */
  depositDueAgorot: number;
  depositPaid: boolean;
}

/** What a booking cost, what came in, and what is still owed. */
export function bookingMoney(
  totalAgorot: number | null,
  lines: readonly MoneyLine[],
  depositPercent: number,
): BookingMoney {
  const paid = lines.reduce(
    (sum, l) => sum + (l.kind === 'refund' ? -l.amountAgorot : l.amountAgorot),
    0,
  );
  const deposit = depositFor(totalAgorot, depositPercent);
  const depositDue = deposit === null ? 0 : Math.max(0, deposit - paid);
  return {
    totalAgorot,
    paidAgorot: paid,
    dueAgorot: totalAgorot === null ? null : Math.max(0, totalAgorot - paid),
    overpaidAgorot: totalAgorot === null ? 0 : Math.max(0, paid - totalAgorot),
    depositAgorot: deposit,
    depositDueAgorot: depositDue,
    depositPaid: deposit === null ? paid > 0 : depositDue === 0,
  };
}

/** What a payment request asks for: the deposit still missing, or everything still owed. */
export function amountToRequest(money: BookingMoney, what: 'deposit' | 'balance'): number {
  if (what === 'deposit') return money.depositDueAgorot;
  return money.dueAgorot ?? 0;
}

/** Until when a booking held now waits for its deposit. */
export function holdUntil(now: Date, hours: number): Date {
  return new Date(now.getTime() + hours * 60 * 60 * 1000);
}
