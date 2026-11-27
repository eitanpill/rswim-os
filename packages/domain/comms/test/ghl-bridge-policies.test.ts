/** The GHL bridge's pure rules: what one read of a GHL conversation brings in, and what shadow mode holds back. */
import { describe, expect, it } from 'vitest';
import { GHL_SETTLE_MS, ghlPullPlan, shadowHolds, type GhlPullMessage } from '../src/policies';

const connectedAt = new Date('2026-11-27T08:00:00Z');
const now = new Date('2026-11-27T10:00:00Z');
const at = (min: number) => new Date(now.getTime() - min * 60_000);
const msg = (
  id: string,
  direction: 'inbound' | 'outbound',
  min: number,
  extra: Partial<GhlPullMessage> = {},
): GhlPullMessage => ({
  id,
  direction,
  whatsapp: true,
  body: id,
  at: at(min),
  userId: null,
  ...extra,
});
const plan = (messages: GhlPullMessage[], known: string[] = [], ourTexts: string[] = []) =>
  ghlPullPlan({
    messages,
    known: new Set(known),
    ourTexts: new Set(ourTexts),
    connectedAt,
    now,
  });

describe('ghlPullPlan', () => {
  it('brings in the person’s new WhatsApp messages oldest first, once', () => {
    const p = plan(
      [msg('b', 'inbound', 5), msg('a', 'inbound', 10), msg('old', 'inbound', 6)],
      ['old'],
    );
    expect(p.inbound.map((m) => m.id)).toEqual(['a', 'b']);
    expect(p.foreign).toEqual([]);
    expect(p.deferred).toBe(0);
  });

  it('leaves other channels and everything said before the connection alone', () => {
    const p = plan([
      msg('sms', 'inbound', 5, { whatsapp: false }),
      msg('history', 'inbound', 180),
      msg('history-out', 'outbound', 179),
    ]);
    expect(p.inbound).toEqual([]);
    expect(p.foreign).toEqual([]);
  });

  it('knows our own answers by id and by text', () => {
    const p = plan(
      [
        msg('in', 'inbound', 10),
        msg('ours-id', 'outbound', 9),
        msg('ours-text', 'outbound', 8, { body: ' שלום ' }),
      ],
      ['ours-id'],
      ['שלום'],
    );
    expect(p.inbound.map((m) => m.id)).toEqual(['in']);
    expect(p.foreign).toEqual([]);
  });

  it('marks someone else’s answer right after the person wrote as a reply', () => {
    const p = plan([msg('in', 'inbound', 10), msg('old-bot', 'outbound', 9, { userId: 'u1' })]);
    expect(p.foreign).toMatchObject([{ id: 'old-bot', reply: true, userId: 'u1' }]);
  });

  it('keeps an automation long after the last message as foreign, not a reply', () => {
    const p = plan([msg('in', 'inbound', 100), msg('reminder', 'outbound', 30)]);
    expect(p.foreign).toMatchObject([{ id: 'reminder', reply: false }]);
  });

  it('waits on an answer too fresh to judge', () => {
    const fresh = new Date(now.getTime() - GHL_SETTLE_MS / 2);
    const p = plan([msg('in', 'inbound', 1), { ...msg('fresh', 'outbound', 0), at: fresh }]);
    expect(p.deferred).toBe(1);
    expect(p.foreign).toEqual([]);
  });
});

describe('shadowHolds', () => {
  it('holds only a bot’s words, only in shadow mode', () => {
    expect(shadowHolds('shadow', 'bot:123')).toBe(true);
    expect(shadowHolds('shadow', 'agent.reply:1')).toBe(false);
    expect(shadowHolds('live', 'bot:123')).toBe(false);
    expect(shadowHolds(null, 'bot:123')).toBe(false);
  });
});
