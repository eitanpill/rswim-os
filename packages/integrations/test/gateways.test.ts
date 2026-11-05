import { describe, expect, it } from 'vitest';
import { agorot } from '@rswim/money';
import {
  createGateway,
  credentialHints,
  gatewaySandbox,
  GatewayNotLiveError,
  invalidCredentialField,
  SANDBOX_SIGNATURE_HEADER,
  signSandboxEvent,
} from '../src';

const GROW = { userId: 'demo-user-1', pageCode: 'demo-page-1', apiKey: 'demo-key-123456' };

describe('payment gateways', () => {
  it('never runs the demo processor (or a processor without a live adapter) outside a sandbox', () => {
    expect(() =>
      createGateway('fake', { merchantId: 'm1' }, { webhookSecret: 's', sandbox: false }),
    ).toThrow(GatewayNotLiveError);
    expect(() => createGateway('grow', GROW, { webhookSecret: 's', sandbox: false })).toThrow(
      GatewayNotLiveError,
    );
    expect(gatewaySandbox({})).toBe(false);
    expect(gatewaySandbox({ RSWIM_GROW_FAKE: '1' })).toBe(true);
    expect(gatewaySandbox({ RSWIM_DEMO_MODE: '1' })).toBe(true);
  });

  it('checks and masks credentials', () => {
    expect(invalidCredentialField('grow', GROW)).toBeNull();
    expect(invalidCredentialField('grow', { ...GROW, apiKey: 'x' })).toBe('apiKey');
    expect(invalidCredentialField('cardcom', { terminalNumber: 'abc' })).toBe('terminalNumber');
    expect(credentialHints('grow', GROW)).toEqual({
      userId: 'demo-user-1',
      pageCode: 'demo-page-1',
      apiKey: '••••3456',
    });
  });

  it('opens a hosted checkout and reads only callbacks signed with its secret', async () => {
    const g = createGateway('grow', GROW, { webhookSecret: 'secret-1', sandbox: true });
    expect(await g.testConnection()).toEqual({ ok: true });
    const failing = createGateway(
      'grow',
      { ...GROW, apiKey: 'demo-fail-key' },
      { webhookSecret: 's', sandbox: true },
    );
    expect(await failing.testConnection()).toEqual({ ok: false, reason: 'auth_failed' });
    const req = {
      reference: '00000000-0000-4000-8000-000000000001',
      method: 'bit' as const,
      amount: agorot(1000),
      description: 'x',
      customer: { name: 'דמו' },
      successUrl: 'https://a.test/ok',
      cancelUrl: 'https://a.test/no',
      notifyUrl: 'https://a.test/hook',
      sandboxUrl: 'https://a.test/pay/t/sandbox',
    };
    const s1 = await g.createCheckout({ organizationId: 'o', idempotencyKey: 'k1' }, req);
    const s2 = await g.createCheckout({ organizationId: 'o', idempotencyKey: 'k1' }, req);
    expect(s1).toEqual(s2);
    expect(s1.redirectUrl).toBe(`https://a.test/pay/t/sandbox?m=bit&x=${s1.externalId}`);

    const body = JSON.stringify({
      eventId: 'e1',
      type: 'checkout.paid',
      reference: req.reference,
      externalPaymentId: 'p1',
      method: 'bit',
      amountAgorot: 1000,
      occurredAt: '2026-11-04T10:00:00+02:00',
    });
    const signed = new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(body, 'secret-1') });
    expect(await g.readWebhook(body, signed)).toMatchObject({ eventId: 'e1', method: 'bit' });
    const forged = new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(body, 'other') });
    expect(await g.readWebhook(body, forged)).toBeNull();
    expect(await g.readWebhook(body, new Headers())).toBeNull();
    const bad = '{"not":"an event"}';
    expect(
      await g.readWebhook(
        bad,
        new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(bad, 'secret-1') }),
      ),
    ).toBeNull();
    const notJson = 'nope';
    expect(
      await g.readWebhook(
        notJson,
        new Headers({ [SANDBOX_SIGNATURE_HEADER]: signSandboxEvent(notJson, 'secret-1') }),
      ),
    ).toBeNull();
  });
});
