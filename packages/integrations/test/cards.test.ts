import { describe, expect, it } from 'vitest';
import { platformCardVault, SandboxCardVault, signCardEvent } from '../src/cards';

const event = {
  eventId: 'evt-1',
  type: 'card.saved' as const,
  reference: '6f1c1f9e-6a43-4d55-9d43-1f0f3c1f2a10',
  mandateId: 'sbx_card_1234',
  cardLast4: '4242',
  occurredAt: '2026-12-04T08:00:00+02:00',
};

describe('the platform card vault', () => {
  it('runs only in a sandboxed process', () => {
    expect(platformCardVault({})).toBeNull();
    expect(platformCardVault({ RSWIM_GROW_FAKE: '1' })).toBeInstanceOf(SandboxCardVault);
  });

  it('sends the owner to its card page with the setup it made', async () => {
    const vault = new SandboxCardVault('s3cret');
    const out = await vault.createCardSetup(
      { organizationId: 'org', idempotencyKey: 'card-setup:1' },
      {
        reference: event.reference,
        customer: { name: 'גלים' },
        successUrl: 'http://x.localhost/ok',
        cancelUrl: 'http://x.localhost/no',
        notifyUrl: 'http://x.localhost/api/webhooks/platform-card',
        sandboxUrl: 'http://x.localhost/billing/card/1/sandbox',
      },
    );
    expect(out.externalId).toMatch(/^sbx_setup_[0-9a-f]{16}$/);
    expect(new URL(out.redirectUrl).searchParams.get('x')).toBe(out.externalId);
  });

  it('reads a callback signed with its secret and refuses any other', async () => {
    const vault = new SandboxCardVault('s3cret');
    const { body, headers } = vault.signedEvent(event);
    expect(await vault.readCardWebhook(body, headers)).toEqual(event);
    // Another secret, a tampered body, a missing or malformed signature, a body that is not an event.
    expect(await new SandboxCardVault('other').readCardWebhook(body, headers)).toBeNull();
    expect(await vault.readCardWebhook(body.replace('4242', '1111'), headers)).toBeNull();
    expect(await vault.readCardWebhook(body, new Headers())).toBeNull();
    expect(
      await vault.readCardWebhook(body, new Headers({ 'x-rswim-card-signature': 'nope' })),
    ).toBeNull();
    for (const raw of ['not json', JSON.stringify({ ...event, cardLast4: '42' })]) {
      const h = new Headers({ 'x-rswim-card-signature': signCardEvent(raw, 's3cret') });
      expect(await vault.readCardWebhook(raw, h)).toBeNull();
    }
  });
});
