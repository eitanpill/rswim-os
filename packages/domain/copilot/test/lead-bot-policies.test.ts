import { describe, expect, it } from 'vitest';
import {
  agesInWords,
  fakeClosingIntent,
  fakeLeadDetails,
  followUpFor,
  followUpText,
  knownFromSystem,
  parseChildBirth,
  fakeLeadIntent,
  leadBotRoute,
  leadBotSystem,
  LeadDetailsPatch,
  mergeLeadDetails,
  nextLeadQuestion,
  offerLines,
  shekels,
  wantsHuman,
} from '../src/lead-bot-policies';

const facts = {
  enabled: true,
  open: true,
  stage: 'new' as const,
  officeTalking: false,
  text: 'כמה עולה?',
};

describe('leadBotRoute', () => {
  it('skips when off, closed, joined or the office is talking', () => {
    expect(leadBotRoute({ ...facts, enabled: false })).toEqual({ route: 'skip', reason: 'off' });
    expect(leadBotRoute({ ...facts, open: false })).toEqual({ route: 'skip', reason: 'closed' });
    expect(leadBotRoute({ ...facts, stage: 'joined' })).toEqual({
      route: 'skip',
      reason: 'joined',
    });
    expect(leadBotRoute({ ...facts, officeTalking: true })).toEqual({
      route: 'skip',
      reason: 'office_talking',
    });
  });
  it('hands sensitive messages and requests for a person to the office', () => {
    expect(leadBotRoute({ ...facts, text: 'יש לו אסתמה' })).toEqual({
      route: 'handoff',
      reason: 'sensitive',
    });
    expect(leadBotRoute({ ...facts, text: 'אפשר נציג?' })).toEqual({
      route: 'handoff',
      reason: 'needs_action',
    });
    expect(leadBotRoute({ ...facts, stage: 'lost' })).toEqual({ route: 'ask' });
    expect(wantsHuman('call me please')).toBe(true);
  });
});

describe('details', () => {
  it('asks the next missing detail by kind of business', () => {
    expect(nextLeadQuestion('swim', { name: null, details: {} })).toBe('name');
    expect(nextLeadQuestion('swim', { name: 'מיכל', details: { child_age: '5' } })).toBe('area');
    expect(nextLeadQuestion('swim', { name: ' ', details: {} })).toBe('name');
    expect(
      nextLeadQuestion('swim', {
        name: 'מיכל',
        details: { child_age: '5', area: 'גילה', days: 'ב׳' },
      }),
    ).toBeNull();
    expect(nextLeadQuestion('freediving', { name: 'דן', details: { experience: 3 } })).toBe(
      'experience',
    );
  });
  it('validates and merges a patch', () => {
    expect(LeadDetailsPatch.safeParse({}).success).toBe(false);
    expect(LeadDetailsPatch.safeParse({ area: 'גילה' }).success).toBe(true);
    expect(
      mergeLeadDetails(
        { name: 'א', details: { area: 'x' } },
        { area: 'גילה', interest: 'תינוקות' },
      ),
    ).toEqual({ name: 'א', interest: 'תינוקות', details: { area: 'גילה' } });
    expect(mergeLeadDetails({ name: null, details: {} }, { name: 'דנה' })).toEqual({
      name: 'דנה',
      interest: null,
      details: {},
    });
  });
});

describe('offers', () => {
  it('words prices and ages', () => {
    expect(shekels(32000)).toBe('320 ₪');
    expect(shekels(32050)).toBe('320.50 ₪');
    expect(agesInWords(null, null)).toBeNull();
    expect(agesInWords(6, 36)).toBe('גילאי 0.5-3');
    expect(agesInWords(48, null)).toBe('מגיל 4');
    expect(agesInWords(null, 72)).toBe('עד גיל 6');
  });
  it('lines with and without open places', () => {
    expect(
      offerLines([
        {
          name: 'פעוטות',
          who: 'גילאי 2-4',
          prices: [{ label: 'חודשי', agorot: 30000 }],
          openings: ['יום ב׳ 17:00'],
        },
        { name: 'פרטי', who: null, prices: [], openings: [] },
      ]),
    ).toEqual([
      'פעוטות · גילאי 2-4 · חודשי 300 ₪ — פנוי: יום ב׳ 17:00',
      'פרטי — אין כרגע מקום פנוי',
    ]);
  });
});

describe('leadBotSystem', () => {
  const base = {
    business: 'בית ספר',
    vertical: 'swim' as const,
    today: '2026-11-20',
    city: 'ירושלים',
    lead: { name: 'מיכל', details: { child_age: '5', area: '' }, phone: '+972500000000' },
    next: 'area' as const,
    canBookTrial: true,
    facts: ['rule'],
    moduleFacts: ['rooms'],
    knowledge: [{ id: 'k1', question: 'q', answer: 'a' }],
  };
  it('tells the model what it knows, what to ask and what the business offers', () => {
    const s = leadBotSystem(base);
    expect(s).toContain("children's swim school in Israel (ירושלים)");
    expect(s).toContain('name: מיכל; child_age: 5.');
    expect(s).toContain('The next detail to ask for: area');
    expect(s).toContain('- rooms');
    expect(s).toContain('[k1]');
    expect(s).toContain('trial_options');
  });
  it('without facts, knowledge, modules or anything known', () => {
    const s = leadBotSystem({
      ...base,
      vertical: 'freediving',
      canBookTrial: false,
      city: null,
      lead: { name: null, details: {}, phone: '' },
      next: null,
      facts: [],
      moduleFacts: [],
      knowledge: [],
    });
    expect(s).toContain('a freediving club in Israel.');
    expect(s).toContain('nothing yet');
    expect(s).toContain('none, you have what you need');
    expect(s).toContain('- (none)');
    expect(s).toContain('- (empty)');
    expect(s).not.toContain('More the business offers');
    expect(s).not.toContain('trial_options');
    expect(s).toContain('join_link');
  });
});

describe('the stand-in', () => {
  it('reads the intent', () => {
    expect(fakeLeadIntent('כמה זה עולה לחודש בבקשה?')).toBe('price');
    expect(fakeLeadIntent('באילו ימים יש קבוצות לגיל שלוש?')).toBe('schedule');
    expect(fakeLeadIntent('איפה אתם נמצאים בדיוק בעיר?')).toBe('where');
    expect(fakeLeadIntent('שלום, רציתי לשאול משהו ארוך על החוגים')).toBe('greeting');
    expect(fakeLeadIntent('אני')).toBe('greeting');
    expect(fakeLeadIntent('רציתי לשאול אם הילד צריך להביא משקפת')).toBe('other');
  });
  it('takes stated details and the short answer to the question asked', () => {
    expect(fakeLeadDetails('קוראים לי מיכל לוי, הבת שלי בת 4', null)).toEqual({
      name: 'מיכל לוי',
      child_age: '4',
    });
    expect(fakeLeadDetails('ארבע וחצי', 'child_age')).toEqual({});
    expect(fakeLeadDetails('כמעט 5', 'child_age')).toEqual({ child_age: '5' });
    expect(fakeLeadDetails('דנה', 'name')).toEqual({ name: 'דנה' });
    expect(fakeLeadDetails('היי', 'name')).toEqual({});
    expect(fakeLeadDetails('גילה', 'area')).toEqual({ area: 'גילה' });
    expect(fakeLeadDetails('איפה זה?', 'area')).toEqual({});
    expect(fakeLeadDetails('שמי דן, בן 30', 'name')).toEqual({ name: 'דן', child_age: '30' });
    expect(fakeLeadDetails('שלום', null)).toEqual({});
  });
});

describe('the stand-in closes', () => {
  it('reads closing wishes, a child and what the bot knows', () => {
    expect(fakeClosingIntent(' 2 ')).toBe('choice');
    expect(fakeClosingIntent('אפשר שיעור ניסיון?')).toBe('trial');
    expect(fakeClosingIntent('שלחו לי קישור להרשמה')).toBe('join');
    expect(fakeClosingIntent('תודה')).toBeNull();
    expect(parseChildBirth('נועה 3.7.2020')).toEqual({ name: 'נועה', dob: '2020-07-03' });
    expect(parseChildBirth('12/03/2019')).toEqual({ name: null, dob: '2019-03-12' });
    expect(parseChildBirth('אין תאריך')).toEqual({ name: null, dob: null });
    expect(knownFromSystem('What you know about this person: name: דנה; child_age: 5.\nx')).toEqual(
      {
        name: 'דנה',
        child_age: '5',
      },
    );
    expect(knownFromSystem('What you know about this person: nothing yet.\n')).toEqual({});
    expect(knownFromSystem('no line')).toEqual({});
  });
});

describe('follow-up', () => {
  const quiet = {
    stage: 'talking' as const,
    quietDays: 3,
    weWroteLast: true,
    officeRecently: false,
    trial: null,
    done: [] as const,
  };
  it('nudges a quiet lead once, two to fourteen days after its last message', () => {
    expect(followUpFor(quiet)).toBe('silent');
    expect(followUpFor({ ...quiet, stage: 'new', quietDays: 14 })).toBe('silent');
    expect(followUpFor({ ...quiet, quietDays: 1 })).toBeNull();
    expect(followUpFor({ ...quiet, quietDays: 15 })).toBeNull();
    expect(followUpFor({ ...quiet, quietDays: null })).toBeNull();
    expect(followUpFor({ ...quiet, weWroteLast: false })).toBeNull();
    expect(followUpFor({ ...quiet, done: ['silent'] })).toBeNull();
    expect(followUpFor({ ...quiet, officeRecently: true })).toBeNull();
    expect(followUpFor({ ...quiet, stage: 'joined' })).toBeNull();
  });
  it('follows a trial up with an offer, or a new date when the child missed it', () => {
    const trial = { ...quiet, stage: 'trial_booked' as const };
    const t = (status: string, daysAgo: number) => ({ status, daysAgo });
    expect(followUpFor({ ...trial, trial: t('attended', 1) })).toBe('after_trial');
    expect(followUpFor({ ...trial, trial: t('booked', 7) })).toBe('after_trial');
    expect(followUpFor({ ...trial, trial: t('no_show', 2) })).toBe('missed_trial');
    expect(followUpFor({ ...trial, trial: t('attended', 0) })).toBeNull();
    expect(followUpFor({ ...trial, trial: t('attended', 8) })).toBeNull();
    expect(followUpFor({ ...trial, trial: t('cancelled', 2) })).toBeNull();
    expect(followUpFor({ ...trial, trial: null })).toBeNull();
    expect(followUpFor({ ...trial, trial: t('attended', 2), done: ['after_trial'] })).toBeNull();
  });
  it('words each follow-up', () => {
    const c = {
      name: 'רונית כהן',
      child: 'נועה',
      offerUntil: '2026-12-03',
      vertical: 'swim' as const,
    };
    expect(followUpText('after_trial', c)).toBe(
      'היי רונית, איך היה השיעור של נועה? 😊 אם בא לכם להמשיך, כתבו לנו כאן ונשריין לכם מקום בקבוצה. דמי שיעור הניסיון יקוזזו מהתשלום הראשון אם נרשמים עד 03/12/2026.',
    );
    expect(followUpText('after_trial', { ...c, offerUntil: null })).not.toContain('יקוזזו');
    expect(followUpText('missed_trial', { ...c, child: null })).toContain('ראינו שהילד/ה לא');
    expect(followUpText('silent', { ...c, name: null })).toMatch(/^היי, .*שיעור ניסיון\.$/);
    expect(followUpText('silent', { ...c, name: ' ', vertical: 'freediving' })).toContain(
      'צלילה ראשונה',
    );
  });
});
