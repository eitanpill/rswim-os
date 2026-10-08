import { describe, expect, it } from 'vitest';
import {
  absenceStreak,
  buildDigest,
  churnSignals,
  detectInsights,
  fingerprint,
  insightDigestItems,
  insightRulesFrom,
  reconcileInsights,
  type DigestFacts,
  type Insight,
  type InsightFacts,
  type InsightRules,
} from '../src/policies';

const rules: InsightRules = {
  lookbackDays: 28,
  emptyingDropSeats: 2,
  churnAbsences: 2,
  staffMaxWeeklyHours: 25,
  trialFollowupDays: 14,
  debtAttentionDays: 60,
  lowOccupancyPct: 40,
  waitlistClusterMin: 5,
};

const empty: InsightFacts = {
  asOf: '2026-10-08',
  groups: [],
  seats: [],
  leaving: [],
  debts: [],
  venues: [],
  waitlist: [],
  trials: [],
  uncovered: [],
  staff: [],
};

const seat = (
  household: string,
  marks: string[],
  extra: Partial<InsightFacts['seats'][number]> = {},
) => ({
  householdId: `h-${household}`,
  household,
  student: `ילד ${household}`,
  group: 'דולפין',
  marks,
  frozen: false,
  cancelRequested: false,
  ...extra,
});

describe('insightRulesFrom', () => {
  it('reads the insights policy over the defaults and borrows the digest thresholds', () => {
    expect(insightRulesFrom({})).toEqual({
      enabled: true,
      aiNotes: true,
      snoozeDays: 14,
      ...rules,
    });
    expect(
      insightRulesFrom({
        insights: { enabled: false, churn_absences: 3 },
        digest: { debt_attention_days: 30 },
      }),
    ).toMatchObject({ enabled: false, churnAbsences: 3, debtAttentionDays: 30 });
  });
});

describe('fingerprint and absenceStreak', () => {
  it('fingerprints a set regardless of order and repeats', () => {
    expect(fingerprint(['b', 'a', 'a'])).toBe(fingerprint(['a', 'b']));
    expect(fingerprint(['a', 'b'])).not.toBe(fingerprint(['a', 'c']));
    expect(fingerprint([])).toMatch(/^[0-9a-f]{8}$/);
  });

  it('counts absences in a row from the newest mark', () => {
    expect(absenceStreak(['absent', 'absent', 'present', 'absent'])).toBe(2);
    expect(absenceStreak(['present', 'absent'])).toBe(0);
    expect(absenceStreak(['absent', 'absent'])).toBe(2);
    expect(absenceStreak([])).toBe(0);
  });
});

describe('churnSignals', () => {
  it('scores absences, frozen places and old debts, and leaves out families already leaving', () => {
    const f: InsightFacts = {
      ...empty,
      seats: [
        seat('כהן', ['absent', 'absent', 'present']),
        seat('לוי', ['present', 'absent', 'absent', 'present'], { frozen: true }),
        seat('אבן', ['absent', 'present', 'present']),
        seat('בר', ['present'], { frozen: true }),
        seat('גל', ['absent', 'absent'], { cancelRequested: true }),
        seat('דן', ['absent', 'absent', 'absent'], { frozen: true }),
        seat('זך', ['present']),
      ],
      debts: [
        { householdId: 'h-בר', household: 'בר', balanceAgorot: 10_000, oldestDays: 90 },
        { householdId: 'h-זך', household: 'זך', balanceAgorot: 10_000, oldestDays: 10 },
      ],
    };
    const out = churnSignals(f, rules);
    expect(out.map((c) => [c.household, c.score])).toEqual([
      ['דן', 3],
      ['בר', 2],
      ['כהן', 2],
      ['לוי', 2],
    ]);
    expect(out.find((c) => c.household === 'בר')).toMatchObject({ debtDays: 90, frozen: true });
    expect(out.find((c) => c.household === 'לוי')).toMatchObject({
      absencesInARow: 0,
      recentAbsences: 2,
    });
  });
});

describe('detectInsights', () => {
  it('finds nothing in a quiet week', () => {
    expect(detectInsights(empty, rules)).toEqual([]);
  });

  it('flags groups that lost places, counting the ones leaving this month', () => {
    const out = detectInsights(
      {
        ...empty,
        groups: [
          {
            id: 'g1',
            name: 'כריש',
            venue: 'ירושלים',
            held: 6,
            heldBefore: 8,
            leavingSoon: 1,
            capacity: 10,
          },
          {
            id: 'g2',
            name: 'צפרדע',
            venue: 'גוש',
            held: 2,
            heldBefore: 6,
            leavingSoon: 3,
            capacity: 8,
          },
          {
            id: 'g3',
            name: 'דג',
            venue: 'גוש',
            held: 7,
            heldBefore: 8,
            leavingSoon: 0,
            capacity: 8,
          },
          {
            id: 'g4',
            name: 'ריק',
            venue: 'גוש',
            held: 0,
            heldBefore: 3,
            leavingSoon: 0,
            capacity: 0,
          },
        ],
      },
      rules,
    );
    expect(out.map((i) => [i.key, i.severity])).toEqual([
      ['group_emptying:g2', 'high'],
      ['group_emptying:g1', 'medium'],
    ]);
    expect(out[0]).toMatchObject({
      params: { group: 'צפרדע', before: 6, now: 0, capacity: 8, days: 28 },
      href: '/admin/groups/g2',
    });
    expect(out[1]?.params).toMatchObject({ before: 8, now: 5 });
  });

  it('lists families at risk once each, urgent from three', () => {
    const two = detectInsights(
      {
        ...empty,
        seats: [
          seat('כהן', ['absent', 'absent']),
          seat('כהן', ['absent', 'absent']),
          seat('לוי', ['absent', 'absent']),
        ],
      },
      rules,
    );
    expect(two).toHaveLength(1);
    expect(two[0]).toMatchObject({
      kind: 'churn_risk',
      severity: 'medium',
      params: { count: 2, names: 'כהן, לוי' },
    });
    expect(two[0]?.detail).toHaveLength(3);
    expect(two[0]?.detail[0]).not.toHaveProperty('householdId');
    const three = detectInsights(
      { ...empty, seats: ['א', 'ב', 'ג'].map((h) => seat(h, ['absent', 'absent'])) },
      rules,
    );
    expect(three[0]?.severity).toBe('high');
    expect(three[0]?.key).not.toBe(two[0]?.key);
  });

  it('covers leaving families, old debts, losing venues, waitlists, trials, lessons and instructors', () => {
    const out = detectInsights(
      {
        ...empty,
        leaving: [
          {
            householdId: 'h1',
            household: 'כהן',
            student: 'נועה',
            group: 'כריש',
            endsOn: '2026-11-01',
            reason: 'cost',
          },
          {
            householdId: 'h1',
            household: 'כהן',
            student: 'יואב',
            group: 'דג',
            endsOn: '2026-11-01',
            reason: null,
          },
        ],
        debts: [
          { householdId: 'a', household: 'א', balanceAgorot: 10_000, oldestDays: 70 },
          { householdId: 'b', household: 'ב', balanceAgorot: 30_000, oldestDays: 61 },
          { householdId: 'c', household: 'ג', balanceAgorot: 20_000, oldestDays: 60 },
          { householdId: 'd', household: 'ד', balanceAgorot: 90_000, oldestDays: 5 },
        ],
        venues: [
          { id: 'v1', name: 'גוש', period: '2026-09', margin: -50_000 },
          { id: 'v2', name: 'ירושלים', period: '2026-09', margin: 80_000 },
        ],
        waitlist: [
          { program: 'תינוקות', venue: null, weekday: null, count: 6 },
          { program: 'ילדים', venue: 'גוש', weekday: 2, count: 5 },
          { program: 'נוער', venue: 'גוש', weekday: 3, count: 1 },
        ],
        trials: [{ householdId: 'h9', household: 'מזרחי', student: 'דנה', date: '2026-10-01' }],
        uncovered: [
          { sessionId: 's2', date: '2026-10-12', group: 'כריש', venue: 'גוש' },
          { sessionId: 's1', date: '2026-10-09', group: 'דג', venue: 'גוש' },
          { sessionId: 's3', date: '2026-10-14', group: 'דג', venue: 'גוש' },
        ],
        staff: [
          { staffId: 'm1', name: 'רותם', hours: 27.5 },
          { staffId: 'm2', name: 'אורי', hours: 25 },
        ],
      },
      rules,
    );
    expect(out.map((i) => [i.kind, i.severity])).toEqual([
      ['old_debts', 'high'],
      ['venue_loss', 'high'],
      ['uncovered_lessons', 'high'],
      ['leaving', 'medium'],
      ['trial_followup', 'medium'],
      ['staff_overload', 'medium'],
      ['waitlist_cluster', 'low'],
      ['waitlist_cluster', 'low'],
    ]);
    const by = (k: string) => out.find((i) => i.kind === k) as Insight;
    expect(by('old_debts').params).toEqual({
      count: 3,
      amount: 60_000,
      days: 60,
      names: 'ב, ג, א',
    });
    expect(by('venue_loss')).toMatchObject({
      key: 'venue_loss:v1:2026-09',
      params: { amount: 50_000 },
    });
    expect(by('uncovered_lessons').params).toEqual({ count: 3, first: '2026-10-09' });
    expect(by('leaving').params).toEqual({ count: 1, names: 'כהן' });
    expect(by('trial_followup').params).toEqual({ count: 1, names: 'מזרחי', days: 14 });
    expect(by('staff_overload')).toMatchObject({
      params: { name: 'רותם', hours: 27.5, max: 25 },
      href: '/admin/staff/m1',
    });
    expect(out.filter((i) => i.kind === 'waitlist_cluster').map((i) => i.params)).toEqual([
      { program: 'תינוקות', venue: '', day: -1, count: 6 },
      { program: 'ילדים', venue: 'גוש', day: 2, count: 5 },
    ]);
    const two = detectInsights(
      { ...empty, debts: [{ householdId: 'a', household: 'א', balanceAgorot: 1, oldestDays: 90 }] },
      rules,
    );
    expect(two[0]?.severity).toBe('medium');
  });
});

describe('reconcileInsights', () => {
  const insight = (key: string, params: Insight['params'] = { n: 1 }): Insight => ({
    key,
    kind: 'churn_risk',
    severity: 'medium',
    params,
    detail: [],
    href: '/x',
  });
  const stored = (
    key: string,
    status: string,
    snoozedUntil: string | null = null,
    params: unknown = { n: 1 },
  ) => ({
    key,
    status,
    params,
    detail: [],
    snoozedUntil,
  });

  it('inserts new insights, keeps dismissals until their date, reopens and resolves', () => {
    const changes = reconcileInsights(
      [
        stored('snoozed', 'dismissed', '2026-10-20'),
        stored('back', 'dismissed', '2026-10-07'),
        stored('forever', 'dismissed', null),
        stored('again', 'resolved', null, { n: 2 }),
        stored('gone', 'open'),
        stored('old', 'resolved'),
        stored('hidden', 'dismissed', '2026-10-20'),
      ],
      [insight('new'), insight('snoozed'), insight('back'), insight('forever'), insight('again')],
      '2026-10-08',
    );
    expect(changes).toEqual([
      { op: 'insert', insight: insight('new') },
      { op: 'update', insight: insight('snoozed'), status: 'dismissed', clearNote: false },
      { op: 'update', insight: insight('back'), status: 'open', clearNote: false },
      { op: 'update', insight: insight('forever'), status: 'dismissed', clearNote: false },
      { op: 'update', insight: insight('again'), status: 'open', clearNote: true },
      { op: 'resolve', key: 'gone' },
    ]);
  });

  it('compares facts whatever their key order, and clears the note when the detail changes', () => {
    const [kept] = reconcileInsights(
      [{ ...stored('k', 'open', null, { b: [1, { y: 2, x: null }], a: 'x' }) }],
      [insight('k', { a: 'x', b: [1, { x: null, y: 2 }] } as unknown as Insight['params'])],
      '2026-10-08',
    );
    expect(kept).toMatchObject({ clearNote: false });
    const [c] = reconcileInsights(
      [{ ...stored('k', 'open'), detail: [{ a: 1 }] }],
      [insight('k')],
      '2026-10-08',
    );
    expect(c).toMatchObject({ op: 'update', clearNote: true });
  });
});

describe('insights in the digest', () => {
  const insights = detectInsights(
    {
      ...empty,
      seats: [seat('כהן', ['absent', 'absent'])],
      debts: [{ householdId: 'a', household: 'א', balanceAgorot: 1, oldestDays: 90 }],
      waitlist: [{ program: 'תינוקות', venue: null, weekday: null, count: 6 }],
      staff: [{ staffId: 'm1', name: 'רותם', hours: 30 }],
    },
    rules,
  );

  it('adds the kinds the digest does not cover itself', () => {
    expect(insightDigestItems(insights)).toEqual([
      {
        section: 'attention',
        code: 'insights.kinds.churn_risk.title',
        params: { count: 1, names: 'כהן' },
      },
      {
        section: 'attention',
        code: 'insights.kinds.staff_overload.title',
        params: { name: 'רותם', hours: 30, max: 25 },
      },
    ]);
    const low = insightDigestItems([{ ...(insights[0] as Insight), severity: 'low' }]);
    expect(low[0]?.section).toBe('suggestion');
  });

  it('lets insight items replace the all-clear line', () => {
    const facts: DigestFacts = {
      weekOf: '2026-10-04',
      newPlaces: 0,
      endedPlaces: 0,
      trialsHeld: 0,
      trialsEnrolled: 0,
      collectedAgorot: 0,
      lessonsCancelled: 0,
      groups: [],
      waitlist: [],
      venues: [],
      debts: [],
    };
    const digest = {
      highOccupancyPct: 90,
      lowOccupancyPct: 40,
      debtAttentionDays: 60,
      waitlistClusterMin: 5,
    };
    expect(buildDigest(facts, digest).at(-1)?.code).toBe('reports.digest.items.allClear');
    const items = buildDigest(facts, digest, insightDigestItems(insights));
    expect(items.some((i) => i.code.endsWith('allClear'))).toBe(false);
    expect(items.at(-1)?.code).toBe('insights.kinds.staff_overload.title');
  });
});
