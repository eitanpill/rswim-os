import { describe, expect, it } from 'vitest';
import { metaParamsFrom, outboundShape, parseMetaWebhook, windowOpen } from '../src/policies';

describe('the 24-hour window', () => {
  const now = new Date('2026-11-20T12:00:00Z');
  it('is open for a day after the person last wrote', () => {
    expect(windowOpen(new Date('2026-11-19T12:00:01Z'), now)).toBe(true);
    expect(windowOpen(new Date('2026-11-19T12:00:00Z'), now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });

  const base = {
    window: true,
    open: false,
    locale: 'he' as const,
    meta: { name: 'trial_reminder_v1', params: ['guardian_name', 'date'] },
    vars: { guardian_name: 'דנה', date: '21/11' },
  };
  it('sends text inside the window or without one', () => {
    expect(outboundShape({ ...base, open: true })).toEqual({ kind: 'text' });
    expect(outboundShape({ ...base, window: false, meta: null })).toEqual({ kind: 'text' });
  });
  it('uses the approved template outside it, filled in order', () => {
    expect(outboundShape(base)).toEqual({
      kind: 'template',
      name: 'trial_reminder_v1',
      language: 'he',
      values: ['דנה', '21/11'],
    });
    expect(outboundShape({ ...base, meta: { name: 'x', params: [] }, vars: null })).toMatchObject({
      kind: 'template',
      values: [],
    });
  });
  it('blocks without a template or a variable it needs', () => {
    expect(outboundShape({ ...base, meta: null })).toMatchObject({
      kind: 'blocked',
      reason: 'outside_window',
      explanation: { code: 'comms.decision.blocked.outside_window' },
    });
    expect(outboundShape({ ...base, meta: { name: null, params: [] } })).toMatchObject({
      kind: 'blocked',
    });
    expect(outboundShape({ ...base, vars: { guardian_name: 'דנה', date: '' } })).toMatchObject({
      explanation: { code: 'comms.decision.blocked.outside_window_vars' },
    });
    expect(outboundShape({ ...base, vars: null })).toMatchObject({ kind: 'blocked' });
  });
});

describe('template variables', () => {
  const body = 'היי {{guardian_name}}, מחר ({{date}}) בשעה {{time}}';
  it("takes the owner's list when the text uses every name", () => {
    expect(metaParamsFrom('guardian_name, {{date}}  time', body)).toEqual({
      ok: true,
      params: ['guardian_name', 'date', 'time'],
    });
    expect(metaParamsFrom('', body)).toEqual({ ok: true, params: [] });
    expect(metaParamsFrom('guardian_name, venue', body)).toEqual({ ok: false, unknown: ['venue'] });
  });
});

describe('the Cloud API webhook', () => {
  const hook = (value: unknown, field = 'messages') => ({
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field, value }] }],
  });
  it('reads messages of every kind and the receipts', () => {
    const r = parseMetaWebhook(
      hook({
        metadata: { phone_number_id: '1234567' },
        messages: [
          {
            id: 'w1',
            from: '972501234567',
            timestamp: '1763640000',
            type: 'text',
            text: { body: 'היי' },
          },
          {
            id: 'w2',
            from: '972501234567',
            timestamp: '1763640000',
            type: 'button',
            button: { text: 'כן' },
          },
          {
            id: 'w3',
            from: '972501234567',
            timestamp: '1763640000',
            type: 'interactive',
            interactive: { button_reply: { title: 'מחר' } },
          },
          {
            id: 'w4',
            from: '972501234567',
            timestamp: '1763640000',
            type: 'interactive',
            interactive: { list_reply: { title: '17:00' } },
          },
          { id: 'w5', from: '972501234567', timestamp: '1763640000', type: 'image' },
          { id: 'bad', from: 'x', timestamp: '1', type: 'text' },
        ],
        statuses: [
          { id: 's1', status: 'delivered', timestamp: '1763640000' },
          {
            id: 's2',
            status: 'failed',
            timestamp: '1763640000',
            errors: [{ code: 131047, title: 'Re-engagement' }],
          },
          { id: 's3', status: 'failed', timestamp: '1763640000', errors: [{}] },
          { id: 's4', status: 'deleted', timestamp: '1763640000' },
          { id: 's5' },
        ],
      }),
    );
    expect(r.inbound.map((m) => m.text)).toEqual(['היי', 'כן', 'מחר', '17:00', '[image]']);
    expect(r.inbound[0]).toEqual({
      phoneNumberId: '1234567',
      id: 'w1',
      fromE164: '+972501234567',
      text: 'היי',
      at: new Date(1763640000 * 1000),
    });
    expect(r.receipts.map((x) => [x.id, x.status, x.error])).toEqual([
      ['s1', 'delivered', null],
      ['s2', 'failed', '131047 Re-engagement'],
      ['s3', 'failed', 'failed'],
    ]);
  });
  it('skips what is not a WhatsApp message change', () => {
    expect(parseMetaWebhook({ object: 'page' })).toEqual({ inbound: [], receipts: [] });
    expect(parseMetaWebhook(hook({}, 'account_update'))).toEqual({ inbound: [], receipts: [] });
    expect(parseMetaWebhook(hook({}))).toEqual({ inbound: [], receipts: [] });
  });
});
