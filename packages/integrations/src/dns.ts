import { resolveTxt } from 'node:dns/promises';
import type { DnsResolver } from './index';

/** Public DNS through the operating system's resolver. */
export class SystemDnsResolver implements DnsResolver {
  async resolveTxt(name: string): Promise<string[][]> {
    try {
      return await resolveTxt(name);
    } catch {
      return [];
    }
  }
}

/** In-memory DNS for tests and local demos: records set by name, or answered by a lookup function. */
export class FakeDnsResolver implements DnsResolver {
  private readonly records = new Map<string, string[][]>();

  constructor(private readonly lookup?: (name: string) => Promise<string[][]>) {}

  set(name: string, value: string): void {
    this.records.set(name, [...(this.records.get(name) ?? []), [value]]);
  }

  async resolveTxt(name: string): Promise<string[][]> {
    return this.records.get(name) ?? (this.lookup ? await this.lookup(name) : []);
  }
}
