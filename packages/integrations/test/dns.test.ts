import { describe, expect, it } from 'vitest';
import { FakeDnsResolver, SystemDnsResolver } from '../src/dns';

describe('DNS resolvers', () => {
  it('answers from set records, then from the lookup, else nothing', async () => {
    const dns = new FakeDnsResolver(async (name) => (name === 'b' ? [['x']] : []));
    dns.set('a', 'one');
    dns.set('a', 'two');
    expect(await dns.resolveTxt('a')).toEqual([['one'], ['two']]);
    expect(await dns.resolveTxt('b')).toEqual([['x']]);
    expect(await new FakeDnsResolver().resolveTxt('a')).toEqual([]);
  });

  it('returns no records for a name that does not resolve', async () => {
    expect(await new SystemDnsResolver().resolveTxt('_rswim.nothing.invalid')).toEqual([]);
  });
});
