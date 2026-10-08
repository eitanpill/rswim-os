import { describe, expect, it } from 'vitest';
import { DEFAULT_ORG_RULES } from '@rswim/contracts';
import {
  BotAnswer,
  BotHandoff,
  botRoute,
  botSystem,
  fakeBotIntent,
  handoffNoteDue,
  keywords,
  matchKnowledge,
  policyFacts,
  sensitiveTopic,
  type BotFacts,
} from '../src/bot-policies';

const base: BotFacts = {
  enabled: true,
  family: true,
  isStaff: false,
  open: true,
  intent: 'schedule_question',
  actionDrafted: false,
  text: 'מתי השיעור הבא?',
};

describe('botRoute', () => {
  it('asks the model about an ordinary question from a family', () => {
    expect(botRoute(base)).toEqual({ route: 'ask' });
  });
  it('stays out of the way when off, for strangers and staff, closed messages and drafted actions', () => {
    expect(botRoute({ ...base, enabled: false })).toEqual({ route: 'skip', reason: 'off' });
    expect(botRoute({ ...base, family: false })).toEqual({ route: 'skip', reason: 'not_family' });
    expect(botRoute({ ...base, isStaff: true })).toEqual({ route: 'skip', reason: 'not_family' });
    expect(botRoute({ ...base, open: false })).toEqual({ route: 'skip', reason: 'closed' });
    expect(botRoute({ ...base, actionDrafted: true })).toEqual({
      route: 'skip',
      reason: 'action_drafted',
    });
  });
  it('hands complaints, leaving and sensitive topics straight to a person', () => {
    const handoff = { route: 'handoff', reason: 'sensitive' };
    expect(botRoute({ ...base, intent: 'complaint' })).toEqual(handoff);
    expect(botRoute({ ...base, intent: 'cancellation_request' })).toEqual(handoff);
    expect(botRoute({ ...base, text: 'לדניאל יש חום, הוא יכול להגיע?' })).toEqual(handoff);
  });
});

describe('sensitiveTopic', () => {
  it('spots health, refunds, complaints and safety', () => {
    for (const s of [
      'יש לה אלרגיה לכלור',
      'אני רוצה החזר על החודש',
      'חויבתי פעמיים',
      'אני ממש לא מרוצה',
      'הוא נפצע בשיעור',
    ])
      expect(sensitiveTopic(s), s).toBe(true);
    expect(sensitiveTopic('איפה חונים ליד הבריכה?')).toBe(false);
  });
});

describe('handoffNoteDue', () => {
  const now = new Date('2026-10-08T10:00:00Z');
  it('sends the first note, then waits out the quiet period', () => {
    expect(handoffNoteDue(null, now)).toBe(true);
    expect(handoffNoteDue(new Date('2026-10-08T09:30:00Z'), now)).toBe(false);
    expect(handoffNoteDue(new Date('2026-10-08T08:00:00Z'), now)).toBe(true);
    expect(handoffNoteDue(new Date('2026-10-08T09:30:00Z'), now, 15)).toBe(true);
  });
});

describe('what the model may hand back', () => {
  it('accepts a short answer and a handoff, and refuses empty or extra fields', () => {
    expect(BotAnswer.parse({ text: ' שלום ' })).toEqual({ text: 'שלום', knowledgeIds: [] });
    expect(BotAnswer.safeParse({ text: '' }).success).toBe(false);
    expect(BotAnswer.safeParse({ text: 'x', extra: 1 }).success).toBe(false);
    expect(BotHandoff.parse({ summary: 'שאלה על מחיר', reason: 'unknown' }).reason).toBe('unknown');
    expect(BotHandoff.safeParse({ summary: 'x', reason: 'model_failed' }).success).toBe(false);
  });
});

describe('policyFacts', () => {
  it('states the school rules a family asks about', () => {
    const facts = policyFacts(DEFAULT_ORG_RULES);
    expect(facts).toEqual([
      'Absence notice: at least 12 hours before the lesson earns a makeup lesson. Late notice or no-show: no makeup.',
      'Makeup lessons: up to 1 per month, valid until end_of_source_month; families book them in the family area of the app.',
      'Monthly charge: on day 1 of the month.',
      "Leaving the school: notice by day 25 of the month to stop the next month's charge.",
      'Freezing a place: no charge while frozen, needs the office approval.',
      'Sibling discount: 10% off for each additional child.',
      'Companions at the pool: 1 per child.',
      'A signed health declaration is required for every child.',
      'Sick children do not come to lessons.',
    ]);
  });
  it('leaves out what the policy does not set, and words the other choices', () => {
    expect(policyFacts({})).toEqual([]);
    expect(
      policyFacts({
        absence: { notice_min_hours: 24, timely_earns_makeup: false },
        makeup: { max_per_month: 2, self_booking: false },
        billing: { freeze_charge: 'full', freeze_requires_approval: false },
        discount: { sibling: { kind: 'flat', percent_bp: 1000 } },
        health: { declaration_required: false, sick_children_allowed: true },
      }),
    ).toEqual([
      'Absence notice: at least 24 hours before the lesson. Late notice or no-show: no makeup.',
      'Makeup lessons: up to 2 per month, valid until end_of_source_month; the office books them.',
      'Freezing a place: charged in full.',
    ]);
    expect(policyFacts({ makeup: { enabled: false } })).toEqual(['Makeup lessons: not offered.']);
    expect(policyFacts({ makeup: { enabled: true } })).toEqual([]);
  });
});

describe('botSystem', () => {
  it('lists the rules and the knowledge with ids', () => {
    const s = botSystem({
      school: 'R-SWIM',
      today: '2026-10-08',
      guardian: 'מיכל',
      children: ['נועה', 'איתי'],
      facts: ['Monthly charge: on day 1 of the month.'],
      knowledge: [{ id: 'k1', question: 'איפה חונים?', answer: 'בחניון הקאנטרי' }],
    });
    expect(s).toContain('R-SWIM');
    expect(s).toContain('נועה, איתי');
    expect(s).toContain('- Monthly charge');
    expect(s).toContain('[k1] Q: איפה חונים?');
  });
  it('says so when nothing is set', () => {
    const s = botSystem({
      school: 'X',
      today: '2026-10-08',
      guardian: 'מיכל',
      children: [],
      facts: [],
      knowledge: [],
    });
    expect(s).toContain('none listed');
    expect(s).toContain('- (none set)');
    expect(s).toContain('- (empty)');
  });
});

describe('learned answers', () => {
  it('keeps the words that carry meaning, without a Hebrew prefix letter', () => {
    expect([...keywords('היי, איפה חונים ליד הבריכה? ו')]).toEqual([
      'איפה',
      'חונים',
      'ליד',
      'בריכה',
    ]);
    // A prefix is dropped only from longer words, and a stop word left after it is dropped too.
    expect([...keywords('הים שלי ושלי')]).toEqual(['הים']);
  });
  it('matches a message to the entries whose question it covers, best first', () => {
    const entries = [
      { id: 'park', question: 'איפה חונים ליד הבריכה?' },
      { id: 'bring', question: 'מה צריך להביא לשיעור?' },
      { id: 'empty', question: 'מה?' },
    ];
    expect(matchKnowledge('שלום, איפה חונים ליד הבריכה בגוש?', entries).map((e) => e.id)).toEqual([
      'park',
    ]);
    expect(matchKnowledge('מה להביא לשיעור?', entries).map((e) => e.id)).toEqual(['bring']);
    expect(matchKnowledge('איפה חונים?', entries)).toEqual([]);
    expect(matchKnowledge('איפה חונים?', entries, 0.3).map((e) => e.id)).toEqual(['park']);
    expect(matchKnowledge('איפה חונים ומה להביא לשיעור', entries, 0.3).map((e) => e.id)).toEqual([
      'bring',
      'park',
    ]);
  });
});

describe('fakeBotIntent', () => {
  it('reads a few fixed words', () => {
    expect(fakeBotIntent('מתי ההשלמה של נועה?')).toBe('makeups');
    expect(fakeBotIntent('כמה אני חייבת?')).toBe('balance');
    expect(fakeBotIntent('מתי השיעור הבא?')).toBe('lessons');
    expect(fakeBotIntent('איפה חונים?')).toBe('other');
  });
});
