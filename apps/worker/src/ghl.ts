import { readFileSync } from 'node:fs';
import type { Tx } from '@rswim/db';
import {
  loadGhlBridge,
  loadWhatsApp,
  recordGhlBridgeError,
  recordWhatsAppError,
  type LoadedGhlBridge,
} from '@rswim/domain-comms';
import { ghlSettings, type TagMap } from '@rswim/domain-crm';
import {
  FakeGhlBridgeClient,
  FakeGhlClient,
  FakeMessagingProvider,
  GhlApiError,
  HttpGhlBridgeClient,
  GhlMessagingProvider,
  HttpGhlClient,
  MetaApiError,
  FakeWhatsAppAdmin,
  MetaCloudMessagingProvider,
  MetaWhatsAppAdmin,
  type WhatsAppAdmin,
  type GhlBridgeClient,
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
  // The business's own sub-account token (the GHL bridge) first, then the platform's (tenant #1's) environment.
  const bridge = await loadGhlBridge(tx, orgId);
  const token = bridge?.token ?? process.env.GHL_API_TOKEN;
  if (!token) return null;
  return {
    client: new HttpGhlClient({ token, locationId: bridge?.locationId ?? settings.locationId }),
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
 * - The business's own GHL sub-account when the owner connected it (the GHL bridge), with its own token.
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
  // The business's own GHL sub-account (the GHL bridge): its token, and GHL's refusals kept for the owner.
  const bridge = await loadGhlBridge(tx, orgId);
  if (bridge) {
    const ghl = new GhlMessagingProvider({ token: bridge.token, locationId: bridge.locationId });
    return {
      async send(ctx, message) {
        try {
          return await ghl.send(ctx, message);
        } catch (e) {
          if (e instanceof GhlApiError) await recordGhlBridgeError(tx, e.message);
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

const fakeBridges = new Map<string, FakeGhlBridgeClient>();

/** The in-memory sub-account behind a location id (RSWIM_GHL_FAKE=1), for demos and tests. */
export function fakeGhlBridge(locationId: string): FakeGhlBridgeClient {
  let fake = fakeBridges.get(locationId);
  if (!fake) {
    fake = new FakeGhlBridgeClient(locationId);
    fakeBridges.set(locationId, fake);
  }
  return fake;
}

/**
 * The business's GHL sub-account for the bridge (reading conversations, the connection check), or null when the bridge
 * is not connected. RSWIM_GHL_FAKE=1 reads an in-memory sub-account instead.
 */
export async function ghlBridgeFor(
  tx: Tx,
  orgId: string,
): Promise<{ bridge: LoadedGhlBridge; client: GhlBridgeClient } | null> {
  const bridge = await loadGhlBridge(tx, orgId);
  if (!bridge) return null;
  const client =
    process.env.RSWIM_GHL_FAKE === '1'
      ? fakeGhlBridge(bridge.locationId)
      : new HttpGhlBridgeClient({ token: bridge.token, locationId: bridge.locationId });
  return { bridge, client };
}

const fakeAdmins = new Map<string, FakeWhatsAppAdmin>();

/**
 * Meta's management API for an org's connected number (the connection check, templates), or null when no number is
 * connected. With RSWIM_MESSAGING_FAKE=1 it is an in-memory stand-in that approves templates on the next look.
 */
export async function whatsappAdminFor(
  tx: Tx,
  orgId: string,
): Promise<{ admin: WhatsAppAdmin; connectionId: string; verifyToken: string } | null> {
  const own = await loadWhatsApp(tx, orgId);
  if (!own) return null;
  const base = { connectionId: own.connectionId, verifyToken: own.verifyToken };
  if (process.env.RSWIM_MESSAGING_FAKE === '1') {
    let fake = fakeAdmins.get(own.connectionId);
    if (!fake) {
      fake = new FakeWhatsAppAdmin(own);
      fakeAdmins.set(own.connectionId, fake);
    } else fake.review();
    return { admin: fake, ...base };
  }
  return {
    admin: new MetaWhatsAppAdmin({
      phoneNumberId: own.phoneNumberId,
      businessAccountId: own.businessAccountId,
      accessToken: own.accessToken,
    }),
    ...base,
  };
}
