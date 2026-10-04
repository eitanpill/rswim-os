import { readFileSync } from 'node:fs';
import type { Tx } from '@rswim/db';
import { ghlSettings, type TagMap } from '@rswim/domain-crm';
import {
  FakeGhlClient,
  FakeMessagingProvider,
  GhlMessagingProvider,
  HttpGhlClient,
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

/**
 * The messaging provider for an org, or null when none is set up.
 * - RSWIM_MESSAGING_FAKE=1: an in-memory WhatsApp for local demos and CI. Never touches the real account.
 * - Otherwise WhatsApp through the org's GHL location with GHL_API_TOKEN.
 */
export async function messagingFor(tx: Tx, orgId: string): Promise<MessagingProvider | null> {
  if (process.env.RSWIM_MESSAGING_FAKE === '1')
    return (fakeMessaging ??= new FakeMessagingProvider());
  const settings = await ghlSettings(tx, orgId);
  const token = process.env.GHL_API_TOKEN;
  if (!settings || !token) return null;
  return new GhlMessagingProvider({ token, locationId: settings.locationId });
}
