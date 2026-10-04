import { describe, expect, it } from 'vitest';
import { DEFAULT_CALENDAR_POLICY, type CalendarPolicy } from '@rswim/calendar';
import {
  ageBand,
  ageInMonths,
  calendarPolicyFrom,
  checkInstructor,
  checkPlacement,
  checkTemplate,
  datesOverlap,
  fromMinutes,
  planSessions,
  planShiftChange,
  schedulingRulesFrom,
  scorePlacement,
  rankSubstitutes,
  staffingGaps,
  staffingRulesFrom,
  substituteExclusion,
  toMinutes,
  waitlistClusters,
  windowFor,
  windowGender,
  type InstructorFacts,
  type OtherTemplate,
  type PlacementGroup,
  type PlacementStudent,
  type ScoreInput,
  type SubstituteCandidate,
  type TemplateDraft,
  type WindowRow,
} from '../src/policies';

// Fixtures follow 5787 (autumn 2026). Sukkot I = Sat 26 Sep 2026, Chol HaMoed 27 Sep → 2 Oct, Shmini Atzeret 3 Oct.
const fixed =
  (calendar: CalendarPolicy = DEFAULT_CALENDAR_POLICY, versionKey = 'org-v1') =>
  () => ({
    calendar,
    versionKey,
  });

describe('helpers', () => {
  it('converts times and checks date overlap', () => {
    expect(toMinutes('16:30')).toBe(990);
    expect(toMinutes('16:30:00')).toBe(990);
    expect(fromMinutes(990)).toBe('16:30');
    expect(fromMinutes(65)).toBe('01:05');
    const a = { effectiveFrom: '2026-09-01', effectiveTo: null };
    expect(datesOverlap(a, { effectiveFrom: '2027-01-01', effectiveTo: null })).toBe(true);
    expect(datesOverlap(a, { effectiveFrom: '2026-01-01', effectiveTo: '2026-09-01' })).toBe(false);
  });

  it('counts whole months of age', () => {
    expect(ageInMonths('2020-05-15', '2026-05-15')).toBe(72);
    expect(ageInMonths('2020-05-15', '2026-05-14')).toBe(71);
    expect(ageInMonths('2020-05-15', '2026-09-01')).toBe(75);
  });

  it('reads policy sections with defaults', () => {
    expect(calendarPolicyFrom({})).toEqual(DEFAULT_CALENDAR_POLICY);
    expect(
      calendarPolicyFrom({ calendar: { chol_hamoed: 'run', no_lessons_on: ['shabbat'] } }),
    ).toEqual({
      cholHaMoed: 'run',
      noLessonsOn: ['shabbat'],
    });
    expect(schedulingRulesFrom({})).toEqual({
      travelBufferMin: 30,
      windowInstructorGender: 'match_window',
    });
    expect(
      schedulingRulesFrom({
        scheduling: { travel_buffer_min: 10, window_instructor_gender: 'any_gender' },
      }),
    ).toEqual({ travelBufferMin: 10, windowInstructorGender: 'any_gender' });
    expect(staffingRulesFrom({})).toEqual({
      requiresAcceptance: true,
      escalateAfterHours: 12,
      substituteWaveSize: 3,
      substituteWaveMinutes: 30,
    });
    expect(
      staffingRulesFrom({
        staffing: {
          shift_change_requires_acceptance: false,
          shift_change_escalate_after_hours: 4,
          substitute_wave_size: 2,
          substitute_wave_minutes: 15,
        },
      }),
    ).toEqual({
      requiresAcceptance: false,
      escalateAfterHours: 4,
      substituteWaveSize: 2,
      substituteWaveMinutes: 15,
    });
  });

  it('maps windows to the gender they require', () => {
    expect(windowGender('girls')).toBe('female');
    expect(windowGender('women')).toBe('female');
    expect(windowGender('boys')).toBe('male');
    expect(windowGender('mixed')).toBeNull();
  });
});

describe('planSessions', () => {
  const group = { weekday: 1, venueId: 'v1', effectiveFrom: '2026-09-01', effectiveTo: null }; // Monday
  const term = { startsOn: '2026-09-01', endsOn: '2026-10-31' };

  it('skips Chol HaMoed, Yom Tov and Erev Chag with their reasons', () => {
    const { sessions, skipped } = planSessions(group, term, fixed(), [], []);
    const dates = sessions.map((s) => s.date);
    // Mondays: 7, 14, 21 (Yom Kippur), 28 (Chol HaMoed) Sep; 5, 12, 19, 26 Oct.
    expect(dates).toEqual([
      '2026-09-07',
      '2026-09-14',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    expect(skipped.map((s) => [s.date, s.reasons])).toEqual([
      ['2026-09-21', ['yom_tov', 'yom_kippur']],
      ['2026-09-28', ['chol_hamoed']],
    ]);
    expect(skipped[1]?.details.join(' ')).toMatch(/סוכות/);
    expect(sessions[0]?.policyVersionKey).toBe('org-v1');
  });

  it('runs on Chol HaMoed when the policy says so (camps)', () => {
    const camp = { ...DEFAULT_CALENDAR_POLICY, cholHaMoed: 'run' as const };
    const { sessions } = planSessions(group, term, fixed(camp), [], []);
    expect(sessions.map((s) => s.date)).toContain('2026-09-28');
  });

  it('skips erev chag (Friday before is Shabbat anyway; Sunday 13 Sep is Erev Rosh Hashana… 5787 RH is Sat 12 Sep)', () => {
    const sunday = { ...group, weekday: 0 };
    const { skipped } = planSessions(
      sunday,
      { startsOn: '2026-09-01', endsOn: '2026-10-10' },
      fixed(),
      [],
      [],
    );
    // Sun 13 Sep = Rosh Hashana II (yom tov); Sun 20 Sep = Erev Yom Kippur; Sun 27 Sep = Chol HaMoed.
    expect(skipped.map((s) => [s.date, s.reasons[0]])).toEqual([
      ['2026-09-13', 'yom_tov'],
      ['2026-09-20', 'erev_chag'],
      ['2026-09-27', 'chol_hamoed'],
    ]);
  });

  it('respects closures, overrides (venue-specific first) and the group dates', () => {
    const closures = [
      { venueId: 'v1', startsOn: '2026-10-11', endsOn: '2026-10-13', reason: 'שיפוץ' },
    ];
    const overrides = [
      { date: '2026-10-19', kind: 'closed' as const, venueId: null, reason: 'יום ספורט' },
      { date: '2026-10-26', kind: 'closed' as const, venueId: null, reason: 'כללי' },
      { date: '2026-10-26', kind: 'open' as const, venueId: 'v1', reason: 'פתוח אצלנו' },
      { date: '2026-10-05', kind: 'closed' as const, venueId: 'other', reason: 'לא שלנו' },
      // An "open" override does not reopen a closed pool.
      { date: '2026-10-12', kind: 'open' as const, venueId: 'v1', reason: 'x' },
    ];
    const late = { ...group, effectiveFrom: '2026-09-10', effectiveTo: '2026-10-27' };
    const { sessions, skipped } = planSessions(late, term, fixed(), closures, overrides);
    expect(sessions.map((s) => s.date)).toEqual(['2026-09-14', '2026-10-05', '2026-10-26']);
    expect(skipped.map((s) => [s.date, s.reasons, s.details])).toEqual([
      ['2026-09-07', ['before_group_start'], []],
      ['2026-09-21', ['yom_tov', 'yom_kippur'], ['יום כיפור']],
      ['2026-09-28', ['chol_hamoed'], expect.any(Array)],
      ['2026-10-12', ['venue_closure'], ['שיפוץ']],
      ['2026-10-19', ['override_closed'], ['יום ספורט']],
    ]);
    const ended = planSessions({ ...group, effectiveTo: '2026-10-20' }, term, fixed(), [], []);
    expect(ended.skipped.at(-1)).toEqual({
      date: '2026-10-26',
      reasons: ['after_group_end'],
      details: [],
      policyVersionKey: 'org-v1',
    });
  });

  it('resolves the policy per date', () => {
    const policyFor = (date: string) =>
      date < '2026-09-25'
        ? { calendar: DEFAULT_CALENDAR_POLICY, versionKey: 'a' }
        : { calendar: { ...DEFAULT_CALENDAR_POLICY, cholHaMoed: 'run' as const }, versionKey: 'b' };
    const { sessions } = planSessions(group, term, policyFor, [], []);
    expect(sessions.find((s) => s.date === '2026-09-28')?.policyVersionKey).toBe('b');
    expect(sessions[0]?.policyVersionKey).toBe('a');
  });
});

describe('checkPlacement', () => {
  const girl: PlacementStudent = {
    id: 's1',
    firstName: 'נועה',
    gender: 'female',
    dob: '2019-03-01',
    levelOrdinal: 2,
    requiresFemaleInstructor: false,
  };
  const boysGroup: PlacementGroup = {
    id: 'g1',
    name: 'בנים מתחילים',
    weekday: 3,
    startsAt: '16:00',
    durationMin: 45,
    capacity: 6,
    admittedGender: 'mixed',
    ageMinMonths: null,
    ageMaxMonths: null,
    levelMinOrdinal: null,
    levelMaxOrdinal: null,
    windowRestriction: 'boys',
    leadGender: 'male',
    memberIds: ['a', 'b'],
  };

  it('blocks a girl from a boys-only window, naming the window and the child', () => {
    const d = checkPlacement(girl, boysGroup, '2026-09-01');
    expect(d.ok).toBe(false);
    expect(d.violations).toEqual([
      {
        code: 'scheduling.rules.windowGender',
        params: { name: 'נועה', window: 'boys', gender: 'female' },
      },
    ]);
  });

  it('admits a girl to a women and girls window, but not a woman to a girls-only one', () => {
    expect(
      checkPlacement(girl, { ...boysGroup, windowRestriction: 'female' }, '2026-09-01').ok,
    ).toBe(true);
    const woman = { ...girl, dob: '1990-01-01' };
    expect(
      checkPlacement(woman, { ...boysGroup, windowRestriction: 'girls' }, '2026-09-01')
        .violations[0]?.code,
    ).toBe('scheduling.rules.windowGender');
    expect(
      checkPlacement(woman, { ...boysGroup, windowRestriction: 'women' }, '2026-09-01').ok,
    ).toBe(true);
    // Unknown date of birth counts as a child for the window.
    const noDob = { ...girl, dob: null };
    expect(
      checkPlacement(noDob, { ...boysGroup, windowRestriction: 'girls' }, '2026-09-01').ok,
    ).toBe(true);
  });

  it('refuses unknown gender in a gendered window, and checks the group gender', () => {
    const unknown = { ...girl, gender: null };
    expect(checkPlacement(unknown, boysGroup, '2026-09-01').violations.map((v) => v.code)).toEqual([
      'scheduling.rules.genderUnknown',
    ]);
    const mixedWindow = {
      ...boysGroup,
      windowRestriction: 'mixed' as const,
      admittedGender: 'male' as const,
    };
    expect(checkPlacement(girl, mixedWindow, '2026-09-01').violations).toEqual([
      {
        code: 'scheduling.rules.groupGender',
        params: { name: 'נועה', admitted: 'male', gender: 'female' },
      },
    ]);
    expect(checkPlacement(unknown, mixedWindow, '2026-09-01').violations[0]?.params.gender).toBe(
      'unknown',
    );
    expect(
      checkPlacement(
        unknown,
        { ...mixedWindow, admittedGender: 'mixed', windowRestriction: null },
        '2026-09-01',
      ).ok,
    ).toBe(true);
  });

  const open: PlacementGroup = { ...boysGroup, windowRestriction: 'mixed', leadGender: 'female' };

  it('stops at an existing membership and a full group', () => {
    expect(
      checkPlacement(girl, { ...open, memberIds: ['s1'] }, '2026-09-01').violations[0]?.code,
    ).toBe('scheduling.rules.alreadyInGroup');
    const full = checkPlacement(girl, { ...open, capacity: 2 }, '2026-09-01');
    expect(full.violations).toEqual([{ code: 'scheduling.rules.full', params: { capacity: 2 } }]);
    const last = checkPlacement(girl, { ...open, capacity: 3 }, '2026-09-01');
    expect(last.ok).toBe(true);
    expect(last.warnings).toEqual([{ code: 'scheduling.rules.lastSeat', params: {} }]);
  });

  it('checks the age band and warns when the age is unknown', () => {
    // 2019-03-01 → 90 months on 2026-09-01.
    expect(checkPlacement(girl, { ...open, ageMinMonths: 96 }, '2026-09-01').violations[0]).toEqual(
      {
        code: 'scheduling.rules.tooYoung',
        params: { name: 'נועה', months: 90, min: 96 },
      },
    );
    expect(
      checkPlacement(girl, { ...open, ageMaxMonths: 72 }, '2026-09-01').violations[0]?.code,
    ).toBe('scheduling.rules.tooOld');
    expect(
      checkPlacement(girl, { ...open, ageMinMonths: 60, ageMaxMonths: 96 }, '2026-09-01').ok,
    ).toBe(true);
    expect(checkPlacement(girl, { ...open, ageMaxMonths: 96 }, '2026-09-01').ok).toBe(true);
    const d = checkPlacement({ ...girl, dob: null }, { ...open, ageMinMonths: 60 }, '2026-09-01');
    expect(d.ok).toBe(true);
    expect(d.warnings[0]?.code).toBe('scheduling.rules.ageUnknown');
  });

  it('checks the level range', () => {
    expect(
      checkPlacement(girl, { ...open, levelMinOrdinal: 3 }, '2026-09-01').violations[0]?.code,
    ).toBe('scheduling.rules.levelBelow');
    expect(
      checkPlacement(girl, { ...open, levelMaxOrdinal: 1 }, '2026-09-01').violations[0]?.code,
    ).toBe('scheduling.rules.levelAbove');
    expect(checkPlacement(girl, { ...open, levelMaxOrdinal: 2 }, '2026-09-01').ok).toBe(true);
    expect(checkPlacement(girl, { ...open, levelMinOrdinal: 1 }, '2026-09-01').ok).toBe(true);
    expect(
      checkPlacement({ ...girl, levelOrdinal: null }, { ...open, levelMinOrdinal: 1 }, '2026-09-01')
        .warnings[0]?.code,
    ).toBe('scheduling.rules.levelUnknown');
  });

  it('refuses a time clash with another of the child’s groups, ignoring the group itself', () => {
    const other = { id: 'g2', name: 'קבוצה אחרת', weekday: 3, startsAt: '16:30', durationMin: 45 };
    expect(checkPlacement(girl, open, '2026-09-01', [other]).violations).toEqual([
      { code: 'scheduling.rules.timeClash', params: { name: 'נועה', group: 'קבוצה אחרת' } },
    ]);
    expect(checkPlacement(girl, open, '2026-09-01', [{ ...other, id: 'g1' }]).ok).toBe(true);
    expect(checkPlacement(girl, open, '2026-09-01', [{ ...other, startsAt: '16:45' }]).ok).toBe(
      true,
    );
    expect(checkPlacement(girl, open, '2026-09-01', [{ ...other, weekday: 2 }]).ok).toBe(true);
  });

  it('requires a female instructor when the family asks for one', () => {
    const religious = { ...girl, requiresFemaleInstructor: true };
    expect(
      checkPlacement(religious, { ...open, leadGender: 'male' }, '2026-09-01').violations[0]?.code,
    ).toBe('scheduling.rules.femaleInstructorRequired');
    expect(
      checkPlacement(religious, { ...open, leadGender: null }, '2026-09-01').warnings[0]?.code,
    ).toBe('scheduling.rules.instructorUnknown');
    expect(checkPlacement(religious, open, '2026-09-01').ok).toBe(true);
  });
});

describe('checkTemplate and checkInstructor', () => {
  const lanes = ['l1', 'l2', 'l3', 'l4'];
  const windows: WindowRow[] = [
    {
      id: 'w-girls',
      poolId: 'p1',
      weekday: 1,
      startsAt: '16:00',
      endsAt: '19:00',
      genderRestriction: 'female',
      effectiveFrom: '2026-09-01',
      effectiveTo: null,
      laneIds: lanes,
    },
    {
      id: 'w-mixed',
      poolId: 'p1',
      weekday: 0,
      startsAt: '15:00',
      endsAt: '18:00',
      genderRestriction: 'mixed',
      effectiveFrom: '2026-09-01',
      effectiveTo: '2027-01-01',
      laneIds: ['l1', 'l2'],
    },
  ];
  const draft: TemplateDraft = {
    venueId: 'v1',
    poolId: 'p1',
    weekday: 1,
    startsAt: '16:00',
    durationMin: 45,
    laneIds: ['l1'],
    admittedGender: 'female',
    ageMinMonths: 60,
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
    requiredInstructorGender: null,
    requiredSkills: [],
    leadStaffId: 'i1',
  };
  const dana: InstructorFacts = {
    id: 'i1',
    name: 'דנה',
    gender: 'female',
    status: 'active',
    skills: ['water_fear'],
    availability: [
      {
        weekday: 1,
        startsAt: '15:00',
        endsAt: '20:00',
        venueId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
      {
        weekday: 0,
        startsAt: '14:00',
        endsAt: '20:00',
        venueId: 'v1',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
    exceptions: [],
  };
  const rules = { travelBufferMin: 30, windowInstructorGender: 'match_window' as const };

  it('accepts a girls group inside the women and girls window with a female instructor', () => {
    const d = checkTemplate(draft, windows, [], dana, rules);
    expect(d).toMatchObject({ ok: true, violations: [], warnings: [] });
    expect(d.window?.id).toBe('w-girls');
  });

  it('needs a window that holds the whole group on its lanes, in effect at its start', () => {
    expect(windowFor({ ...draft, startsAt: '18:30' }, windows)).toBeNull();
    expect(windowFor({ ...draft, startsAt: '15:30' }, windows)).toBeNull();
    expect(windowFor({ ...draft, weekday: 0, laneIds: ['l3'] }, windows)).toBeNull();
    expect(windowFor({ ...draft, effectiveFrom: '2026-08-01' }, windows)).toBeNull();
    expect(windowFor({ ...draft, poolId: 'p2' }, windows)).toBeNull();
    const out = checkTemplate(
      { ...draft, startsAt: '19:00', laneIds: [] },
      windows,
      [],
      null,
      rules,
    );
    expect(out.violations.map((v) => v.code)).toEqual([
      'scheduling.rules.noLanes',
      'scheduling.rules.outsideWindow',
    ]);
  });

  it('refuses a group whose admitted gender the window does not allow, and warns when the window ends first', () => {
    const boys = checkTemplate({ ...draft, admittedGender: 'male' }, windows, [], null, rules);
    expect(boys.violations).toEqual([
      { code: 'scheduling.rules.windowAdmits', params: { window: 'female', admitted: 'male' } },
    ]);
    const sunday = { ...draft, weekday: 0, admittedGender: 'mixed' as const };
    expect(checkTemplate(sunday, windows, [], null, rules).warnings).toEqual([
      { code: 'scheduling.rules.windowEnds', params: { date: '2027-01-01' } },
    ]);
    expect(
      checkTemplate({ ...sunday, effectiveTo: '2026-12-01' }, windows, [], null, rules).warnings,
    ).toEqual([]);
  });

  const other: OtherTemplate = {
    id: 'g2',
    name: 'בנות ב',
    venueId: 'v1',
    poolId: 'p1',
    weekday: 1,
    startsAt: '16:30',
    durationMin: 45,
    laneIds: ['l1', 'l2'],
    effectiveFrom: '2026-09-01',
    effectiveTo: null,
    leadStaffId: 'i2',
  };

  it('refuses a lane another group uses at the same time', () => {
    expect(checkTemplate(draft, windows, [other], null, rules).violations).toEqual([
      { code: 'scheduling.rules.laneTaken', params: { group: 'בנות ב' } },
    ]);
    expect(checkTemplate(draft, windows, [{ ...other, laneIds: ['l3'] }], null, rules).ok).toBe(
      true,
    );
    expect(checkTemplate(draft, windows, [{ ...other, poolId: 'p9' }], null, rules).ok).toBe(true);
    expect(checkTemplate({ ...draft, id: 'g2' }, windows, [other], null, rules).ok).toBe(true);
    expect(
      checkTemplate(
        draft,
        windows,
        [{ ...other, effectiveTo: '2026-09-01', effectiveFrom: '2026-01-01' }],
        null,
        rules,
      ).ok,
    ).toBe(true);
  });

  it('checks the instructor: active, gender, window gender, skills', () => {
    const yossi = { ...dana, id: 'i3', name: 'יוסי', gender: 'male' as const };
    expect(checkTemplate(draft, windows, [], yossi, rules).violations).toEqual([
      {
        code: 'scheduling.rules.windowInstructorGender',
        params: { name: 'יוסי', window: 'female' },
      },
    ]);
    expect(
      checkTemplate(draft, windows, [], yossi, { ...rules, windowInstructorGender: 'any_gender' })
        .ok,
    ).toBe(true);
    const needsFemale = { ...draft, requiredInstructorGender: 'female' as const };
    expect(
      checkTemplate(needsFemale, windows, [], yossi, rules).violations.map((v) => v.code),
    ).toEqual(['scheduling.rules.instructorGender']);
    expect(
      checkTemplate(
        { ...draft, requiredSkills: ['water_fear', 'babies'] },
        windows,
        [],
        dana,
        rules,
      ).violations,
    ).toEqual([
      {
        code: 'scheduling.rules.instructorSkills',
        params: { name: 'דנה', count: 1, skills: 'babies' },
      },
    ]);
    expect(
      checkTemplate(draft, windows, [], { ...dana, status: 'inactive' }, rules).violations[0]?.code,
    ).toBe('scheduling.rules.instructorInactive');
    // Outside a window there is no window gender to match.
    expect(
      checkInstructor({ ...draft, startsAt: '19:00' }, yossi, [], rules, null).violations.map(
        (v) => v.code,
      ),
    ).toEqual([]);
    const mixedSunday = { ...draft, weekday: 0 };
    expect(checkInstructor(mixedSunday, yossi, [], rules, windows[1] as WindowRow).ok).toBe(true);
  });

  it('checks weekly availability (venue, time, dates) and one-off exceptions on a date', () => {
    const late = { ...draft, startsAt: '19:30' };
    expect(checkInstructor(late, dana, [], rules, null).violations[0]?.code).toBe(
      'scheduling.rules.instructorUnavailable',
    );
    const elsewhere = { ...draft, weekday: 0, venueId: 'v2' };
    expect(checkInstructor(elsewhere, dana, [], rules, null).violations[0]?.code).toBe(
      'scheduling.rules.instructorUnavailable',
    );
    const early = { ...draft, startsAt: '14:30' };
    expect(checkInstructor(early, dana, [], rules, null).ok).toBe(false);
    const away = {
      ...dana,
      exceptions: [
        {
          kind: 'unavailable' as const,
          startsOn: '2026-10-05',
          endsOn: '2026-10-09',
          startsAt: null,
          endsAt: null,
        },
      ],
    };
    expect(checkInstructor(draft, away, [], rules, null, '2026-10-05').violations[0]?.code).toBe(
      'scheduling.rules.instructorAway',
    );
    expect(checkInstructor(draft, away, [], rules, null, '2026-10-12').ok).toBe(true);
    const morningOff = {
      ...dana,
      exceptions: [
        {
          kind: 'unavailable' as const,
          startsOn: '2026-10-05',
          endsOn: '2026-10-05',
          startsAt: '08:00',
          endsAt: '12:00',
        },
      ],
    };
    expect(checkInstructor(draft, morningOff, [], rules, null, '2026-10-05').ok).toBe(true);
    const extraDay = {
      ...dana,
      availability: [],
      exceptions: [
        {
          kind: 'available' as const,
          startsOn: '2026-10-05',
          endsOn: '2026-10-05',
          startsAt: '15:00',
          endsAt: '18:00',
        },
      ],
    };
    expect(checkInstructor(draft, extraDay, [], rules, null, '2026-10-05').ok).toBe(true);
    expect(checkInstructor(draft, extraDay, [], rules, null).ok).toBe(false);
  });

  it('refuses double booking and too little travel time between venues', () => {
    const mine = { ...other, leadStaffId: 'i1', laneIds: ['l4'] };
    expect(checkInstructor(draft, dana, [mine], rules, null).violations).toEqual([
      { code: 'scheduling.rules.instructorBusy', params: { name: 'דנה', group: 'בנות ב' } },
    ]);
    const afterElsewhere = { ...mine, venueId: 'v2', poolId: 'p2', startsAt: '17:00' }; // 15 min after 16:45
    expect(checkInstructor(draft, dana, [afterElsewhere], rules, null).violations).toEqual([
      {
        code: 'scheduling.rules.travelBuffer',
        params: { name: 'דנה', group: 'בנות ב', minutes: 30 },
      },
    ]);
    const beforeElsewhere = { ...afterElsewhere, startsAt: '15:00' }; // ends 15:45, 15 min before 16:00
    expect(checkInstructor(draft, dana, [beforeElsewhere], rules, null).violations[0]?.code).toBe(
      'scheduling.rules.travelBuffer',
    );
    expect(
      checkInstructor(draft, dana, [{ ...afterElsewhere, startsAt: '17:30' }], rules, null).ok,
    ).toBe(true);
    expect(
      checkInstructor(draft, dana, [{ ...afterElsewhere, venueId: 'v1' }], rules, null).ok,
    ).toBe(true);
    expect(checkInstructor(draft, dana, [{ ...afterElsewhere, weekday: 2 }], rules, null).ok).toBe(
      true,
    );
    expect(checkInstructor(draft, dana, [{ ...mine, leadStaffId: 'i9' }], rules, null).ok).toBe(
      true,
    );
    expect(checkInstructor({ ...draft, id: 'g2' }, dana, [mine], rules, null).ok).toBe(true);
    expect(
      checkInstructor(
        draft,
        dana,
        [{ ...mine, effectiveFrom: '2026-01-01', effectiveTo: '2026-08-01' }],
        rules,
        null,
      ).ok,
    ).toBe(true);
  });
});

describe('scorePlacement', () => {
  const base: ScoreInput = {
    student: { levelOrdinal: 2, preferredStaffId: null, friendIds: [] },
    group: {
      weekday: 1,
      startsAt: '16:00',
      durationMin: 45,
      venueId: 'v1',
      leadStaffId: 'i1',
      memberIds: ['a', 'b', 'c'],
      memberLevelOrdinals: [2, 2, 3],
    },
    siblingGroups: [],
  };
  const codes = (s: ReturnType<typeof scorePlacement>) =>
    s.reasons.map((r) => r.code.replace('scheduling.score.', ''));

  it('rewards the same level and penalises a far one', () => {
    expect(scorePlacement(base)).toEqual({
      points: 3,
      reasons: [{ code: 'scheduling.score.levelSame', points: 3 }],
    });
    expect(
      codes(scorePlacement({ ...base, student: { ...base.student, levelOrdinal: 3 } })),
    ).toEqual(['levelNear']);
    expect(
      codes(scorePlacement({ ...base, student: { ...base.student, levelOrdinal: 5 } })),
    ).toEqual(['levelFar']);
    const even = { ...base, group: { ...base.group, memberLevelOrdinals: [1, 3] } };
    expect(codes(scorePlacement(even))).toEqual(['levelSame']);
    expect(
      codes(scorePlacement({ ...base, student: { ...base.student, levelOrdinal: null } })),
    ).toEqual([]);
  });

  it('notes an empty group', () => {
    const empty = { ...base, group: { ...base.group, memberIds: [], memberLevelOrdinals: [] } };
    expect(scorePlacement(empty).points).toBe(-1);
  });

  it('prefers siblings in parallel, then back to back, then anything else', () => {
    const parallel = { weekday: 1, startsAt: '16:00', durationMin: 45, venueId: 'v1' };
    expect(codes(scorePlacement({ ...base, siblingGroups: [parallel] }))).toContain(
      'siblingsParallel',
    );
    const after = { ...parallel, startsAt: '16:50' };
    expect(codes(scorePlacement({ ...base, siblingGroups: [after] }))).toContain(
      'siblingsSequential',
    );
    const before = { ...parallel, startsAt: '15:00' };
    expect(codes(scorePlacement({ ...base, siblingGroups: [before] }))).toContain(
      'siblingsSequential',
    );
    const otherDay = { ...parallel, weekday: 3 };
    expect(codes(scorePlacement({ ...base, siblingGroups: [otherDay] }))).toContain(
      'siblingsApart',
    );
    const otherVenue = { ...parallel, venueId: 'v2' };
    expect(codes(scorePlacement({ ...base, siblingGroups: [otherVenue] }))).toContain(
      'siblingsApart',
    );
    const farLater = { ...parallel, startsAt: '18:00' };
    expect(codes(scorePlacement({ ...base, siblingGroups: [farLater] }))).toContain(
      'siblingsApart',
    );
  });

  it('rewards friends, the preferred instructor and the family’s preferred day and time', () => {
    const s = scorePlacement({
      ...base,
      student: {
        ...base.student,
        friendIds: ['b'],
        preferredStaffId: 'i1',
        preference: { weekdays: [1, 3], earliestAt: '15:30', latestAt: '17:00' },
      },
    });
    expect(codes(s)).toEqual([
      'levelSame',
      'friendInGroup',
      'preferredInstructor',
      'weekdayPreferred',
      'timePreferred',
    ]);
    expect(s.points).toBe(10);
    const miss = scorePlacement({
      ...base,
      student: {
        ...base.student,
        friendIds: ['z'],
        preferredStaffId: 'i2',
        preference: { weekdays: [3], earliestAt: '17:00', latestAt: null },
      },
    });
    expect(codes(miss)).toEqual(['levelSame', 'weekdayNotPreferred', 'timeNotPreferred']);
    const latest = scorePlacement({
      ...base,
      student: {
        ...base.student,
        preference: { weekdays: [], earliestAt: null, latestAt: '16:30' },
      },
    });
    expect(codes(latest)).toEqual(['levelSame', 'timeNotPreferred']);
    const noTimes = scorePlacement({
      ...base,
      student: { ...base.student, preference: { weekdays: [], earliestAt: null, latestAt: null } },
    });
    expect(codes(noTimes)).toEqual(['levelSame']);
  });
});

describe('planShiftChange', () => {
  const at = new Date('2026-10-01T09:00:00Z');
  const base = {
    kind: 'reassign_group' as const,
    currentStaffId: 'i1',
    toStaffId: 'i2',
    requestedByStaffId: null,
    requestedAt: at,
    requiresAcceptance: true,
    escalateAfterHours: 12,
  };

  it('waits for the new instructor of a reassignment and escalates after the configured hours', () => {
    expect(planShiftChange(base)).toEqual({
      ok: true,
      respondentStaffId: 'i2',
      needsAcceptance: true,
      escalateAt: new Date('2026-10-01T21:00:00Z'),
    });
  });

  it('waits for the current instructor of a time change', () => {
    expect(planShiftChange({ ...base, kind: 'reschedule_session', toStaffId: null })).toMatchObject(
      {
        respondentStaffId: 'i1',
        needsAcceptance: true,
      },
    );
    expect(planShiftChange({ ...base, kind: 'reschedule_session', currentStaffId: null })).toEqual({
      ok: false,
      code: 'scheduling.shift.noInstructor',
    });
  });

  it('applies at once when the policy turns acceptance off or the instructor asked', () => {
    expect(planShiftChange({ ...base, requiresAcceptance: false })).toMatchObject({
      needsAcceptance: false,
      escalateAt: null,
    });
    expect(planShiftChange({ ...base, requestedByStaffId: 'i2' })).toMatchObject({
      needsAcceptance: false,
    });
  });

  it('refuses a reassignment to nobody or to the same instructor', () => {
    expect(planShiftChange({ ...base, toStaffId: null })).toEqual({
      ok: false,
      code: 'scheduling.shift.noInstructor',
    });
    expect(planShiftChange({ ...base, kind: 'reassign_session', toStaffId: 'i1' })).toEqual({
      ok: false,
      code: 'scheduling.shift.sameInstructor',
    });
  });
});

describe('waitlistClusters', () => {
  it('groups waiting children by program, venue, weekday, hour and age band', () => {
    const kid = (
      id: string,
      months: number | null,
      days: number[],
      earliestAt: string | null = '16:20',
    ) => ({
      id,
      programId: 'kids',
      venueId: 'v1',
      preferredWeekdays: days,
      earliestAt,
      ageMonths: months,
    });
    const entries = [
      kid('a', 40, [0]),
      kid('b', 50, [0, 2]),
      kid('c', 44, [0]),
      kid('d', 70, [0]), // 5 years: another band
      kid('e', 40, []), // no day: left out
      kid('f', 6, [0], null),
      kid('g', null, [0], null),
    ];
    const clusters = waitlistClusters(entries, 2);
    expect(clusters).toEqual([
      {
        programId: 'kids',
        venueId: 'v1',
        weekday: 0,
        hour: '16:00',
        ageFromYears: 3,
        ageToYears: 4,
        entryIds: ['a', 'b', 'c'],
      },
    ]);
    expect(waitlistClusters(entries, 1).map((c) => c.entryIds.length)).toEqual([3, 1, 1, 1, 1]);
    expect(waitlistClusters(entries, 1).at(-1)?.weekday).toBe(2);
  });

  it('bands ages in two-year steps', () => {
    expect(ageBand(null)).toEqual([null, null]);
    expect(ageBand(8)).toEqual([0, 0]);
    expect(ageBand(12)).toEqual([1, 2]);
    expect(ageBand(30)).toEqual([1, 2]);
    expect(ageBand(36)).toEqual([3, 4]);
    expect(ageBand(59)).toEqual([3, 4]);
  });
});

describe('substitutes (Phase 6 acceptance criterion 2)', () => {
  const cand = (over: Partial<SubstituteCandidate>): SubstituteCandidate => ({
    staffId: over.name ?? 'x',
    name: 'x',
    violations: [],
    certified: true,
    busy: false,
    knowsGroup: false,
    atVenueThatDay: false,
    lessonsThisWeek: 0,
    ...over,
  });
  const pool = [
    cand({ name: 'אסף', lessonsThisWeek: 2 }),
    cand({ name: 'נועה', knowsGroup: true, lessonsThisWeek: 8 }),
    cand({ name: 'ליה', atVenueThatDay: true, lessonsThisWeek: 12 }),
    cand({ name: 'דני', lessonsThisWeek: 2 }),
    cand({ name: 'רעות', certified: false }),
    cand({ name: 'מיכל', busy: true }),
    cand({ name: 'יעל', violations: [{ code: 'scheduling.rules.instructorGender', params: {} }] }),
  ];

  it('offers only qualified, free, rule-abiding instructors, best first, in waves', () => {
    const ranked = rankSubstitutes(pool, 2);
    expect(ranked.map((r) => [r.staffId, r.rank, r.wave])).toEqual([
      ['נועה', 1, 1],
      ['ליה', 2, 1],
      ['אסף', 3, 2],
      ['דני', 4, 2],
    ]);
    expect(ranked[0]?.reasons).toEqual(['knowsGroup', 'load:8']);
    expect(ranked[1]?.reasons).toEqual(['atVenueThatDay', 'load:12']);
  });
  it('a wave is never empty', () => {
    expect(rankSubstitutes(pool, 0).map((r) => r.wave)).toEqual([1, 2, 3, 4]);
    expect(rankSubstitutes([], 3)).toEqual([]);
  });
  it('says why someone was left out', () => {
    expect(substituteExclusion(cand({ certified: false }))).toBe(
      'scheduling.substitute.notCertified',
    );
    expect(substituteExclusion(cand({ busy: true }))).toBe('scheduling.substitute.busy');
    expect(
      substituteExclusion(
        cand({ violations: [{ code: 'scheduling.rules.instructorAway', params: {} }] }),
      ),
    ).toBe('scheduling.rules.instructorAway');
    expect(substituteExclusion(cand({}))).toBeNull();
  });
});

describe('staffingGaps', () => {
  const lesson = (
    date: string,
    weekday: number,
    venueId: string,
    startsAt: string,
    endsAt: string,
    groupName: string,
    hasLead = false,
  ) => ({
    date,
    weekday,
    venueId,
    startsAt,
    endsAt,
    groupName,
    hasLead,
  });
  it('merges back-to-back lessons without an instructor per venue and weekday', () => {
    const gaps = staffingGaps([
      lesson('2026-11-08', 0, 'efrat', '16:00', '16:45', 'דולפין'),
      lesson('2026-11-08', 0, 'efrat', '16:45', '17:30', 'כריש'),
      lesson('2026-11-08', 0, 'efrat', '17:00', '17:20', 'קצר'),
      lesson('2026-11-15', 0, 'efrat', '18:00', '19:00', 'בוגרים'),
      lesson('2026-11-01', 0, 'efrat', '16:00', '16:45', 'דולפין'),
      lesson('2026-11-08', 0, 'efrat', '19:30', '20:00', 'ערב'),
      lesson('2026-11-09', 1, 'efrat', '16:00', '17:00', 'שני'),
      lesson('2026-11-08', 0, 'gush', '16:00', '17:00', 'גוש'),
      lesson('2026-11-08', 0, 'efrat', '10:00', '11:00', 'בוקר', true),
    ]);
    expect(gaps).toEqual([
      {
        venueId: 'efrat',
        weekday: 0,
        from: '16:00',
        to: '17:30',
        dates: ['2026-11-01', '2026-11-08'],
        groups: ['דולפין', 'כריש', 'קצר'],
      },
      {
        venueId: 'gush',
        weekday: 0,
        from: '16:00',
        to: '17:00',
        dates: ['2026-11-08'],
        groups: ['גוש'],
      },
      {
        venueId: 'efrat',
        weekday: 0,
        from: '18:00',
        to: '19:00',
        dates: ['2026-11-15'],
        groups: ['בוגרים'],
      },
      {
        venueId: 'efrat',
        weekday: 0,
        from: '19:30',
        to: '20:00',
        dates: ['2026-11-08'],
        groups: ['ערב'],
      },
      {
        venueId: 'efrat',
        weekday: 1,
        from: '16:00',
        to: '17:00',
        dates: ['2026-11-09'],
        groups: ['שני'],
      },
    ]);
  });
});
