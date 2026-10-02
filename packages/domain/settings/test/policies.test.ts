import { describe, expect, it } from 'vitest';
import {
  isActiveOn,
  resolvePolicy,
  resolvePrice,
  type PolicySetVersion,
  type PriceListVersion,
} from '../src/policies';

const VENUE = 'venue-har-homa';
const OTHER_VENUE = 'venue-vert';
const GROUP = 'program-group';
const PRIVATE = 'program-private';

const v = (
  p: Partial<PolicySetVersion> & Pick<PolicySetVersion, 'id' | 'rules'>,
): PolicySetVersion => ({
  scopeType: 'org',
  venueId: null,
  programId: null,
  classTemplateId: null,
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  ...p,
});

describe('isActiveOn', () => {
  it('includes the start date and excludes the end date', () => {
    const r = { effectiveFrom: '2026-09-01', effectiveTo: '2027-01-01' };
    expect(isActiveOn(r, '2026-08-31')).toBe(false);
    expect(isActiveOn(r, '2026-09-01')).toBe(true);
    expect(isActiveOn(r, '2026-12-31')).toBe(true);
    expect(isActiveOn(r, '2027-01-01')).toBe(false);
    expect(isActiveOn({ effectiveFrom: '2026-09-01', effectiveTo: null }, '2099-01-01')).toBe(true);
  });
});

describe('resolvePolicy', () => {
  const versions: PolicySetVersion[] = [
    v({
      id: 'org-2026',
      rules: {
        absence: { notice_min_hours: 12 },
        makeup: { max_per_month: 1, self_booking: true },
      },
    }),
    v({
      id: 'org-2027',
      effectiveFrom: '2027-01-01',
      rules: { absence: { notice_min_hours: 24 } },
    }),
    v({
      id: 'venue',
      scopeType: 'venue',
      venueId: VENUE,
      rules: { venue: { extra_child_fee_agorot: 2000 } },
    }),
    v({
      id: 'other-venue',
      scopeType: 'venue',
      venueId: OTHER_VENUE,
      rules: { venue: { extra_child_fee_agorot: 0 } },
    }),
    v({
      id: 'private',
      scopeType: 'program',
      programId: PRIVATE,
      rules: { absence: { notice_min_hours: 24 }, makeup: { double_lesson_allowed: true } },
    }),
    v({
      id: 'venue-private',
      scopeType: 'venue_program',
      venueId: VENUE,
      programId: PRIVATE,
      rules: { makeup: { max_per_month: 2 } },
    }),
    v({
      id: 'template',
      scopeType: 'class_template',
      classTemplateId: 'tpl-1',
      rules: { calendar: { no_lessons_on: ['shabbat'] } },
    }),
    v({
      id: 'ended',
      scopeType: 'program',
      programId: GROUP,
      effectiveTo: '2026-06-01',
      rules: { makeup: { enabled: false } },
    }),
  ];

  it('uses only the org version for an org-wide question', () => {
    const r = resolvePolicy(versions, { date: '2026-10-01' });
    expect(r.rules).toEqual({
      absence: { notice_min_hours: 12 },
      makeup: { max_per_month: 1, self_booking: true },
    });
    expect(r.versionKey).toBe('org-2026');
  });

  it('picks the version in effect on the date', () => {
    expect(resolvePolicy(versions, { date: '2027-03-01' }).rules.absence).toEqual({
      notice_min_hours: 24,
    });
    expect(resolvePolicy(versions, { date: '2025-12-31' }).sources).toEqual([]);
  });

  it('merges org → venue → program → venue_program → class template, deep, and explains each leaf', () => {
    const r = resolvePolicy(versions, {
      date: '2026-10-01',
      venueId: VENUE,
      programId: PRIVATE,
      classTemplateId: 'tpl-1',
    });
    expect(r.rules).toEqual({
      absence: { notice_min_hours: 24 },
      makeup: { max_per_month: 2, self_booking: true, double_lesson_allowed: true },
      venue: { extra_child_fee_agorot: 2000 },
      calendar: { no_lessons_on: ['shabbat'] },
    });
    expect(r.sources.map((s) => s.scopeType)).toEqual([
      'org',
      'venue',
      'program',
      'venue_program',
      'class_template',
    ]);
    expect(r.versionKey).toBe('org-2026+venue+private+venue-private+template');
    expect(r.origin).toMatchObject({
      'absence.notice_min_hours': 'private',
      'makeup.max_per_month': 'venue-private',
      'makeup.self_booking': 'org-2026',
      'venue.extra_child_fee_agorot': 'venue',
      'calendar.no_lessons_on': 'template',
    });
  });

  it('ignores ended versions and other scopes’ ids', () => {
    const r = resolvePolicy(versions, {
      date: '2026-10-01',
      venueId: OTHER_VENUE,
      programId: GROUP,
    });
    expect(r.rules.makeup).toEqual({ max_per_month: 1, self_booking: true });
    expect(r.rules.venue).toEqual({ extra_child_fee_agorot: 0 });
  });

  it('replaces a scalar with an object and arrays wholesale', () => {
    const r = resolvePolicy(
      [
        v({ id: 'a', rules: { calendar: { no_lessons_on: ['shabbat', 'yom_tov'] } } }),
        v({
          id: 'b',
          scopeType: 'venue',
          venueId: VENUE,
          rules: { calendar: { no_lessons_on: [] } },
        }),
        // A malformed older row whose leaf is a scalar where the schema now has an object.
        v({ id: 'c', scopeType: 'program', programId: GROUP, rules: { trial: 'x' } as never }),
        v({
          id: 'd',
          scopeType: 'venue_program',
          venueId: VENUE,
          programId: GROUP,
          rules: { trial: { offset: { valid_days: 7 } } },
        }),
      ],
      { date: '2026-10-01', venueId: VENUE, programId: GROUP },
    );
    expect(r.rules.calendar?.no_lessons_on).toEqual([]);
    expect(r.rules.trial).toEqual({ offset: { valid_days: 7 } });
  });
});

describe('resolvePrice', () => {
  const item = (
    id: string,
    amountAgorot: number,
    extra: Partial<PriceListVersion['items'][number]> = {},
  ) => ({
    id,
    programId: GROUP,
    kind: 'monthly' as const,
    durationMin: null,
    sessionsCount: null,
    amountAgorot,
    ...extra,
  });
  const list = (
    p: Partial<PriceListVersion> & Pick<PriceListVersion, 'id' | 'items'>,
  ): PriceListVersion => ({
    name: p.id,
    venueId: null,
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
    status: 'published',
    ...p,
  });

  // The Phase 1 acceptance shape: Har Homa ₪330 from 1 Sep, ₪350 from 1 Jan.
  const lists = [
    list({
      id: 'org-sep',
      items: [item('org-group', 30000), item('org-trial', 5000, { kind: 'trial' })],
    }),
    list({ id: 'hh-sep', venueId: VENUE, items: [item('hh-group-sep', 33000)] }),
    list({
      id: 'hh-jan',
      venueId: VENUE,
      effectiveFrom: '2027-01-01',
      items: [item('hh-group-jan', 35000)],
    }),
    list({
      id: 'hh-draft',
      venueId: VENUE,
      effectiveFrom: '2026-10-01',
      status: 'draft',
      items: [item('d', 1)],
    }),
    list({
      id: 'private',
      items: [
        item('private-any', 16000, { programId: PRIVATE, kind: 'single' }),
        item('private-45', 22000, { programId: PRIVATE, kind: 'single', durationMin: 45 }),
        item('course-12', 100000, { kind: 'package', sessionsCount: 12 }),
      ],
    }),
    list({
      id: 'old-archived',
      venueId: OTHER_VENUE,
      effectiveFrom: '2025-09-01',
      effectiveTo: '2026-09-01',
      status: 'archived',
      items: [item('vert-old', 38000)],
    }),
  ];
  const at = (date: string, extra: Partial<Parameters<typeof resolvePrice>[1]> = {}) =>
    resolvePrice(lists, { date, venueId: VENUE, programId: GROUP, kind: 'monthly', ...extra });

  it('answers ₪330 in September and ₪350 in January at the venue', () => {
    expect(at('2026-09-15')).toMatchObject({
      amount: 33000,
      priceListId: 'hh-sep',
      scope: 'venue',
    });
    expect(at('2027-01-01')).toMatchObject({
      amount: 35000,
      priceListId: 'hh-jan',
      effectiveFrom: '2027-01-01',
    });
  });

  it('never uses drafts', () => {
    expect(at('2026-10-15')?.priceListId).toBe('hh-sep');
  });

  it('falls back to the org list when the venue list lacks the item', () => {
    expect(at('2026-09-15', { kind: 'trial' })).toMatchObject({
      amount: 5000,
      scope: 'org',
      itemId: 'org-trial',
    });
  });

  it('uses the org list at venues without their own', () => {
    expect(at('2026-09-15', { venueId: 'somewhere' })?.amount).toBe(30000);
    expect(at('2026-09-15', { venueId: null })?.amount).toBe(30000);
  });

  it('prefers the exact duration and falls back to any duration', () => {
    const p = (durationMin?: number) =>
      at('2026-09-15', { programId: PRIVATE, kind: 'single', durationMin })?.itemId;
    expect(p(45)).toBe('private-45');
    expect(p(30)).toBe('private-any');
    expect(p()).toBe('private-any');
  });

  it('matches packages by number of sessions', () => {
    expect(at('2026-09-15', { kind: 'package', sessionsCount: 12 })?.amount).toBe(100000);
    expect(at('2026-09-15', { kind: 'package', sessionsCount: 8 })).toBeNull();
  });

  it('answers from an archived list for the dates it was in effect', () => {
    expect(at('2026-03-01', { venueId: OTHER_VENUE })?.itemId).toBe('vert-old');
    expect(at('2026-03-01', { venueId: VENUE })).toBeNull(); // nothing at all was in effect then
  });
});
