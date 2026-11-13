import { describe, expect, it } from 'vitest';
import { joinPathFromLink } from './join-link';

describe('joinPathFromLink', () => {
  it('reads a join link on any host', () => {
    expect(joinPathFromLink('https://aqua-swim.co.il/join/galim')).toBe('/join/galim');
    expect(joinPathFromLink('  https://galim.aqua-swim.co.il/join/Galim/  ')).toBe('/join/galim');
    expect(joinPathFromLink('aqua-swim.co.il/join/eilat-dive')).toBe('/join/eilat-dive');
    expect(joinPathFromLink('/join/eilat-dive?utm=wa')).toBe('/join/eilat-dive');
  });

  it('reads a staff invite', () => {
    const token = 'AbCdEf0123456789_-xyz';
    expect(joinPathFromLink(`https://x.co/invite/${token}`)).toBe(`/invite/${token}`);
  });

  it('refuses anything else', () => {
    for (const bad of [
      '',
      'hello',
      'https://evil.example/admin',
      'https://x.co/join/',
      'https://x.co/join/a/b',
      'https://x.co/join/bad_slug!',
      'https://x.co/invite/short',
      'javascript:alert(1)',
    ])
      expect(joinPathFromLink(bad)).toBeNull();
  });
});
