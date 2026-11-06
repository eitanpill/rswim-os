import { describe, expect, it } from 'vitest';
import { AGENT_PROFILE_LEVELS, type AgentActionKind } from '@rswim/contracts';
import {
  declinedUntil,
  kindStats,
  kindText,
  learnedMinLink,
  learnedSuggestions,
  learningText,
  skippedHouseholds,
  suggestionText,
  type DecisionRow,
} from '../src/learning-policies';

const rows = (kind: AgentActionKind, n: number, r: Omit<DecisionRow, 'kind'>): DecisionRow[] =>
  Array.from({ length: n }, () => ({ kind, ...r }));

const approved = { status: 'confirmed', ranAlone: false, dismissReason: null } as const;
const alone = { status: 'confirmed', ranAlone: true, dismissReason: null } as const;

describe('counting her decisions', () => {
  it('splits approvals, drops and take-backs per kind', () => {
    const s = kindStats([
      ...rows('payment_link', 2, approved),
      { kind: 'payment_link', status: 'failed', ranAlone: false, dismissReason: null },
      { kind: 'payment_link', status: 'dismissed', ranAlone: false, dismissReason: 'wrong' },
      { kind: 'payment_link', status: 'dismissed', ranAlone: false, dismissReason: null },
      { kind: 'payment_link', status: 'dismissed', ranAlone: false, dismissReason: 'not_now' },
      {
        kind: 'payment_link',
        status: 'dismissed',
        ranAlone: false,
        dismissReason: 'special_case',
      },
      { kind: 'payment_link', status: 'undone', ranAlone: false, dismissReason: null },
      ...rows('book_makeup', 3, alone),
      { kind: 'book_makeup', status: 'undone', ranAlone: true, dismissReason: null },
    ]);
    expect(s.payment_link).toEqual({ approved: 3, against: 3, neutral: 2, alone: 0, undone: 0 });
    expect(s.book_makeup).toEqual({ approved: 0, against: 0, neutral: 0, alone: 4, undone: 1 });
    expect(s.freeze.approved).toBe(0);
  });
});

describe('what the brain suggests', () => {
  const levels = AGENT_PROFILE_LEVELS.careful;
  const base = { levels, declined: {}, today: '2026-11-06' };

  it('suggests running alone what she approves nearly every time', () => {
    const stats = kindStats([
      ...rows('payment_link', 9, approved),
      { kind: 'payment_link', status: 'dismissed', ranAlone: false, dismissReason: 'not_now' },
    ]);
    expect(learnedSuggestions({ ...base, stats })).toEqual([
      { kind: 'payment_link', from: 'approve', to: 'auto', why: 'approves', count: 9, of: 9 },
    ]);
  });

  it('also from suggest, but not too soon, not when she drops many, and never above the ceiling', () => {
    const fromSuggest = kindStats(rows('open_makeup_slots', 8, approved));
    expect(learnedSuggestions({ ...base, stats: fromSuggest })[0]).toMatchObject({
      from: 'suggest',
      to: 'auto',
    });
    const few = kindStats(rows('payment_link', 7, approved));
    expect(learnedSuggestions({ ...base, stats: few })).toEqual([]);
    const drops = kindStats([
      ...rows('payment_link', 8, approved),
      { kind: 'payment_link', status: 'dismissed', ranAlone: false, dismissReason: 'wrong' },
    ]);
    expect(learnedSuggestions({ ...base, stats: drops })).toEqual([]);
    const capped = kindStats(rows('message_family', 20, approved));
    expect(learnedSuggestions({ ...base, stats: capped })).toEqual([]);
  });

  it('suggests asking her again when she takes back too much of what ran alone', () => {
    const stats = kindStats([
      ...rows('report_absence', 6, alone),
      ...rows('report_absence', 2, { ...alone, status: 'undone' }),
      ...rows('lesson_reminder', 9, alone),
      ...rows('lesson_reminder', 1, { ...alone, status: 'undone' }),
    ]);
    expect(learnedSuggestions({ ...base, stats })).toEqual([
      { kind: 'report_absence', from: 'auto', to: 'approve', why: 'undoes', count: 2, of: 8 },
    ]);
    // Not before enough ran alone, and not when the share is small.
    const early = kindStats(rows('report_absence', 3, { ...alone, status: 'undone' }));
    expect(learnedSuggestions({ ...base, stats: early })).toEqual([]);
    const small = kindStats([
      ...rows('report_absence', 12, alone),
      ...rows('report_absence', 2, { ...alone, status: 'undone' }),
    ]);
    expect(learnedSuggestions({ ...base, stats: small })).toEqual([]);
  });

  it('leaves a kind she turned off, and one she declined until the quiet days pass', () => {
    const stats = kindStats(rows('payment_link', 9, approved));
    expect(
      learnedSuggestions({ ...base, stats, levels: { ...levels, payment_link: 'off' } }),
    ).toEqual([]);
    expect(
      learnedSuggestions({ ...base, stats, declined: { payment_link: '2026-11-06' } }),
    ).toEqual([]);
    expect(
      learnedSuggestions({ ...base, stats, declined: { payment_link: '2026-11-05' } }),
    ).toHaveLength(1);
    expect(declinedUntil('2026-11-06')).toBe('2026-12-06');
  });
});

describe('the morning check learns', () => {
  it('skips a special case for long and any other dropped link for the attention age', () => {
    expect(
      skippedHouseholds(
        [
          { householdId: 'a', reason: 'special_case', daysAgo: 60 },
          { householdId: 'b', reason: 'special_case', daysAgo: 95 },
          { householdId: 'c', reason: 'not_now', daysAgo: 10 },
          { householdId: 'c', reason: null, daysAgo: 12 },
          { householdId: 'd', reason: 'wrong', daysAgo: 40 },
        ],
        30,
      ),
    ).toEqual(['a', 'c']);
  });

  it('raises the smallest link above what she called too small, never above what she approved', () => {
    expect(learnedMinLink({ tooSmall: [], approved: [5000] })).toBe(100);
    expect(learnedMinLink({ tooSmall: [3000, 8000], approved: [] })).toBe(8001);
    expect(learnedMinLink({ tooSmall: [8000], approved: [6000, 20000] })).toBe(6000);
    expect(learnedMinLink({ tooSmall: [50], approved: [] })).toBe(100);
  });
});

describe('what the owner reads', () => {
  const up = {
    kind: 'payment_link',
    from: 'approve',
    to: 'auto',
    why: 'approves',
    count: 9,
    of: 9,
  } as const;
  const down = {
    kind: 'book_makeup',
    from: 'auto',
    to: 'approve',
    why: 'undoes',
    count: 2,
    of: 6,
  } as const;

  it('says each suggestion in her words', () => {
    expect(suggestionText(up, 'he')).toBe(
      'אישרת 9 מתוך 9 בקישורי תשלום. שאבצע אותם לבד ואדווח לך?',
    );
    expect(suggestionText(down, 'he')).toContain('ביטלת 2 מתוך 6 קביעת השלמות');
    expect(suggestionText(up, 'en')).toContain('You approved 9 of 9 for payment links');
    expect(suggestionText(down, 'en')).toContain('You took back 2 of the 6 booking makeups');
    expect(kindText('freeze', 'en')).toBe('freezes');
  });

  it('writes the weekly WhatsApp, or nothing when there is nothing new', () => {
    const he = learningText({ suggestions: [up], minLinkAgorot: 8001 }, 'he')!;
    expect(he.split('\n')).toEqual([
      '🧠 מה למדתי על דרך העבודה שלך:',
      '• אישרת 9 מתוך 9 בקישורי תשלום. שאבצע אותם לבד ואדווח לך?',
      '• קישורי תשלום מתחת ל-₪81 אני כבר לא מציע (אמרת שהם קטנים מדי).',
      'אפשר לאשר או לדחות בעמוד המוח.',
    ]);
    const en = learningText({ suggestions: [down], minLinkAgorot: 150000 }, 'en')!;
    expect(en).toContain('below ₪1,500');
    expect(en).toContain("brain's page");
    expect(learningText({ suggestions: [], minLinkAgorot: 100 }, 'he')).toBeNull();
  });
});
