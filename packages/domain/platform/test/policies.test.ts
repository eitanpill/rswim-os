import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import {
  billingPeriod,
  brandPalette,
  catalogProblems,
  chargeDecision,
  dnsVerified,
  featureEnabled,
  invoiceFor,
  normalizeHost,
  onboardingChecklist,
  parseTemplate,
  planChangeCheck,
  subscriptionAfterCharge,
  subscriptionOnDay,
  usageOf,
  verificationRecord,
  type PlanFacts,
  type SubscriptionFacts,
} from '../src/policies';

const starter: PlanFacts = {
  code: 'starter',
  priceAgorot: 14900,
  maxStudents: 60,
  maxStaff: 3,
  maxVenues: 1,
  features: ['reports'],
  graceDays: 10,
};
const pro: PlanFacts = {
  ...starter,
  code: 'pro',
  maxStudents: null,
  maxStaff: null,
  maxVenues: null,
};
const sub = (s: Partial<SubscriptionFacts> = {}): SubscriptionFacts => ({
  planCode: 'starter',
  status: 'active',
  trialEndsOn: null,
  mandateId: 'm-1',
  pastDueSince: null,
  ...s,
});

describe('usage and features', () => {
  it('measures each limit, with none for an unlimited plan or no plan', () => {
    expect(usageOf({ students: 30, staff: 3, venues: 0 }, starter)).toEqual([
      { limit: 'students', used: 30, max: 60, pct: 50, full: false },
      { limit: 'staff', used: 3, max: 3, pct: 100, full: true },
      { limit: 'venues', used: 0, max: 1, pct: 0, full: false },
    ]);
    expect(
      usageOf({ students: 5, staff: 9, venues: 2 }, { ...starter, maxVenues: 0, maxStaff: 4 }),
    ).toMatchObject([{}, { pct: 100, full: true }, { pct: 100, full: true }]);
    expect(usageOf({ students: 999, staff: 0, venues: 0 }, pro)[0]).toEqual({
      limit: 'students',
      used: 999,
      max: null,
      pct: null,
      full: false,
    });
    expect(usageOf({ students: 1, staff: 1, venues: 1 }, null).every((l) => l.max === null)).toBe(
      true,
    );
  });

  it('turns features on by plan, with the school’s own flags winning', () => {
    expect(featureEnabled(['reports'], [], 'reports')).toBe(true);
    expect(featureEnabled(['reports'], [], 'copilot')).toBe(false);
    expect(
      featureEnabled(['reports'], [{ key: 'feature.copilot', enabled: true }], 'copilot'),
    ).toBe(true);
    expect(
      featureEnabled(['reports'], [{ key: 'feature.reports', enabled: false }], 'reports'),
    ).toBe(false);
    expect(featureEnabled(null, [], 'institutions')).toBe(true);
  });

  it('refuses a plan smaller than what the school already uses', () => {
    expect(planChangeCheck({ students: 10, staff: 1, venues: 1 }, starter)).toEqual({ ok: true });
    expect(planChangeCheck({ students: 10, staff: 1, venues: 2 }, starter)).toEqual({
      ok: false,
      code: 'platform.errors.tooBigForPlan',
      params: { limit: 'venues', used: 2, max: 1 },
    });
  });
});

describe('the subscription over time', () => {
  it('ends a trial the day after it runs out', () => {
    const t = sub({ status: 'trialing', trialEndsOn: '2026-10-20' });
    expect(subscriptionOnDay(t, starter, '2026-10-20').changed).toBe(false);
    expect(subscriptionOnDay(t, starter, '2026-10-21')).toEqual({
      status: 'active',
      pastDueSince: null,
      changed: true,
      reason: 'trialEnded',
    });
    expect(subscriptionOnDay(sub({ status: 'trialing' }), starter, '2030-01-01').changed).toBe(
      false,
    );
  });

  it('suspends a school past due for the grace days', () => {
    const late = sub({ status: 'past_due', pastDueSince: '2026-11-01' });
    expect(subscriptionOnDay(late, starter, '2026-11-10').status).toBe('past_due');
    expect(subscriptionOnDay(late, starter, '2026-11-11')).toMatchObject({
      status: 'suspended',
      reason: 'graceOver',
    });
    expect(subscriptionOnDay(sub({ status: 'past_due' }), starter, '2030-01-01').changed).toBe(
      false,
    );
  });

  it('clears arrears on payment and starts the grace clock on a decline', () => {
    expect(subscriptionAfterCharge(sub(), 'paid', '2026-11-01')).toEqual({
      status: 'active',
      pastDueSince: null,
      changed: false,
      reason: null,
    });
    expect(
      subscriptionAfterCharge(
        sub({ status: 'suspended', pastDueSince: '2026-10-01' }),
        'paid',
        '2026-11-01',
      ),
    ).toMatchObject({ status: 'active', pastDueSince: null, changed: true, reason: 'paid' });
    expect(subscriptionAfterCharge(sub(), 'failed', '2026-11-01')).toEqual({
      status: 'past_due',
      pastDueSince: '2026-11-01',
      changed: true,
      reason: 'declined',
    });
    expect(
      subscriptionAfterCharge(
        sub({ status: 'past_due', pastDueSince: '2026-10-25' }),
        'failed',
        '2026-11-01',
      ),
    ).toMatchObject({ pastDueSince: '2026-10-25', changed: false });
    expect(
      subscriptionAfterCharge(
        sub({ status: 'suspended', pastDueSince: '2026-10-01' }),
        'failed',
        '2026-11-01',
      ),
    ).toMatchObject({ status: 'suspended', changed: false });
  });
});

describe('billing', () => {
  it('bills the plan’s price in advance once the trial is over', () => {
    expect(billingPeriod('2026-11-17')).toBe('2026-11-01');
    expect(invoiceFor(sub(), starter)).toEqual({
      bill: true,
      amountAgorot: 14900,
      planCode: 'starter',
    });
    expect(invoiceFor(sub({ status: 'past_due' }), starter).bill).toBe(true);
    expect(invoiceFor(sub({ status: 'trialing' }), starter)).toEqual({
      bill: false,
      reason: 'trialing',
    });
    expect(invoiceFor(sub({ status: 'suspended' }), starter)).toEqual({
      bill: false,
      reason: 'suspended',
    });
    expect(invoiceFor(sub({ status: 'cancelled' }), starter)).toEqual({
      bill: false,
      reason: 'cancelled',
    });
    expect(invoiceFor(sub(), { ...starter, priceAgorot: 0 })).toEqual({
      bill: false,
      reason: 'free',
    });
  });

  it('never charges a paid invoice again, nor without a payment method', () => {
    expect(chargeDecision({ status: 'open' }, 'm-1')).toEqual({ charge: true });
    expect(chargeDecision({ status: 'failed' }, 'm-1')).toEqual({ charge: true });
    expect(chargeDecision({ status: 'paid' }, 'm-1')).toEqual({ charge: false, code: null });
    expect(chargeDecision({ status: 'void' }, 'm-1')).toEqual({ charge: false, code: null });
    expect(chargeDecision({ status: 'open' }, null)).toEqual({
      charge: false,
      code: 'platform.errors.noMandate',
    });
  });
});

describe('onboarding', () => {
  it('is ready once every required step is done; domain and staff are optional', () => {
    const blank = {
      regulations: false,
      venues: 0,
      programs: 0,
      publishedPriceLists: 0,
      branded: false,
      verifiedDomains: 0,
      messages: false,
      staff: 0,
    };
    const empty = onboardingChecklist(blank);
    expect(empty.ready).toBe(false);
    expect(empty.doneCount).toBe(0);
    expect(empty.steps.find((s) => s.step === 'domain')).toEqual({
      step: 'domain',
      done: false,
      optional: true,
    });
    const full = onboardingChecklist({
      ...blank,
      regulations: true,
      venues: 1,
      programs: 3,
      publishedPriceLists: 1,
      branded: true,
      messages: true,
    });
    expect(full.ready).toBe(true);
    expect(full.doneCount).toBe(5);
    expect(onboardingChecklist({ ...blank, programs: 2 }).steps[2]).toMatchObject({ done: false });
  });
});

describe('brand and domains', () => {
  it('builds the colour scale from a hue, keeping the default theme otherwise', () => {
    expect(brandPalette('coral')).toMatchObject({ '--color-brand-600': 'oklch(54% 0.13 25)' });
    expect(Object.keys(brandPalette('sea'))).toHaveLength(5);
    expect(brandPalette(undefined)).toEqual({});
    expect(brandPalette(null)).toEqual({});
  });

  it('normalizes a typed host and refuses addresses, junk and the platform’s own domains', () => {
    expect(normalizeHost(' https://Swim.Example.co.il/login?x=1 ')).toEqual({
      ok: true,
      host: 'swim.example.co.il',
    });
    expect(normalizeHost('galim.localhost:3100')).toEqual({ ok: true, host: 'galim.localhost' });
    expect(normalizeHost('example.com.')).toEqual({ ok: true, host: 'example.com' });
    expect(normalizeHost('localhost')).toEqual({ ok: false, code: 'platform.errors.host' });
    expect(normalizeHost('10.0.0.1')).toEqual({ ok: false, code: 'platform.errors.host' });
    expect(normalizeHost('a'.repeat(250) + '.com')).toEqual({
      ok: false,
      code: 'platform.errors.host',
    });
    expect(normalizeHost('x.rswim.app', ['rswim.app'])).toEqual({
      ok: false,
      code: 'platform.errors.hostReserved',
    });
    expect(normalizeHost('rswim.app', ['rswim.app'])).toMatchObject({ ok: false });
  });

  it('accepts the TXT record that carries the token, even split into chunks', () => {
    expect(verificationRecord('swim.example.com')).toBe('_rswim.swim.example.com');
    expect(dnsVerified([['other'], ['rswim-verify=', 'abc']], 'abc')).toBe(true);
    expect(dnsVerified([['rswim-verify=abd']], 'abc')).toBe(false);
    expect(dnsVerified([], 'abc')).toBe(false);
  });
});

describe('templates', () => {
  it('validates each kind and refuses what does not fit', () => {
    expect(parseTemplate('regulations', { rules: DEFAULT_ORG_RULES }).ok).toBe(true);
    expect(parseTemplate('regulations', { rules: { nope: 1 } })).toEqual({
      ok: false,
      code: 'platform.errors.badTemplate',
    });
    const catalog = parseTemplate('catalog', {
      programs: [
        {
          code: 'kids',
          kind: 'group_kids',
          nameHe: 'ילדים',
          defaultDurationMin: 45,
          defaultCapacity: 6,
          levels: [{ code: 'l1', nameHe: 'צב' }],
        },
      ],
      prices: [
        { program: 'kids', kind: 'monthly', amountAgorot: 32000 },
        { program: 'adults', kind: 'monthly', amountAgorot: 30000 },
      ],
    });
    expect(catalog.ok).toBe(true);
    if (catalog.ok) {
      expect(catalog.payload.programs[0]?.nameEn).toBeNull();
      expect(catalogProblems(catalog.payload)).toEqual(['adults']);
    }
    expect(
      parseTemplate('messages', {
        messages: [{ key: 'trial_confirmation', locale: 'he', body: 'היי' }],
      }).ok,
    ).toBe(true);
    expect(parseTemplate('messages', { messages: [] }).ok).toBe(false);
  });
});
