import { describe, expect, it } from 'vitest';
import { passToken, verifyPass, type PassData } from './pass';

const key = Buffer.alloc(32, 7);
const data: PassData = {
  s: 'R-SWIM (דמו)',
  c: 'יואב',
  g: 'בנים דולפין',
  v: 'בריכת ירושלים',
  d: '2026-10-06',
  t: '16:00',
  n: 1,
};

describe('companion pass', () => {
  it('is valid on the lesson date only', () => {
    const token = passToken(data, key);
    expect(verifyPass(token, key, '2026-10-06')).toEqual({ valid: true, data });
    expect(verifyPass(token, key, '2026-10-07')).toMatchObject({ valid: false, reason: 'expired' });
    expect(verifyPass(token, key, '2026-10-05')).toMatchObject({ valid: false, reason: 'early' });
  });

  it('refuses a changed pass or another key', () => {
    const token = passToken(data, key);
    const [, sig] = token.split('.');
    const more = Buffer.from(JSON.stringify({ ...data, n: 5 })).toString('base64url');
    expect(verifyPass(`${more}.${sig}`, key, '2026-10-06')).toMatchObject({ reason: 'forged' });
    expect(verifyPass(token, Buffer.alloc(32, 8), '2026-10-06')).toMatchObject({
      reason: 'forged',
    });
    expect(verifyPass('garbage', key, '2026-10-06')).toMatchObject({ reason: 'forged' });
    const junk = Buffer.from('not json').toString('base64url');
    expect(verifyPass(`${junk}.x`, key, '2026-10-06')).toMatchObject({ reason: 'forged' });
  });
});
