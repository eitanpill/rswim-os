/**
 * Inngest refuses to register an app when any one function has more than ten triggers, and then runs nothing at all.
 * This keeps the worker registrable as automations are added.
 */
import { describe, expect, it } from 'vitest';
import { RESOLVERS } from '@rswim/domain-comms';
import { functions } from '../src/functions';
import { MAX_TRIGGERS } from '../src/functions/comms';

const triggersOf = (f: (typeof functions)[number]) =>
  (f as unknown as { opts: { triggers?: { event?: string; cron?: string }[] } }).opts.triggers ??
  [];
const idOf = (f: (typeof functions)[number]) => (f as unknown as { opts: { id: string } }).opts.id;

describe('worker functions', () => {
  it('each listen to at most ten triggers', () => {
    for (const f of functions)
      expect(triggersOf(f).length, idOf(f)).toBeLessThanOrEqual(MAX_TRIGGERS);
  });

  it('have unique ids', () => {
    const ids = functions.map(idOf);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('route every family-messaging event to exactly one automation function', () => {
    const automation = functions.filter((f) => idOf(f).startsWith('comms-automation'));
    const events = automation.flatMap((f) => triggersOf(f).map((t) => t.event));
    expect(events.sort()).toEqual(Object.keys(RESOLVERS).sort());
  });
});
