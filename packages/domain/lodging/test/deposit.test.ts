import { describe, expect, it } from 'vitest';
import { amountToRequest, bookingMoney, depositFor, holdUntil } from '../src/deposit';

describe("a booking's money", () => {
  it('asks for a deposit as a percent of the price, in whole shekels', () => {
    expect(depositFor(null, 30)).toBeNull();
    expect(depositFor(100_000, 0)).toBe(0);
    expect(depositFor(123_456, 30)).toBe(37_000);
    expect(depositFor(50_000, 100)).toBe(50_000);
  });

  it('adds payments, takes refunds off, and knows what is still owed', () => {
    const m = bookingMoney(
      100_000,
      [
        { kind: 'payment', amountAgorot: 30_000 },
        { kind: 'payment', amountAgorot: 80_000 },
        { kind: 'refund', amountAgorot: 5_000 },
      ],
      30,
    );
    expect(m).toEqual({
      totalAgorot: 100_000,
      paidAgorot: 105_000,
      dueAgorot: 0,
      overpaidAgorot: 5_000,
      depositAgorot: 30_000,
      depositDueAgorot: 0,
      depositPaid: true,
    });
    const part = bookingMoney(100_000, [{ kind: 'payment', amountAgorot: 10_000 }], 30);
    expect(part).toMatchObject({ dueAgorot: 90_000, depositDueAgorot: 20_000, depositPaid: false });
    expect(amountToRequest(part, 'deposit')).toBe(20_000);
    expect(amountToRequest(part, 'balance')).toBe(90_000);
  });

  it('without a price, any payment covers the deposit and nothing is owed', () => {
    const none = bookingMoney(null, [], 30);
    expect(none).toMatchObject({ dueAgorot: null, overpaidAgorot: 0, depositPaid: false });
    expect(amountToRequest(none, 'balance')).toBe(0);
    expect(bookingMoney(null, [{ kind: 'payment', amountAgorot: 1 }], 30).depositPaid).toBe(true);
    expect(bookingMoney(100_000, [], 0).depositPaid).toBe(true);
  });

  it('holds a booking for some hours', () => {
    expect(holdUntil(new Date('2029-01-01T10:00:00Z'), 24).toISOString()).toBe(
      '2029-01-02T10:00:00.000Z',
    );
  });
});
