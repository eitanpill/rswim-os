import { describe, expect, it } from 'vitest';
import { AGENT_PROFILE_LEVELS } from '@rswim/contracts';
import {
  agentGate,
  approvalText,
  capLevel,
  decisionText,
  eveningText,
  morningPlan,
  effectiveLevels,
  levelsWithinCeiling,
  matchingProfile,
  ownerReply,
  staffAbsence,
  staffReplyText,
  summaryText,
  undoable,
  type AgentSettingsView,
  type GateFacts,
} from '../src/agent-policies';

const settings = (s: Partial<AgentSettingsView> = {}): AgentSettingsView => ({
  profile: 'careful',
  levels: {},
  maxAutoPerDay: 30,
  maxAutoPaymentAgorot: 30000,
  paused: false,
  ...s,
});

const facts = (f: Partial<GateFacts> = {}): GateFacts => ({
  level: 'auto',
  paused: false,
  ranAloneToday: 0,
  maxAutoPerDay: 30,
  amountAgorot: null,
  maxAutoPaymentAgorot: 30000,
  ...f,
});

describe('levels', () => {
  it('takes the lower of two levels', () => {
    expect(capLevel('auto', 'approve')).toBe('approve');
    expect(capLevel('off', 'auto')).toBe('off');
  });

  it('uses the profile, then what the owner set, never above a kind ceiling', () => {
    const careful = effectiveLevels(settings());
    expect(careful.report_absence).toBe('auto');
    expect(careful.move_student).toBe('approve');
    expect(careful.open_makeup_slots).toBe('suggest');
    const set = effectiveLevels(settings({ levels: { move_student: 'auto', freeze: 'off' } }));
    expect(set.move_student).toBe('auto');
    expect(set.freeze).toBe('off');
    // Autopilot cannot send free text or cancel lessons on its own.
    const pilot = effectiveLevels(settings({ profile: 'autopilot' }));
    expect(pilot.payment_link).toBe('auto');
    expect(pilot.message_family).toBe('approve');
    expect(pilot.cancel_lessons).toBe('approve');
  });

  it('knows when the table still matches its profile', () => {
    expect(matchingProfile(settings())).toBe('careful');
    expect(
      matchingProfile(settings({ profile: 'balanced', levels: AGENT_PROFILE_LEVELS.balanced })),
    ).toBe('balanced');
    expect(matchingProfile(settings({ levels: { freeze: 'off' } }))).toBeNull();
  });

  it('refuses a level above a ceiling', () => {
    expect(levelsWithinCeiling({ move_student: 'auto', message_family: 'approve' })).toEqual({
      ok: true,
    });
    expect(levelsWithinCeiling({ cancel_lessons: 'auto' })).toEqual({
      ok: false,
      kind: 'cancel_lessons',
    });
  });
});

describe('agentGate', () => {
  it('refuses a kind that is off', () => {
    expect(agentGate(facts({ level: 'off' }))).toEqual({
      route: 'refuse',
      code: 'agent.errors.off',
    });
  });

  it('waits for the owner below auto', () => {
    expect(agentGate(facts({ level: 'suggest' }))).toEqual({ route: 'wait', reason: 'level' });
    expect(agentGate(facts({ level: 'approve' }))).toEqual({ route: 'wait', reason: 'level' });
  });

  it('runs on auto unless paused, over the daily cap or over the amount cap', () => {
    expect(agentGate(facts())).toEqual({ route: 'run' });
    expect(agentGate(facts({ paused: true }))).toEqual({ route: 'wait', reason: 'paused' });
    expect(agentGate(facts({ ranAloneToday: 30 }))).toEqual({
      route: 'wait',
      reason: 'daily_cap',
    });
    expect(agentGate(facts({ amountAgorot: 30001 }))).toEqual({
      route: 'wait',
      reason: 'amount_cap',
    });
    expect(agentGate(facts({ amountAgorot: 30000 }))).toEqual({ route: 'run' });
  });
});

describe('undoable', () => {
  it('can take back moves, slots and payment links, not messages', () => {
    expect(undoable('move_student')).toBe(true);
    expect(undoable('payment_link')).toBe(true);
    expect(undoable('message_family')).toBe(false);
  });

  it('withdraws a substitute search, never cancelled lessons', () => {
    expect(undoable('substitute')).toBe(true);
    expect(undoable('cancel_lessons')).toBe(false);
  });
});

describe('WhatsApp approvals', () => {
  const pay = {
    code: 'copilot.summary.payment',
    params: { family: 'כהן', amount: 32000, description: 'נובמבר' },
  };

  it('writes a summary in words, with shekels and day-first dates', () => {
    expect(summaryText(pay, 'he')).toBe('לשלוח למשפחת כהן קישור תשלום על ₪320 (נובמבר)');
    expect(
      summaryText(
        {
          code: 'copilot.summary.freeze',
          params: { student: 'נועה', group: 'כרישים', date: '2026-12-01', until: '2026-12-31' },
        },
        'en',
      ),
    ).toBe("Freeze נועה's place in כרישים from 01/12/2026 to 31/12/2026");
    // An unknown sentence shows its key; a missing value is left out; a non-date stays as it is.
    expect(summaryText({ code: 'copilot.summary.other', params: {} }, 'he')).toBe('other');
    expect(
      summaryText({ code: 'copilot.summary.add', params: { student: 'נועה', date: 'מחר' } }, 'he'),
    ).toBe('לשבץ את נועה ב, החל מ-מחר');
  });

  it('asks the owner with the number to answer', () => {
    expect(approvalText({ ref: 12, summary: pay }, 'he')).toContain('"כן 12"');
    expect(approvalText({ ref: 12, summary: pay }, 'en')).toContain('"no 12"');
  });

  it('reads yes and no with the number, and nothing else', () => {
    expect(ownerReply('כן 12')).toEqual({ verb: 'confirm', ref: 12 });
    expect(ownerReply(' אישור #7. ')).toEqual({ verb: 'confirm', ref: 7 });
    expect(ownerReply('YES 3')).toEqual({ verb: 'confirm', ref: 3 });
    expect(ownerReply('לא 12')).toEqual({ verb: 'dismiss', ref: 12 });
    expect(ownerReply('no 4!')).toEqual({ verb: 'dismiss', ref: 4 });
    expect(ownerReply('כן')).toBeNull();
    expect(ownerReply('כן, נדבר מחר ב-12')).toBeNull();
    // A drop may say why; anything else after the number is not a decision.
    expect(ownerReply('לא 12 מקרה מיוחד')).toEqual({
      verb: 'dismiss',
      ref: 12,
      reason: 'special_case',
    });
    expect(ownerReply('לא 12 - לא עכשיו')).toEqual({ verb: 'dismiss', ref: 12, reason: 'not_now' });
    expect(ownerReply('לא #3 קטן מדי.')).toEqual({ verb: 'dismiss', ref: 3, reason: 'too_small' });
    expect(ownerReply('no 5 wrong')).toEqual({ verb: 'dismiss', ref: 5, reason: 'wrong' });
    expect(ownerReply('לא 5 מחר')).toBeNull();
    expect(ownerReply('כן 5 מיוחד')).toBeNull();
  });

  it('tells the owner what happened, in both languages', () => {
    for (const outcome of [
      'confirmed',
      'failed',
      'dismissed',
      'not_found',
      'already_decided',
      'off',
    ] as const) {
      expect(decisionText({ outcome, ref: 5, summary: 'x' }, 'he')).toBeTruthy();
      expect(decisionText({ outcome, ref: 5, summary: 'x' }, 'en')).toBeTruthy();
    }
    expect(decisionText({ outcome: 'confirmed', ref: 5, summary: 'לבטל' }, 'he')).toBe(
      '✅ בוצע (#5): לבטל',
    );
  });
});

describe("an instructor's message", () => {
  const T = '2026-11-03';

  it('finds the day they cannot teach', () => {
    expect(staffAbsence('אני חולה היום', T)).toEqual({ date: T });
    expect(staffAbsence('אני חולה', T)).toEqual({ date: T });
    expect(staffAbsence('לא אוכל להגיע מחר', T)).toEqual({ date: '2026-11-04' });
    expect(staffAbsence("Sorry, can't come tomorrow", T)).toEqual({ date: '2026-11-04' });
    expect(staffAbsence('לא אגיע ב-2026-11-20', T)).toEqual({ date: '2026-11-20' });
    expect(staffAbsence('לא אהיה ב-5.11', T)).toEqual({ date: '2026-11-05' });
    expect(staffAbsence('חולה, לא אגיע 2/1', T)).toEqual({ date: '2027-01-02' });
  });

  it('leaves other messages alone', () => {
    expect(staffAbsence('מתי השיעור מחר?', T)).toBeNull();
    expect(staffAbsence('הכל בסדר', T)).toBeNull();
  });

  it('answers the instructor', () => {
    const he = (lessons: number, waiting: number) =>
      staffReplyText({ date: '2026-11-04', lessons, waiting }, 'he');
    const en = (lessons: number, waiting: number) =>
      staffReplyText({ date: '2026-11-04', lessons, waiting }, 'en');
    expect(he(0, 0)).toContain('לא מצאתי לך שיעורים ב-04/11/2026');
    expect(he(2, 2)).toContain('מחכה לאישור המשרד');
    expect(he(2, 0)).toContain('מחפשים מחליף ל-2');
    expect(en(0, 0)).toContain('no lessons');
    expect(en(2, 1)).toContain('approval');
    expect(en(2, 0)).toContain('looking for a substitute');
  });
});

describe('the morning check', () => {
  const base = {
    debts: [
      { householdId: 'a', balanceAgorot: 20000, oldestDays: 40 },
      { householdId: 'b', balanceAgorot: 50000, oldestDays: 31 },
      { householdId: 'c', balanceAgorot: 90000, oldestDays: 5 },
      { householdId: 'd', balanceAgorot: 50, oldestDays: 90 },
      { householdId: 'e', balanceAgorot: 30000, oldestDays: 60 },
    ],
    uncovered: [{ sessionId: 's1' }, { sessionId: 's2' }],
    debtAttentionDays: 30,
    askedHouseholds: ['e'],
    coveredSessions: ['s2'],
    levels: { payment_link: 'approve', substitute: 'auto' } as const,
    minLinkAgorot: 100,
  };

  it('asks old debts to pay, largest first, and looks for instructors for new gaps', () => {
    expect(morningPlan(base)).toEqual({
      payments: [
        { householdId: 'b', amountAgorot: 50000 },
        { householdId: 'a', amountAgorot: 20000 },
      ],
      substitutes: [{ sessionId: 's1' }],
    });
  });

  it('leaves out balances below the smallest link the owner finds worth it', () => {
    expect(morningPlan({ ...base, minLinkAgorot: 25000 }).payments).toEqual([
      { householdId: 'b', amountAgorot: 50000 },
    ]);
  });

  it('proposes nothing of a kind the owner turned off', () => {
    expect(morningPlan({ ...base, levels: { payment_link: 'off', substitute: 'off' } })).toEqual({
      payments: [],
      substitutes: [],
    });
  });
});

describe('the evening summary', () => {
  const day = {
    date: '2026-11-03',
    alone: 4,
    approved: 2,
    waiting: 1,
    failed: 0,
    tomorrowLessons: 12,
    tomorrowUncovered: 1,
  };

  it('counts the day and tomorrow, in both languages', () => {
    expect(eveningText(day, 'he')).toBe(
      [
        '🌙 היום של המוח (03/11/2026)',
        '• בוצעו לבד: 4',
        '• אושרו על ידך: 2',
        '• מחכות לך: 1 (לאישור השיבו "כן <מספר>")',
        '• הכללים לא אפשרו: 0',
        'מחר: 12 שיעורים, 1 בלי מדריך.',
      ].join('\n'),
    );
    const quiet = { ...day, waiting: 0, tomorrowUncovered: 0 };
    expect(eveningText(quiet, 'he')).toContain('מחכות לך: 0\n');
    expect(eveningText(quiet, 'he')).toContain('מחר: 12 שיעורים.');
    expect(eveningText(day, 'en')).toContain('1 without an instructor');
    expect(eveningText(day, 'en')).toContain('reply "yes <number>"');
    expect(eveningText(quiet, 'en')).toContain('Tomorrow: 12 lessons.');
    expect(eveningText(quiet, 'en')).toContain('Waiting for you: 0\n');
  });
});
