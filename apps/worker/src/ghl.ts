import { readFileSync } from 'node:fs';
import type { Tx } from '@rswim/db';
import { loadWhatsApp, recordWhatsAppError } from '@rswim/domain-comms';
import { ghlSettings, type TagMap } from '@rswim/domain-crm';
import {
  FakeGhlClient,
  FakeMessagingProvider,
  GhlMessagingProvider,
  HttpGhlClient,
  MetaApiError,
  MetaCloudMessagingProvider,
  type GhlClient,
  type GhlContact,
  type MessagingProvider,
} from '@rswim/integrations';

let fake: FakeGhlClient | undefined;

/**
 * The GHL client for an org, or null when GHL is not set up for it.
 * - GHL_API_TOKEN: the location's private integration token (kept in the worker's environment, never the database).
 * - RSWIM_GHL_FAKE=1: an in-memory GHL for local demos, loaded from RSWIM_GHL_FAKE_CONTACTS (a JSON file of fake
 *   contacts) when given. Never touches the real account.
 */
export async function ghlFor(
  tx: Tx,
  orgId: string,
): Promise<{ client: GhlClient; tagMap: TagMap } | null> {
  const settings = await ghlSettings(tx, orgId);
  if (!settings) return null;
  if (process.env.RSWIM_GHL_FAKE === '1') {
    fake ??= new FakeGhlClient(fakeContacts());
    return { client: fake, tagMap: settings.tagMap };
  }
  const token = process.env.GHL_API_TOKEN;
  if (!token) return null;
  return {
    client: new HttpGhlClient({ token, locationId: settings.locationId }),
    tagMap: settings.tagMap,
  };
}

function fakeContacts(): GhlContact[] {
  const file = process.env.RSWIM_GHL_FAKE_CONTACTS;
  if (!file) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { contacts: GhlContact[] }).contacts;
}

let fakeMessaging: FakeMessagingProvider | undefined;
let fakeCloud: FakeMessagingProvider | undefined;

/**
 * The messaging provider for an org, or null when none is set up.
 * - The business's own number on Meta's Cloud API when the owner connected one (WhatsApp track W5): free text inside
 *   the 24-hour window, approved templates outside it. A refused send is kept on the connection for the owner.
 * - RSWIM_MESSAGING_FAKE=1: in-memory WhatsApp for local demos and CI (with the window rules when a number is
 *   connected). Never touches a real account.
 * - Otherwise WhatsApp through the org's GHL location with GHL_API_TOKEN.
 */
export async function messagingFor(tx: Tx, orgId: string): Promise<MessagingProvider | null> {
  const own = await loadWhatsApp(tx, orgId);
  if (process.env.RSWIM_MESSAGING_FAKE === '1')
    return own
      ? (fakeCloud ??= new FakeMessagingProvider(true))
      : (fakeMessaging ??= new FakeMessagingProvider());
  if (own) {
    const meta = new MetaCloudMessagingProvider({
      phoneNumberId: own.phoneNumberId,
      accessToken: own.accessToken,
    });
    return {
      window: true,
      async send(ctx, message) {
        try {
          return await meta.send(ctx, message);
        } catch (e) {
          if (e instanceof MetaApiError) await recordWhatsAppError(tx, e.message);
          throw e;
        }
      },
    };
  }
  const settings = await ghlSettings(tx, orgId);
  const token = process.env.GHL_API_TOKEN;
  if (!settings || !token) return null;
  return new GhlMessagingProvider({ token, locationId: settings.locationId });
}
