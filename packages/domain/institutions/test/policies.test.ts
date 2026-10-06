import { describe, expect, it } from 'vitest';
import {
  contractMonth,
  dueOn,
  invoiceBalance,
  invoiceFor,
  monthRange,
  paymentCheck,
  type ContractTerms,
} from '../src/policies';

const terms: ContractTerms = {
  name: 'בית ספר אופק',
  pricing: 'per_child_month',
  amountAgorot: 12_000,
  startsOn: '2026-09-10',
  endsOn: '2027-06-20',
  paymentTermsDays: 30,
};

describe('months', () => {
  it('knows a month’s days and the part a contract covers', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    expect(contractMonth(terms, '2026-09')).toEqual({ from: '2026-09-10', to: '2026-09-30' });
    expect(contractMonth(terms, '2027-06')).toEqual({ from: '2027-06-01', to: '2027-06-20' });
    expect(contractMonth(terms, '2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(contractMonth(terms, '2026-08')).toBeNull();
  });
});

describe('the monthly invoice', () => {
  const lessons = [
    { date: '2026-10-04', status: 'completed' },
    { date: '2026-10-11', status: 'cancelled_by_school' },
    { date: '2026-10-18', status: 'scheduled' },
  ];

  it('charges per child on the roster', () => {
    expect(invoiceFor(terms, { period: '2026-10', children: 14, lessons })).toEqual({
      amountAgorot: 168_000,
      lines: [
        {
          description: 'שיעורי שחייה – בית ספר אופק – חודש 10/2026 (14 ילדים)',
          quantity: 14,
          unitAgorot: 12_000,
          amountAgorot: 168_000,
        },
      ],
      explanation: {
        code: 'institutions.decision.per_child_month',
        params: { count: 14, rate: 12_000, amount: 168_000, cancelled: 1 },
      },
    });
  });

  it('charges per lesson held, not for cancelled ones', () => {
    const d = invoiceFor(
      { ...terms, pricing: 'per_session', amountAgorot: 90_000 },
      { period: '2026-10', children: 14, lessons },
    );
    expect(d.amountAgorot).toBe(180_000);
    expect(d.lines[0]?.description).toBe('שיעורי שחייה – בית ספר אופק – חודש 10/2026 (2 שיעורים)');
  });

  it('charges a fixed month', () => {
    const d = invoiceFor(
      { ...terms, pricing: 'fixed_month', amountAgorot: 500_000 },
      { period: '2026-10', children: 0, lessons: [] },
    );
    expect(d).toMatchObject({ amountAgorot: 500_000, lines: [{ quantity: 1 }] });
    expect(d.lines[0]?.description).toBe('שיעורי שחייה – בית ספר אופק – חודש 10/2026');
  });

  it('falls due by the contract’s payment terms', () => {
    expect(dueOn('2026-10-31', terms)).toBe('2026-11-30');
  });
});

describe('payments', () => {
  const issued = { status: 'issued' as const, amountAgorot: 100_000, dueOn: '2026-11-30' };

  it('tracks what is paid and what is late', () => {
    expect(invoiceBalance(issued, [], '2026-11-01')).toEqual({
      paidAgorot: 0,
      balanceAgorot: 100_000,
      state: 'open',
      daysLate: 0,
    });
    expect(invoiceBalance(issued, [40_000], '2026-11-01').state).toBe('partial');
    expect(invoiceBalance(issued, [40_000], '2026-12-05')).toEqual({
      paidAgorot: 40_000,
      balanceAgorot: 60_000,
      state: 'overdue',
      daysLate: 5,
    });
    expect(invoiceBalance({ ...issued, status: 'paid' }, [100_000], '2027-01-01').state).toBe(
      'paid',
    );
    expect(invoiceBalance({ ...issued, dueOn: null }, [], '2027-01-01').state).toBe('open');
    for (const status of ['draft', 'issuing', 'cancelled'] as const) {
      expect(invoiceBalance({ ...issued, status }, [], '2027-01-01').state).toBe(status);
    }
  });

  it('records payments against an issued invoice, up to its balance', () => {
    expect(paymentCheck(issued, 0, 100_000)).toEqual({ ok: true });
    expect(paymentCheck(issued, 40_000, 70_000)).toEqual({
      ok: false,
      code: 'institutions.errors.overpaid',
    });
    expect(paymentCheck({ ...issued, status: 'paid' }, 100_000, 1)).toEqual({
      ok: false,
      code: 'institutions.errors.alreadyPaid',
    });
    expect(paymentCheck({ ...issued, status: 'draft' }, 0, 1)).toEqual({
      ok: false,
      code: 'institutions.errors.notIssued',
    });
  });
});
