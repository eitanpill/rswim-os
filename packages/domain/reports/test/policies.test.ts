import { describe, expect, it } from 'vitest';
import {
  addMonths,
  buildDigest,
  churnTable,
  csvCell,
  digestRulesFrom,
  funnel,
  heatLevel,
  heatmap,
  median,
  monthRange,
  monthsBetween,
  occupancyPct,
  rentForMonth,
  retention,
  shekelsOf,
  toCsv,
  venueMargin,
  type DigestFacts,
  type FamilyFunnelFacts,
  type RentContract,
} from '../src/policies';

describe('months', () => {
  it('spans a month and lists the months between two periods', () => {
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthsBetween('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(monthsBetween('2026-05', '2026-04')).toEqual([]);
  });
  it('adds whole months, clamped to the month end', () => {
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-01-15', 3)).toBe('2026-04-15');
  });
});

describe('rentForMonth', () => {
  const usage = { hours: 10.5, laneHours: 21 };
  const c = (over: Partial<RentContract>): RentContract => ({
    rentModel: 'fixed_monthly',
    amountAgorot: 450_000,
    startsOn: '2026-09-01',
    endsOn: '2026-12-31',
    ...over,
  });
  it('charges a fixed month while the contract runs, and nothing outside it', () => {
    expect(rentForMonth(c({}), '2026-10', usage)).toBe(450_000);
    expect(rentForMonth(c({}), '2026-08', usage)).toBe(0);
    expect(rentForMonth(c({}), '2027-01', usage)).toBe(0);
    expect(rentForMonth(c({ startsOn: null, endsOn: null }), '2030-01', usage)).toBe(450_000);
  });
  it('multiplies a rate by the hours or lane-hours used', () => {
    expect(rentForMonth(c({ rentModel: 'per_hour', amountAgorot: 15_000 }), '2026-10', usage)).toBe(
      157_500,
    );
    expect(
      rentForMonth(c({ rentModel: 'per_lane_hour', amountAgorot: 4_000 }), '2026-10', usage),
    ).toBe(84_000);
  });
  it('does not guess a revenue share, and a contract with no rent costs nothing', () => {
    expect(rentForMonth(c({ rentModel: 'revenue_share' }), '2026-10', usage)).toBeNull();
    expect(rentForMonth(c({ rentModel: 'none' }), '2026-10', usage)).toBe(0);
  });
});

describe('venueMargin', () => {
  it('adds family and institution revenue against rent and staff', () => {
    expect(
      venueMargin({
        familyRevenue: 800_000,
        institutionRevenue: 200_000,
        rent: 450_000,
        staffCost: 300_000,
        seatsHeld: 30,
        capacity: 40,
      }),
    ).toEqual({
      revenue: 1_000_000,
      cost: 750_000,
      margin: 250_000,
      marginPct: 25,
      utilizationPct: 75,
      rentUnknown: false,
    });
  });
  it('flags an unknown rent and has no percentage without revenue', () => {
    expect(
      venueMargin({
        familyRevenue: 0,
        institutionRevenue: 0,
        rent: null,
        staffCost: 10_000,
        seatsHeld: 0,
        capacity: 0,
      }),
    ).toMatchObject({ margin: -10_000, marginPct: null, utilizationPct: null, rentUnknown: true });
  });
});

describe('occupancy', () => {
  const rules = { highPct: 90, lowPct: 40 };
  it('colours cells by how full they are', () => {
    expect(occupancyPct(3, 8)).toBe(38);
    expect(heatLevel(null, rules)).toBe('none');
    expect(heatLevel(100, rules)).toBe('full');
    expect(heatLevel(92, rules)).toBe('high');
    expect(heatLevel(39, rules)).toBe('low');
    expect(heatLevel(60, rules)).toBe('mid');
  });
  it('sums groups into venue × day × hour cells in order', () => {
    const cells = heatmap([
      { venueId: 'b', weekday: 1, startsAt: '16:00', held: 4, capacity: 8 },
      { venueId: 'a', weekday: 2, startsAt: '17:30', held: 5, capacity: 6 },
      { venueId: 'a', weekday: 2, startsAt: '17:00', held: 3, capacity: 6 },
      { venueId: 'a', weekday: 0, startsAt: '09:00', held: 0, capacity: 0 },
      { venueId: 'a', weekday: 2, startsAt: '16:15', held: 1, capacity: 4 },
    ]);
    expect(
      cells.map((c) => [c.venueId, c.weekday, c.hour, c.held, c.capacity, c.groups, c.pct]),
    ).toEqual([
      ['a', 0, 9, 0, 0, 1, null],
      ['a', 2, 16, 1, 4, 1, 25],
      ['a', 2, 17, 8, 12, 2, 67],
      ['b', 1, 16, 4, 8, 1, 50],
    ]);
  });
  it('orders venues either way round', () => {
    const cells = heatmap([
      { venueId: 'a', weekday: 1, startsAt: '16:00', held: 1, capacity: 2 },
      { venueId: 'b', weekday: 1, startsAt: '16:00', held: 1, capacity: 2 },
    ]);
    expect(cells.map((c) => c.venueId)).toEqual(['a', 'b']);
  });
});

describe('churnTable', () => {
  it('counts ended places per month and reason, unknown when none was recorded', () => {
    const { rows, totals } = churnTable(
      [
        { period: '2026-09', reason: 'cold_water' },
        { period: '2026-09', reason: 'cold_water' },
        { period: '2026-10', reason: null },
        { period: '2026-10', reason: 'not-a-reason' },
        { period: '2026-10', reason: 'cost' },
        { period: '2026-12', reason: 'cost' },
      ],
      ['2026-09', '2026-10', '2026-11'],
    );
    expect(rows.map((r) => [r.period, r.total])).toEqual([
      ['2026-09', 2],
      ['2026-10', 3],
      ['2026-11', 0],
    ]);
    expect(rows[1]?.byReason).toMatchObject({ unknown: 2, cost: 1, cold_water: 0 });
    expect(totals).toMatchObject({ total: 5, byReason: { cold_water: 2, unknown: 2, cost: 1 } });
  });
});

describe('funnel', () => {
  const f = (over: Partial<FamilyFunnelFacts>): FamilyFunnelFacts => ({
    source: 'ghl',
    branch: 'גוש',
    createdOn: '2026-09-01',
    trialBookedOn: null,
    trialHeldOn: null,
    enrolledOn: null,
    ...over,
  });
  const rows = [
    f({ trialBookedOn: '2026-09-02', trialHeldOn: '2026-09-05', enrolledOn: '2026-09-11' }),
    f({ trialBookedOn: '2026-09-02', trialHeldOn: '2026-09-05', enrolledOn: '2026-09-21' }),
    f({ trialBookedOn: '2026-09-03', trialHeldOn: '2026-09-06' }),
    f({ source: 'office', branch: null }),
    f({ source: 'office', branch: 'ירושלים', enrolledOn: '2026-09-04' }),
  ];
  it('counts each stage with conversion and the median days to enroll', () => {
    const out = funnel(rows, 'source');
    expect(out.total).toEqual({
      key: 'total',
      families: 5,
      trialBooked: 3,
      trialHeld: 3,
      enrolled: 3,
      conversionPct: 60,
      trialConversionPct: 67,
      medianDaysToEnroll: 10,
    });
    expect(out.rows.map((r) => [r.key, r.families, r.medianDaysToEnroll])).toEqual([
      ['ghl', 3, 15],
      ['office', 2, 3],
    ]);
    expect(out.rows[1]?.trialConversionPct).toBeNull();
  });
  it('splits by branch, families with none yet under "none", ties by name', () => {
    expect(funnel(rows, 'branch').rows.map((r) => r.key)).toEqual(['גוש', 'none', 'ירושלים']);
    expect(
      funnel([f({ source: 'z' }), f({ source: 'a' })], 'source').rows.map((r) => r.key),
    ).toEqual(['a', 'z']);
    expect(funnel([], 'branch')).toMatchObject({
      total: { conversionPct: null, medianDaysToEnroll: null },
      rows: [],
    });
  });
  it('takes the middle value', () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});

describe('retention', () => {
  it('keeps children who stayed past the mark, of those who started early enough', () => {
    expect(
      retention(
        [
          { startsOn: '2026-01-01', endsOn: null },
          { startsOn: '2026-01-01', endsOn: '2026-03-01' },
          { startsOn: '2026-02-01', endsOn: '2026-06-01' },
          { startsOn: '2026-09-01', endsOn: null },
        ],
        '2026-10-01',
        3,
      ),
    ).toEqual({ eligible: 3, kept: 2, pct: 67 });
    expect(retention([], '2026-10-01', 3)).toEqual({ eligible: 0, kept: 0, pct: null });
  });
});

describe('csv', () => {
  it('quotes, defuses formulas and starts with a byte-order mark', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('כהן, "דמו"')).toBe('"כהן, ""דמו"""');
    expect(toCsv(['שם', 'סכום'], [['גוש', shekelsOf(450_000)]])).toBe(
      '\uFEFFשם,סכום\r\nגוש,4500\r\n',
    );
  });
});

describe('buildDigest', () => {
  const rules = {
    highOccupancyPct: 90,
    lowOccupancyPct: 40,
    debtAttentionDays: 60,
    waitlistClusterMin: 3,
  };
  const facts: DigestFacts = {
    weekOf: '2026-10-04',
    newPlaces: 4,
    endedPlaces: 1,
    trialsHeld: 3,
    trialsEnrolled: 2,
    collectedAgorot: 1_250_000,
    lessonsCancelled: 2,
    groups: [
      { name: 'מלאה', venue: 'גוש', held: 8, capacity: 8 },
      { name: 'ריקה', venue: 'גוש', held: 1, capacity: 8 },
      { name: 'בינונית', venue: 'ירושלים', held: 5, capacity: 8 },
      { name: 'בלי מקומות', venue: 'ירושלים', held: 0, capacity: 0 },
    ],
    waitlist: [
      { program: 'תינוקות', venue: 'ירושלים', weekday: 1, count: 4 },
      { program: 'מבוגרים', venue: null, weekday: null, count: 3 },
      { program: 'נוער', venue: 'גוש', weekday: 2, count: 1 },
    ],
    venues: [
      { name: 'גוש', period: '2026-09', margin: -120_000, rentUnknown: false },
      { name: 'ירושלים', period: '2026-09', margin: 300_000, rentUnknown: false },
    ],
    debts: [
      { household: 'כהן', balanceAgorot: 50_000, oldestDays: 90 },
      { household: 'לוי', balanceAgorot: 80_000, oldestDays: 61 },
      { household: 'מזרחי', balanceAgorot: 99_000, oldestDays: 10 },
    ],
  };
  it('reports the week, flags losses, old debts and empty groups, and suggests', () => {
    const items = buildDigest(facts, rules);
    expect(items.map((i) => `${i.section}:${i.code.split('.').at(-1)}`)).toEqual([
      'happened:places',
      'happened:trials',
      'happened:collected',
      'happened:cancelled',
      'attention:venueLoss',
      'attention:oldDebts',
      'suggestion:raisePrice',
      'attention:lowGroup',
      'suggestion:openGroup',
      'suggestion:openGroup',
    ]);
    expect(items.find((i) => i.code.endsWith('oldDebts'))?.params).toEqual({
      count: 2,
      amount: 130_000,
      days: 60,
      top: 'לוי, כהן',
    });
    expect(items.find((i) => i.code.endsWith('venueLoss'))?.params).toMatchObject({
      amount: 120_000,
    });
    expect(items.filter((i) => i.code.endsWith('openGroup')).map((i) => i.params)).toEqual([
      { program: 'תינוקות', venue: 'ירושלים', day: 1, count: 4 },
      { program: 'מבוגרים', venue: '', day: -1, count: 3 },
    ]);
  });
  it('reads its thresholds from the policy, defaults filling the gaps', () => {
    expect(
      digestRulesFrom({
        digest: { high_occupancy_pct: 85 },
        scheduling: { open_group_min_waiting: 4 },
      }),
    ).toEqual({
      enabled: true,
      highOccupancyPct: 85,
      lowOccupancyPct: 40,
      debtAttentionDays: 60,
      waitlistClusterMin: 4,
    });
    expect(digestRulesFrom({}).waitlistClusterMin).toBe(5);
  });
  it('says all is clear when nothing needs attention', () => {
    const items = buildDigest(
      { ...facts, lessonsCancelled: 0, groups: [], waitlist: [], venues: [], debts: [] },
      rules,
    );
    expect(items.map((i) => i.code.split('.').at(-1))).toEqual([
      'places',
      'trials',
      'collected',
      'allClear',
    ]);
  });
});
