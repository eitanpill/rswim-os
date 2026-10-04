import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { restWindow } from '@rswim/calendar';
import { DEFAULT_ORG_RULES, type Classification } from '@rswim/contracts';
import {
  classifyInbound,
  commsRulesFrom,
  enqueueDecision,
  holidayNotice,
  israelClock,
  israelInstant,
  israelLocalDateTime,
  matchesSegment,
  mentionedDate,
  renderTemplate,
  restWindowAt,
  sendDecision,
  templateVariables,
  triageDecision,
  type CommsRules,
} from '../src/policies';

const rules = commsRulesFrom(DEFAULT_ORG_RULES);

describe('commsRulesFrom', () => {
  it('reads the org rules', () => {
    expect(rules).toEqual({
      quietStart: '21:30',
      quietEnd: '08:00',
      blockRest: true,
      ratePerMinute: 20,
      holidayNoticeDaysBefore: 2,
      aiTriage: false,
      minConfidence: 80,
    });
  });
  it('falls back to the documented defaults', () => {
    expect(commsRulesFrom({})).toEqual(rules);
    expect(commsRulesFrom({ comms: {} })).toEqual(rules);
  });
});

describe('israel clock', () => {
  it('converts across daylight saving', () => {
    expect(israelInstant('2026-10-09', '12:00').toISOString()).toBe('2026-10-09T09:00:00.000Z');
    expect(israelInstant('2026-12-01', '12:00').toISOString()).toBe('2026-12-01T10:00:00.000Z');
    expect(israelClock(new Date('2026-12-01T19:45:00Z'))).toBe('21:45');
    expect(israelLocalDateTime(new Date('2026-12-01T22:15:00Z'))).toBe('2026-12-02T00:15');
  });
});

describe('sendDecision', () => {
  // 2026-10-09 is a plain Friday: candle lighting − 30 min is 17:04 local.
  const fridayNoon = israelInstant('2026-10-09', '12:00');
  const fridayEvening = israelInstant('2026-10-09', '17:30');
  const window = restWindow('2026-10-09')!;

  it('sends on a weekday afternoon', () => {
    expect(sendDecision(fridayNoon, rules)).toMatchObject({ action: 'send' });
  });

  it('holds a Friday evening message until after havdalah', () => {
    const d = sendDecision(fridayEvening, rules);
    expect(d).toMatchObject({ action: 'hold', reason: 'rest_window' });
    if (d.action !== 'hold') throw new Error('expected hold');
    expect(d.until.getTime()).toBe(window.end.getTime() + 60_000);
    expect(d.explanation.code).toBe('comms.decision.hold.rest_window');
    expect(restWindowAt(d.until)).toBeNull();
  });

  it('finds the window from inside Saturday too', () => {
    expect(restWindowAt(israelInstant('2026-10-10', '10:00'))).toEqual(window);
    expect(restWindowAt(fridayNoon)).toBeNull();
  });

  it('holds night messages until the morning, across midnight', () => {
    const late = sendDecision(israelInstant('2026-10-12', '22:00'), rules);
    expect(late).toMatchObject({ action: 'hold', reason: 'quiet_hours' });
    if (late.action === 'hold') expect(late.until).toEqual(israelInstant('2026-10-13', '08:00'));
    const early = sendDecision(israelInstant('2026-10-13', '06:00'), rules);
    if (early.action !== 'hold') throw new Error('expected hold');
    expect(early.until).toEqual(israelInstant('2026-10-13', '08:00'));
  });

  it('handles quiet hours that do not cross midnight, and none at all', () => {
    const lunch: CommsRules = { ...rules, quietStart: '13:00', quietEnd: '16:00' };
    const d = sendDecision(israelInstant('2026-10-12', '14:00'), lunch);
    if (d.action !== 'hold') throw new Error('expected hold');
    expect(d.until).toEqual(israelInstant('2026-10-12', '16:00'));
    expect(sendDecision(israelInstant('2026-10-12', '17:00'), lunch).action).toBe('send');
    const none: CommsRules = { ...rules, quietStart: '00:00', quietEnd: '00:00' };
    expect(sendDecision(israelInstant('2026-10-12', '23:59'), none).action).toBe('send');
  });

  it('chains a rest window that ends inside quiet hours', () => {
    // Shavuot 2027 runs into Shabbat; havdalah + 30 is about 20:57, inside quiet hours that start at 20:00.
    const strict: CommsRules = { ...rules, quietStart: '20:00' };
    const d = sendDecision(israelInstant('2027-06-11', '12:00'), strict);
    expect(d).toMatchObject({ action: 'hold', reason: 'rest_window' });
    if (d.action === 'hold') expect(d.until).toEqual(israelInstant('2027-06-13', '08:00'));
  });

  it('can be told not to block Shabbat', () => {
    expect(sendDecision(fridayEvening, { ...rules, blockRest: false }).action).toBe('send');
  });

  it('never says send inside a rest window (property)', () => {
    const from = new Date('2026-01-01T00:00:00Z').getTime();
    const to = new Date('2028-12-31T00:00:00Z').getTime();
    fc.assert(
      fc.property(fc.integer({ min: from, max: to }), (ms) => {
        const at = new Date(ms);
        const d = sendDecision(at, rules);
        if (d.action === 'send') return restWindowAt(at) === null;
        return (
          d.until > at &&
          restWindowAt(d.until) === null &&
          sendDecision(d.until, rules).action === 'send'
        );
      }),
      { numRuns: 300 },
    );
  });
});

describe('templates', () => {
  it('lists and fills variables', () => {
    const body = 'שלום {{ guardian_name }}, {{student_name}} רשום/ה. {{guardian_name}}';
    expect(templateVariables(body)).toEqual(['guardian_name', 'student_name']);
    expect(renderTemplate(body, { guardian_name: 'רותם', student_name: 'דניאל' })).toEqual({
      ok: true,
      text: 'שלום רותם, דניאל רשום/ה. רותם',
    });
    expect(renderTemplate('סה״כ {{amount}}', { amount: 0 })).toEqual({ ok: true, text: 'סה״כ 0' });
  });
  it('refuses to send half-filled', () => {
    expect(renderTemplate('{{a}} {{b}} {{c}}', { a: 'x', b: '', c: null })).toEqual({
      ok: false,
      missing: ['b', 'c'],
    });
  });
});

describe('enqueueDecision', () => {
  const ok = {
    optedIn: true,
    phoneE164: '+972500000001',
    templateActive: true,
    render: { ok: true, text: 'היי' },
  } as const;
  it('queues a complete message', () => {
    expect(enqueueDecision(ok)).toMatchObject({ status: 'queued', text: 'היי' });
  });
  it('blocks with a reason, keeping the text when there is one', () => {
    expect(enqueueDecision({ ...ok, templateActive: false })).toMatchObject({
      status: 'blocked',
      reason: 'template_inactive',
      text: 'היי',
    });
    expect(enqueueDecision({ ...ok, optedIn: false })).toMatchObject({ reason: 'opted_out' });
    expect(enqueueDecision({ ...ok, phoneE164: null })).toMatchObject({ reason: 'no_phone' });
    const missing = enqueueDecision({ ...ok, render: { ok: false, missing: ['amount'] } });
    expect(missing).toMatchObject({ reason: 'missing_variable', text: null });
    expect(missing.explanation.params).toEqual({ missing: 'amount' });
  });
});

describe('mentionedDate', () => {
  const today = '2026-10-07'; // Wednesday
  it('reads relative days', () => {
    expect(mentionedDate('לא יגיע היום', today)).toBe(today);
    expect(mentionedDate('הערב לא', today)).toBe(today);
    expect(mentionedDate('מחר', today)).toBe('2026-10-08');
    expect(mentionedDate('מחרתיים', today)).toBe('2026-10-09');
  });
  it('reads weekdays', () => {
    expect(mentionedDate('ביום ראשון', today)).toBe('2026-10-11');
    expect(mentionedDate('ביום רביעי', today)).toBe(today);
    expect(mentionedDate('יום חמישי', today)).toBe('2026-10-08');
  });
  it('reads dates', () => {
    expect(mentionedDate('ב-12.10', today)).toBe('2026-10-12');
    expect(mentionedDate('ב 12/10/27', today)).toBe('2027-10-12');
    expect(mentionedDate('ב 12/10/2027', today)).toBe('2027-10-12');
    expect(mentionedDate('ב 3.1', '2026-12-20')).toBe('2027-01-03');
    expect(mentionedDate('31.2', today)).toBeNull();
    expect(mentionedDate('40.40', today)).toBeNull();
    expect(mentionedDate('שלום', today)).toBeNull();
  });
});

describe('classifyInbound', () => {
  const today = '2026-10-07';
  const daniel = { id: '00000000-0000-4000-8000-00000000000d', firstName: 'דניאל' };
  const noa = { id: '00000000-0000-4000-8000-00000000000a', firstName: 'נועה' };
  const family = { students: [daniel, noa], today, known: true };

  it('turns "דניאל לא יגיע היום" into a confident absence for Daniel today', () => {
    expect(classifyInbound('דניאל לא יגיע היום', family)).toEqual({
      intent: 'absence_notice',
      confidence: 100,
      studentIds: [daniel.id],
      date: today,
      classifier: 'rules-v1',
      signals: ['intent:absence_notice', 'student:named', `date:${today}`],
    });
  });

  it('matches names with prefixes and niqqud, and siblings together', () => {
    const c = classifyInbound('שלום, לנוֹעָה ודניאל יש חום, הם חולים מחר', family);
    expect(c.intent).toBe('absence_notice');
    expect(c.studentIds).toEqual([daniel.id, noa.id]);
    expect(c.date).toBe('2026-10-08');
    expect(classifyInbound('כדניאלה', family).studentIds).toEqual([]);
  });

  it('assumes the only child when none is named', () => {
    const c = classifyInbound('הוא לא יגיע היום', { students: [daniel], today, known: true });
    expect(c.studentIds).toEqual([daniel.id]);
    expect(c.signals).toContain('student:only_child');
    expect(c.confidence).toBe(90);
  });

  it('keeps absence + makeup together, but marks unrelated asks as mixed', () => {
    expect(classifyInbound('דניאל לא יגיע היום, אפשר השלמה?', family).confidence).toBe(100);
    const mixed = classifyInbound('דניאל לא יגיע היום, ומתי תגיע הקבלה?', family);
    expect(mixed.intent).toBe('absence_notice');
    expect(mixed.confidence).toBe(85);
    expect(mixed.signals).toContain('mixed');
  });

  it.each([
    ['אני מאוד לא מרוצה מהיחס', 'complaint'],
    ['אנחנו רוצים לבטל את המנוי', 'cancellation_request'],
    ['אפשר להקפיא לחודש?', 'freeze_request'],
    ['אפשר לקבוע השלמה לנועה?', 'makeup_request'],
    ['אפשר קבלה על ספטמבר?', 'receipt_request'],
    ['למה חויבנו פעמיים?', 'payment_question'],
    ['באיזו שעה השיעור?', 'schedule_question'],
    ['מעוניינת בשיעור ניסיון', 'lead'],
    ['חג שמח!', 'personal_other'],
  ])('classifies %s as %s', (text, intent) => {
    expect(classifyInbound(text, family).intent).toBe(intent);
  });

  it('treats unknown senders asking about times or prices as leads', () => {
    const stranger = { students: [], today, known: false };
    expect(classifyInbound('באיזו שעה יש שיעורים לגיל 5?', stranger).intent).toBe('lead');
    expect(classifyInbound('כמה התשלום לחודש?', stranger).intent).toBe('lead');
    expect(classifyInbound('הוא לא יגיע', stranger)).toMatchObject({
      intent: 'absence_notice',
      studentIds: [],
      confidence: 60,
    });
    expect(classifyInbound('תודה', stranger)).toMatchObject({
      intent: 'personal_other',
      confidence: 50,
    });
  });

  it('marks staff messages, unless they complain', () => {
    const staff = { students: [], today, known: false, isStaff: true };
    expect(classifyInbound('אני מאחרת בעשר דקות', staff)).toMatchObject({
      intent: 'instructor_message',
      confidence: 70,
    });
    expect(classifyInbound('יש לי תלונה על הבריכה', staff).intent).toBe('complaint');
  });

  it('never exceeds 100 or goes below 0', () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        const c = classifyInbound(text, family);
        return c.confidence >= 0 && c.confidence <= 100;
      }),
    );
  });
});

describe('triageDecision', () => {
  const base: Classification = {
    intent: 'absence_notice',
    confidence: 100,
    studentIds: ['00000000-0000-4000-8000-00000000000d'],
    date: '2026-10-07',
    classifier: 'rules-v1',
    signals: [],
  };
  it('drafts a one-tap absence', () => {
    expect(triageDecision(base, rules)).toMatchObject({ route: 'action', kind: 'absence_notice' });
    expect(
      triageDecision({ ...base, intent: 'receipt_request', studentIds: [] }, rules),
    ).toMatchObject({
      route: 'action',
      kind: 'receipt_request',
    });
  });
  it('always sends complaints and cancellations to a person', () => {
    expect(triageDecision({ ...base, intent: 'complaint' }, rules).route).toBe('human');
    const c = triageDecision({ ...base, intent: 'cancellation_request' }, rules);
    expect(c).toMatchObject({ route: 'human' });
    expect(c.explanation.code).toBe('comms.decision.triage.always_human.cancellation_request');
  });
  it('sends unsure or incomplete requests to a person', () => {
    expect(triageDecision({ ...base, confidence: 79 }, rules)).toMatchObject({ route: 'human' });
    const d = triageDecision({ ...base, studentIds: [] }, rules);
    expect(d.explanation.code).toBe('comms.decision.triage.no_student');
  });
  it('leaves questions and personal messages in the inbox, with no automatic reply', () => {
    for (const intent of [
      'personal_other',
      'lead',
      'schedule_question',
      'payment_question',
      'instructor_message',
    ] as const) {
      expect(triageDecision({ ...base, intent }, rules).route).toBe('review');
    }
  });
});

describe('holidayNotice', () => {
  it('announces Pesach two days ahead, through the end of the stretch', () => {
    expect(holidayNotice('2027-04-19', 2)).toEqual({
      start: '2027-04-21',
      end: '2027-04-28',
      resumeOn: '2027-04-29',
    });
    expect(holidayNotice('2027-04-18', 2)).toBeNull();
    expect(holidayNotice('2027-04-19', 0)).toBeNull();
  });
  it('does not announce a plain Shabbat or a stretch already under way', () => {
    expect(holidayNotice('2026-10-07', 3)).toBeNull();
    expect(holidayNotice('2027-04-22', 2)).toBeNull();
  });
});

describe('matchesSegment', () => {
  const r = { venueIds: ['v1'], groupIds: ['g1', 'g2'], programIds: ['p1'], owing: false };
  const all = { venueIds: [], groupIds: [], programIds: [], owing: false };
  it('matches every set filter', () => {
    expect(matchesSegment(r, all)).toBe(true);
    expect(matchesSegment(r, { ...all, venueIds: ['v1', 'v9'], groupIds: ['g2'] })).toBe(true);
    expect(matchesSegment(r, { ...all, programIds: ['p2'] })).toBe(false);
    expect(matchesSegment(r, { ...all, owing: true })).toBe(false);
    expect(matchesSegment({ ...r, owing: true }, { ...all, owing: true })).toBe(true);
  });
});

describe('message words', () => {
  it('names days and months', async () => {
    const { messageDate, messagePeriod } = await import('../src/policies');
    expect(messageDate('2026-10-07', 'he')).toBe('יום רביעי 7.10');
    expect(messageDate('2026-10-07', 'en')).toBe('Wednesday 7.10');
    expect(messagePeriod('2026-10')).toBe('10/2026');
  });
});
