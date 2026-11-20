import { describe, expect, it } from 'vitest';
import { diverBotSystem, fakeDiverIntent, pickedOption } from '../src/diver-bot-policies';

describe('diverBotSystem', () => {
  it('names the club, the diver, the rules and the knowledge', () => {
    const s = diverBotSystem({
      club: 'מועדון הכחול (דמו)',
      today: '2026-11-20',
      diver: 'נועם',
      facts: ['Payment is required to confirm a booking.'],
      knowledge: [{ id: 'k1', question: 'איפה חונים?', answer: 'בחניון הצפוני.' }],
    });
    expect(s).toContain('מועדון הכחול (דמו)');
    expect(s).toContain('נועם');
    expect(s).toContain('- Payment is required');
    expect(s).toContain('[k1] Q: איפה חונים?');
  });
  it('says so when there are no rules and no knowledge', () => {
    const s = diverBotSystem({ club: 'c', today: 't', diver: 'd', facts: [], knowledge: [] });
    expect(s).toContain('- (none set)');
    expect(s).toContain('- (empty)');
  });
});

describe('fakeDiverIntent', () => {
  it('reads a few fixed words', () => {
    expect(fakeDiverIntent('אילו טפסים חסרים לי?')).toBe('forms');
    expect(fakeDiverIntent('כמה נשאר לי בכרטיסייה?')).toBe('passes');
    expect(fakeDiverIntent('רוצה להזמין 2')).toBe('book');
    expect(fakeDiverIntent('מה פנוי השבוע?')).toBe('open');
    expect(fakeDiverIntent('מתי הצלילה הבאה שלי?')).toBe('dives');
    expect(fakeDiverIntent('יש לכם חליפות להשכרה?')).toBe('other');
  });
});

describe('pickedOption', () => {
  it('reads the number picked, within the list', () => {
    expect(pickedOption('להזמין 2', 3)).toBe(2);
    expect(pickedOption('1', 3)).toBe(1);
    expect(pickedOption('להזמין 3.', 3)).toBe(3);
    expect(pickedOption('להזמין 4', 3)).toBeNull();
    expect(pickedOption('להזמין 0', 3)).toBeNull();
    expect(pickedOption('להזמין צלילה', 3)).toBeNull();
  });
});
