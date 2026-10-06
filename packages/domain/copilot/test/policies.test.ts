import { describe, expect, it } from 'vitest';
import {
  actionStep,
  copilotGate,
  copilotSystem,
  fakeIntent,
  nextWeekday,
  parseProposal,
  proposalSummary,
} from '../src/policies';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('copilotGate', () => {
  it('lets only the owner in, with the policy on and a model configured', () => {
    expect(copilotGate({ enabled: true, owner: true, model: true })).toEqual({ ok: true });
    expect(copilotGate({ enabled: true, owner: false, model: true })).toEqual({
      ok: false,
      code: 'copilot.errors.ownerOnly',
    });
    expect(copilotGate({ enabled: false, owner: true, model: true })).toMatchObject({
      code: 'copilot.errors.disabled',
    });
    expect(copilotGate({ enabled: true, owner: true, model: false })).toMatchObject({
      code: 'copilot.errors.noModel',
    });
  });
});

describe('parseProposal', () => {
  it('accepts well-formed proposals of each kind', () => {
    expect(
      parseProposal('move_student', {
        studentId: A,
        fromGroupId: null,
        toGroupId: B,
        onDate: '2026-10-11',
      }),
    ).toEqual({
      ok: true,
      params: { studentId: A, fromGroupId: null, toGroupId: B, onDate: '2026-10-11' },
    });
    expect(parseProposal('message_family', { householdId: A, text: '  שלום  ' })).toEqual({
      ok: true,
      params: { householdId: A, text: 'שלום' },
    });
    expect(
      parseProposal('open_makeup_slots', {
        staffId: A,
        venueId: B,
        date: '2026-10-12',
        startsAt: '16:00',
        endsAt: '16:30',
      }).ok,
    ).toBe(true);
  });
  it('refuses anything off-shape instead of repairing it', () => {
    const bad = { ok: false, code: 'copilot.errors.badProposal' };
    expect(
      parseProposal('move_student', {
        studentId: A,
        fromGroupId: B,
        toGroupId: B,
        onDate: '2026-10-11',
      }),
    ).toEqual(bad);
    expect(
      parseProposal('move_student', {
        studentId: 'x',
        fromGroupId: null,
        toGroupId: B,
        onDate: '2026-10-11',
      }),
    ).toEqual(bad);
    expect(parseProposal('message_family', { householdId: A, text: ' ', extra: 1 })).toEqual(bad);
    expect(
      parseProposal('open_makeup_slots', {
        staffId: A,
        venueId: B,
        date: '2026-10-12',
        startsAt: '17:00',
        endsAt: '16:30',
      }),
    ).toEqual(bad);
  });
});

describe('proposalSummary', () => {
  it('describes each proposal from looked-up names', () => {
    expect(
      proposalSummary({
        kind: 'move_student',
        student: 'יואב',
        from: 'א',
        to: 'ב',
        date: '2026-10-11',
      }),
    ).toEqual({
      code: 'copilot.summary.move',
      params: { student: 'יואב', from: 'א', to: 'ב', date: '2026-10-11' },
    });
    expect(
      proposalSummary({
        kind: 'move_student',
        student: 'יואב',
        from: null,
        to: 'ב',
        date: '2026-10-11',
      }).code,
    ).toBe('copilot.summary.add');
    expect(proposalSummary({ kind: 'message_family', family: 'כהן', text: 'היי' }).code).toBe(
      'copilot.summary.message',
    );
    expect(
      proposalSummary({
        kind: 'open_makeup_slots',
        staff: 'דני',
        venue: 'ירושלים',
        date: '2026-10-12',
        from: '16:00',
        to: '16:30',
        capacity: 3,
      }),
    ).toMatchObject({ code: 'copilot.summary.slots', params: { capacity: 3 } });
  });
});

describe('actionStep', () => {
  it('confirms or dismisses a proposal once, and undoes only a confirmed move', () => {
    expect(actionStep({ status: 'proposed', kind: 'message_family' }, 'confirm')).toEqual({
      ok: true,
    });
    expect(actionStep({ status: 'confirmed', kind: 'message_family' }, 'dismiss')).toEqual({
      ok: false,
      code: 'copilot.errors.alreadyDecided',
    });
    expect(actionStep({ status: 'confirmed', kind: 'move_student' }, 'undo')).toEqual({ ok: true });
    expect(actionStep({ status: 'undone', kind: 'move_student' }, 'undo')).toMatchObject({
      code: 'copilot.errors.notConfirmed',
    });
    expect(actionStep({ status: 'confirmed', kind: 'message_family' }, 'undo')).toMatchObject({
      code: 'copilot.errors.notUndoable',
    });
  });
});

describe('copilotSystem', () => {
  it('tells the model the school, the date and that nothing happens without the owner', () => {
    const s = copilotSystem({ today: '2026-10-06', school: 'R-SWIM דמו' });
    expect(s).toContain('R-SWIM דמו');
    expect(s).toContain('2026-10-06');
    expect(s).toContain('propose_');
  });
});

describe('fakeIntent', () => {
  it('understands the demo phrasings', () => {
    expect(fakeIntent('תעביר את יואב כהן לקבוצת מעורבת ראשון')).toEqual({
      kind: 'move',
      splits: [{ student: 'יואב כהן', group: 'מעורבת ראשון' }],
      date: null,
    });
    expect(fakeIntent('תעביר את יואב לוי לקבוצה מעורבת')).toEqual({
      kind: 'move',
      splits: [
        { student: 'יואב', group: 'וי לקבוצה מעורבת' },
        { student: 'יואב לוי', group: 'מעורבת' },
      ],
      date: null,
    });
    expect(fakeIntent('העבר את נועה למבוגרים גוש מ-2026-10-12.')).toEqual({
      kind: 'move',
      splits: [{ student: 'נועה', group: 'מבוגרים גוש' }],
      date: '2026-10-12',
    });
    expect(fakeIntent('תשלח להורים של יואב: השיעור מחר מתחיל ב-17:00')).toEqual({
      kind: 'message',
      student: 'יואב',
      text: 'השיעור מחר מתחיל ב-17:00',
    });
    expect(fakeIntent('תפתח השלמות עם דני ב-2026-10-13 16:00-16:30')).toEqual({
      kind: 'slots',
      staff: 'דני',
      date: '2026-10-13',
      from: '16:00',
      to: '16:30',
    });
    expect(fakeIntent('מי חייב לנו כסף?')).toEqual({ kind: 'debts' });
    expect(fakeIntent('מה יש היום')).toEqual({ kind: 'lessons', date: null });
    expect(fakeIntent('אילו שיעורים יש ב-2026-10-13')).toEqual({
      kind: 'lessons',
      date: '2026-10-13',
    });
    expect(fakeIntent('שלום')).toEqual({ kind: 'help' });
  });
});

describe('nextWeekday', () => {
  it('finds the next date on a weekday, today included', () => {
    expect(nextWeekday('2026-10-06', 2)).toBe('2026-10-06');
    expect(nextWeekday('2026-10-06', 0)).toBe('2026-10-11');
  });
});
