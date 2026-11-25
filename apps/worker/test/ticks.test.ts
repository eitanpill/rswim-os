import { describe, expect, it } from 'vitest';
import { tickCron } from '../src/ticks';

describe('tickCron', () => {
  it('runs every three minutes by default', () => {
    expect(tickCron(undefined)).toBe('*/3 * * * *');
  });
  it('takes the minutes from the environment', () => {
    expect(tickCron('1')).toBe('* * * * *');
    expect(tickCron('5')).toBe('*/5 * * * *');
  });
  it('falls back to the default on a value it cannot use', () => {
    for (const v of ['0', '-2', '2.5', 'abc', '45']) expect(tickCron(v)).toBe('*/3 * * * *');
  });
});
