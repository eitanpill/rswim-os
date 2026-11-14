import 'server-only';
import { noteCardSetupExternalId, openCardSetup } from '@rswim/domain-platform';
import { platformCardVault, SandboxCardVault, type CardSetupEvent } from '@rswim/integrations';
import { isDemoMode } from './auth/dev';
import { withControlPlane } from './db';
import { requestOrigin } from './payments';

/**
 * The platform's card vault in the web app (SaaS stage 3). The demo vault (local, E2E, the live demo) plays the
 * processor on our own page; outside a sandboxed process there is none until the platform's Grow adapter is live,
 * and the owner is told saving a card is not open yet.
 */
export function cardVault() {
  return platformCardVault(isDemoMode() ? { ...process.env, RSWIM_DEMO_MODE: '1' } : process.env);
}

/** Opens a card setup for the owner's school and returns the processor's page, or null when no vault is live. */
export async function startCardSetup(back: string): Promise<string | null> {
  const vault = cardVault();
  if (!vault) return null;
  const origin = await requestOrigin();
  return withControlPlane(async (tx, ctx, session) => {
    const id = await openCardSetup(tx, { orgId: ctx.orgId, userId: session.userId });
    const page = await vault.createCardSetup(
      { organizationId: ctx.orgId, idempotencyKey: `card-setup:${id}` },
      {
        reference: id,
        customer: { name: session.orgName ?? session.displayName ?? '' },
        successUrl: `${origin}${back}${back.includes('?') ? '&' : '?'}card=saved`,
        cancelUrl: `${origin}${back}`,
        notifyUrl: `${origin}/api/webhooks/platform-card`,
        sandboxUrl: `${origin}/billing/card/${id}/sandbox?back=${encodeURIComponent(back)}`,
      },
    );
    await noteCardSetupExternalId(tx, id, page.externalId);
    return page.redirectUrl;
  });
}

/**
 * The demo card page's answer: the same signed callback a real processor would send, posted to the same webhook
 * route. Returns whether the route took it.
 */
export async function sandboxCardAnswer(setupId: string, approve: boolean, declinesLater: boolean) {
  const vault = cardVault();
  if (!(vault instanceof SandboxCardVault)) return false;
  const event: CardSetupEvent = {
    eventId: `sbx_evt_${setupId}`,
    type: approve ? 'card.saved' : 'card.failed',
    reference: setupId,
    ...(approve
      ? {
          // A card that saves fine but whose charges the demo processor declines (to show a failed payment).
          mandateId: `sbx_card_${declinesLater ? 'fail_' : ''}${setupId.slice(0, 8)}`,
          cardLast4: declinesLater ? '0002' : '4242',
        }
      : { failureReason: 'card_declined' }),
    occurredAt: new Date().toISOString(),
  };
  const signed = vault.signedEvent(event);
  const res = await fetch(`${await requestOrigin()}/api/webhooks/platform-card`, {
    method: 'POST',
    body: signed.body,
    headers: signed.headers,
    cache: 'no-store',
  });
  return res.ok;
}
