import { describe, expect, it } from 'vitest';
import { toEnvelope } from '../src/functions/core-ping';

describe('toEnvelope', () => {
  it('rebuilds our envelope from an Inngest event', () => {
    const e = toEnvelope({
      id: '0190a3a0-0000-7000-8000-000000000001',
      name: 'core.ping',
      data: {
        organizationId: '0190a3a0-0000-7000-8000-000000000002',
        idempotencyKey: 'k',
        occurredAt: '2026-10-01T10:00:00.000Z',
        payload: { message: 'שלום' },
      },
    });
    expect(e).toMatchObject({ type: 'core.ping', payload: { message: 'שלום' } });
  });
  it('rejects events without an id (they cannot be deduplicated)', () => {
    expect(() =>
      toEnvelope({
        name: 'core.ping',
        data: { organizationId: 'x', idempotencyKey: 'k', occurredAt: 'x', payload: {} },
      }),
    ).toThrow();
  });
});
