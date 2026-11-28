/**
 * GoHighLevel (LeadConnector API v2) contact adapter behind CrmProvider (brief §4.3).
 *
 * Verified against the public API description at build time (2026-10): POST /contacts/search with pageLimit and a
 * searchAfter cursor, POST /contacts/upsert, PUT /contacts/{id}, header `Version: 2021-07-28`.
 * Not yet exercised against a live sub-account: tests use FakeGhlClient and recorded fake fixtures.
 */
import { createPublicKey, verify } from 'node:crypto';
import type { CrmContact, CrmProvider, ProviderContext } from './index';

/** The fields of a GHL contact this system reads. */
export interface GhlContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  contactName?: string | null;
  phone?: string | null;
  email?: string | null;
  tags?: string[];
  dateAdded?: string;
  dateUpdated?: string;
}

export interface GhlPage {
  contacts: GhlContact[];
  /** Cursor for the next page; null when this was the last. */
  next: unknown[] | null;
}

export interface GhlClient extends CrmProvider {
  searchContacts(
    ctx: ProviderContext,
    cursor: unknown[] | null,
    pageSize: number,
  ): Promise<GhlPage>;
}

/** Reads every contact of the location, page by page. */
export async function* allContacts(client: GhlClient, ctx: ProviderContext, pageSize = 100) {
  let cursor: unknown[] | null = null;
  do {
    const page: GhlPage = await client.searchContacts(ctx, cursor, pageSize);
    yield* page.contacts;
    cursor = page.next;
  } while (cursor);
}

export interface HttpGhlOptions {
  token: string;
  locationId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class GhlApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`GHL API ${status}: ${body.slice(0, 300)}`);
  }
}

export class HttpGhlClient implements GhlClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpGhlOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://services.leadconnectorhq.com';
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call<T>(method: string, path: string, body: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new GhlApiError(res.status, text);
    return JSON.parse(text) as T;
  }

  async searchContacts(
    _ctx: ProviderContext,
    cursor: unknown[] | null,
    pageSize: number,
  ): Promise<GhlPage> {
    const res = await this.call<{ contacts: (GhlContact & { searchAfter?: unknown[] })[] }>(
      'POST',
      '/contacts/search',
      {
        locationId: this.opts.locationId,
        pageLimit: pageSize,
        sort: [{ field: 'dateAdded', direction: 'asc' }],
        ...(cursor ? { searchAfter: cursor } : {}),
      },
    );
    const last = res.contacts.at(-1);
    return {
      contacts: res.contacts,
      next: res.contacts.length === pageSize && last?.searchAfter ? last.searchAfter : null,
    };
  }

  async upsertContact(_ctx: ProviderContext, contact: CrmContact): Promise<{ externalId: string }> {
    const fields = {
      firstName: contact.firstName,
      lastName: contact.lastName,
      ...(contact.phoneE164 ? { phone: contact.phoneE164 } : {}),
      ...(contact.email ? { email: contact.email } : {}),
      ...(contact.tags.length ? { tags: contact.tags } : {}),
    };
    if (contact.externalId) {
      const res = await this.call<{ contact: { id: string } }>(
        'PUT',
        `/contacts/${contact.externalId}`,
        fields,
      );
      return { externalId: res.contact.id };
    }
    const res = await this.call<{ contact: { id: string } }>('POST', '/contacts/upsert', {
      locationId: this.opts.locationId,
      ...fields,
    });
    return { externalId: res.contact.id };
  }

  /** Puts the contact's opportunity in a pipeline stage (creates it when missing): POST /opportunities/upsert. */
  async moveOpportunity(
    _ctx: ProviderContext,
    req: { contactExternalId: string; pipelineId: string; stageId: string },
  ): Promise<void> {
    await this.call('POST', '/opportunities/upsert', {
      locationId: this.opts.locationId,
      contactId: req.contactExternalId,
      pipelineId: req.pipelineId,
      pipelineStageId: req.stageId,
      status: 'open',
    });
  }
}

/**
 * In-memory GHL for tests and local runs. Upsert matches by id, then phone, like a location configured to
 * dedupe on phone. `calls` records every write so tests can assert exactly-once behaviour.
 */
export class FakeGhlClient implements GhlClient {
  readonly contacts = new Map<string, GhlContact>();
  readonly calls: { op: 'upsert'; idempotencyKey: string; contact: CrmContact }[] = [];
  private seq = 0;

  constructor(initial: GhlContact[] = []) {
    for (const c of initial) this.contacts.set(c.id, { ...c });
  }

  async searchContacts(
    _ctx: ProviderContext,
    cursor: unknown[] | null,
    pageSize: number,
  ): Promise<GhlPage> {
    const all = [...this.contacts.values()];
    const start = cursor ? Number(cursor[0]) : 0;
    const contacts = all.slice(start, start + pageSize);
    return { contacts, next: start + pageSize < all.length ? [start + pageSize] : null };
  }

  async upsertContact(ctx: ProviderContext, contact: CrmContact): Promise<{ externalId: string }> {
    this.calls.push({ op: 'upsert', idempotencyKey: ctx.idempotencyKey, contact });
    const existing =
      (contact.externalId && this.contacts.get(contact.externalId)) ||
      [...this.contacts.values()].find((c) => contact.phoneE164 && c.phone === contact.phoneE164);
    const id = existing ? existing.id : `fake-ghl-${++this.seq}`;
    this.contacts.set(id, {
      ...existing,
      id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      phone: contact.phoneE164 ?? existing?.phone ?? null,
      email: contact.email ?? existing?.email ?? null,
      tags: contact.tags.length ? contact.tags : (existing?.tags ?? []),
    });
    return { externalId: id };
  }

  readonly moves: {
    idempotencyKey: string;
    contactExternalId: string;
    pipelineId: string;
    stageId: string;
  }[] = [];

  async moveOpportunity(
    ctx: ProviderContext,
    req: { contactExternalId: string; pipelineId: string; stageId: string },
  ): Promise<void> {
    if (this.moves.some((m) => m.idempotencyKey === ctx.idempotencyKey)) return;
    this.moves.push({ idempotencyKey: ctx.idempotencyKey, ...req });
  }
}

/**
 * Verifies a GHL webhook signature (`x-wh-signature`: base64 RSA-SHA256 over the raw body, checked with the public
 * key GHL publishes for its marketplace webhooks). Returns false on any malformed input.
 */
export function verifyGhlSignature(
  rawBody: string,
  signature: string | null,
  publicKeyPem: string,
): boolean {
  if (!signature) return false;
  try {
    return verify(
      'sha256',
      Buffer.from(rawBody),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * GHL's current webhook key (Ed25519, header `X-GHL-Signature`), as GHL publishes it in its webhook integration guide
 * (marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide, read 2026-11-27). The RSA `x-wh-signature` is
 * GHL's legacy header, announced for deprecation on 2026-09-01; it stays accepted with GHL_WEBHOOK_PUBLIC_KEY.
 */
export const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

/** Verifies `X-GHL-Signature` (base64 Ed25519 over the raw body). Returns false on any malformed input. */
export function verifyGhlEd25519(
  rawBody: string,
  signature: string | null,
  publicKeyPem: string = GHL_ED25519_PUBLIC_KEY,
): boolean {
  if (!signature) return false;
  try {
    return verify(
      null,
      Buffer.from(rawBody),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64'),
    );
  } catch {
    return false;
  }
}

/**
 * A marketplace webhook is genuine when its current signature checks out, or (while GHL still sends it) its legacy one
 * against the RSA key configured in the environment.
 */
export function verifyGhlWebhook(
  rawBody: string,
  headers: { ghlSignature: string | null; whSignature: string | null },
  keys: { ed25519?: string; rsa?: string | null } = {},
): boolean {
  if (headers.ghlSignature)
    return verifyGhlEd25519(rawBody, headers.ghlSignature, keys.ed25519 ?? GHL_ED25519_PUBLIC_KEY);
  return keys.rsa ? verifyGhlSignature(rawBody, headers.whSignature, keys.rsa) : false;
}

// ─── The GHL bridge: WhatsApp through a business's own GHL sub-account ─────

/** One message of a GHL conversation, as the bridge reads it. */
export interface GhlChatMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  /** WhatsApp, or anything else GHL carries (SMS, email, calls…), which the bridge leaves alone. */
  whatsapp: boolean;
  body: string;
  at: Date;
  /** The GHL user who wrote it by hand, when a person did. */
  userId: string | null;
}

/** Which part of the sub-account a survey read: the owner sees what is there and which permission is missing. */
export const GHL_SURVEY_PARTS = ['contacts', 'pipelines', 'tags', 'whatsapp'] as const;
export type GhlSurveyPart = (typeof GHL_SURVEY_PARTS)[number];

/** A sub-account at a glance: counts, pipelines by name, and the parts the token was not allowed to read. */
export interface GhlSurvey {
  contacts: number | null;
  pipelines: { id: string; name: string; stages: string[] }[] | null;
  tags: number | null;
  /** Conversations whose last message came on WhatsApp: the number is already connected in GHL. */
  whatsappConversations: number | null;
  /** Parts GHL refused (401/403): the Private Integration lacks that permission. */
  missing: GhlSurveyPart[];
}

/**
 * What the bridge reads from a sub-account with its Private Integration token: the location (the connection check),
 * a contact's phone, and a contact's latest messages. Writing goes through GhlMessagingProvider.
 */
export interface GhlBridgeClient {
  location(): Promise<{ id: string; name: string }>;
  /** What the sub-account holds, read once when the owner connects: each part null when GHL would not say. */
  survey(): Promise<GhlSurvey>;
  contactPhone(contactId: string): Promise<string | null>;
  /** The contact's latest messages, newest first (at most `limit`). */
  recentMessages(contactId: string, limit?: number): Promise<GhlChatMessage[]>;
}

interface RawGhlMessage {
  id?: string;
  direction?: string;
  messageType?: string;
  type?: number | string;
  body?: string | null;
  dateAdded?: string;
  userId?: string | null;
}

/** GHL's message as the bridge reads it, or null for one it cannot place. */
export function toGhlChatMessage(m: RawGhlMessage): GhlChatMessage | null {
  if (!m.id || (m.direction !== 'inbound' && m.direction !== 'outbound')) return null;
  const at = m.dateAdded ? new Date(m.dateAdded) : null;
  if (!at || Number.isNaN(at.getTime())) return null;
  return {
    id: m.id,
    direction: m.direction,
    whatsapp: /whatsapp/i.test(
      `${m.messageType ?? ''} ${typeof m.type === 'string' ? m.type : ''}`,
    ),
    body: m.body ?? '',
    at,
    userId: m.userId || null,
  };
}

/**
 * The bridge over GHL's API v2 (services.leadconnectorhq.com) with a sub-account's Private Integration token:
 * GET /locations/{id}, GET /contacts/{id}, GET /conversations/search?contactId=…, GET /conversations/{id}/messages.
 * Scopes: locations.readonly, contacts.readonly, conversations.readonly, conversations/message.readonly (and
 * conversations/message.write + contacts.write for sending). Written from GHL's published API (2026-11); not yet
 * exercised against a live sub-account.
 */
export class HttpGhlBridgeClient implements GhlBridgeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: HttpGhlOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://services.leadconnectorhq.com';
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async get<T>(path: string, version: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Version: version,
        Accept: 'application/json',
      },
    });
    const text = await res.text();
    if (!res.ok) throw new GhlApiError(res.status, text);
    return JSON.parse(text) as T;
  }

  async location() {
    const res = await this.get<{ location?: { id?: string; name?: string } }>(
      `/locations/${encodeURIComponent(this.opts.locationId)}`,
      '2021-07-28',
    );
    return { id: res.location?.id ?? this.opts.locationId, name: res.location?.name ?? '' };
  }

  /**
   * Four small reads (GHL API v2): GET /contacts/?limit=1 (meta.total), GET /opportunities/pipelines,
   * GET /locations/{id}/tags, GET /conversations/search?lastMessageType=TYPE_WHATSAPP&limit=1 (total). A refusal marks
   * the part missing; any other failure leaves it unknown, so one slow part never fails the connection.
   */
  async survey(): Promise<GhlSurvey> {
    const loc = encodeURIComponent(this.opts.locationId);
    const out: GhlSurvey = {
      contacts: null,
      pipelines: null,
      tags: null,
      whatsappConversations: null,
      missing: [],
    };
    const part = async <T>(name: GhlSurveyPart, read: () => Promise<T>): Promise<T | null> => {
      try {
        return await read();
      } catch (e) {
        if (e instanceof GhlApiError && (e.status === 401 || e.status === 403))
          out.missing.push(name);
        return null;
      }
    };
    const total = (r: { meta?: { total?: number }; total?: number; contacts?: unknown[] }) =>
      r.meta?.total ?? r.total ?? r.contacts?.length ?? null;
    const [contacts, pipelines, tags, whatsapp] = await Promise.all([
      part('contacts', () =>
        this.get<{ meta?: { total?: number }; total?: number; contacts?: unknown[] }>(
          `/contacts/?locationId=${loc}&limit=1`,
          '2021-07-28',
        ),
      ),
      part('pipelines', () =>
        this.get<{
          pipelines?: { id?: string; name?: string; stages?: { name?: string }[] }[];
        }>(`/opportunities/pipelines?locationId=${loc}`, '2021-07-28'),
      ),
      part('tags', () => this.get<{ tags?: unknown[] }>(`/locations/${loc}/tags`, '2021-07-28')),
      part('whatsapp', () =>
        this.get<{ total?: number; conversations?: unknown[] }>(
          `/conversations/search?locationId=${loc}&lastMessageType=TYPE_WHATSAPP&limit=1`,
          '2021-04-15',
        ),
      ),
    ]);
    if (contacts) out.contacts = total(contacts);
    if (pipelines)
      out.pipelines = (pipelines.pipelines ?? [])
        .filter((p) => p.id)
        .map((p) => ({
          id: p.id as string,
          name: p.name ?? '',
          stages: (p.stages ?? []).map((st) => st.name ?? '').filter(Boolean),
        }));
    if (tags) out.tags = tags.tags?.length ?? 0;
    if (whatsapp) out.whatsappConversations = whatsapp.total ?? whatsapp.conversations?.length ?? 0;
    return out;
  }

  async contactPhone(contactId: string) {
    const res = await this.get<{ contact?: { phone?: string | null; locationId?: string } }>(
      `/contacts/${encodeURIComponent(contactId)}`,
      '2021-07-28',
    );
    // A contact of another sub-account is not ours to read, even if the token could.
    if (res.contact?.locationId && res.contact.locationId !== this.opts.locationId) return null;
    return res.contact?.phone ?? null;
  }

  async recentMessages(contactId: string, limit = 20) {
    const q = new URLSearchParams({ locationId: this.opts.locationId, contactId });
    const found = await this.get<{ conversations?: { id: string }[] }>(
      `/conversations/search?${q}`,
      '2021-04-15',
    );
    const out: GhlChatMessage[] = [];
    for (const c of found.conversations ?? []) {
      const res = await this.get<{
        messages?: RawGhlMessage[] | { messages?: RawGhlMessage[] };
      }>(`/conversations/${encodeURIComponent(c.id)}/messages?limit=${limit}`, '2021-04-15');
      const list = Array.isArray(res.messages) ? res.messages : (res.messages?.messages ?? []);
      for (const m of list) {
        const parsed = toGhlChatMessage(m);
        if (parsed) out.push(parsed);
      }
    }
    return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  }
}

/**
 * An in-memory sub-account for tests and demos (`RSWIM_GHL_FAKE=1`): contacts with phones and their messages. A
 * location id containing "bad" fails the connection check, like a wrong token.
 */
export class FakeGhlBridgeClient implements GhlBridgeClient {
  readonly phones = new Map<string, string>();
  readonly messages = new Map<string, GhlChatMessage[]>();

  constructor(private readonly locationId: string) {}

  async location() {
    if (this.locationId.includes('bad')) throw new GhlApiError(401, 'Invalid JWT');
    return { id: this.locationId, name: 'Fake sub-account' };
  }

  /** Pipelines and tags a test sets; a location id containing "nopipes" lacks that permission. */
  pipelines: { id: string; name: string; stages: string[] }[] = [
    { id: 'pipe-1', name: 'Fake pipeline', stages: ['New', 'Trial booked', 'Joined'] },
  ];
  tags: string[] = ['fake tag'];

  async survey(): Promise<GhlSurvey> {
    const whatsapp = [...this.messages.values()].filter((l) => l.some((m) => m.whatsapp)).length;
    const noPipes = this.locationId.includes('nopipes');
    return {
      contacts: this.phones.size,
      pipelines: noPipes ? null : this.pipelines,
      tags: this.tags.length,
      whatsappConversations: whatsapp,
      missing: noPipes ? ['pipelines'] : [],
    };
  }

  async contactPhone(contactId: string) {
    return this.phones.get(contactId) ?? null;
  }

  async recentMessages(contactId: string, limit = 20) {
    return [...(this.messages.get(contactId) ?? [])]
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit);
  }

  /** A person writes on WhatsApp (or the old bot, or a person in GHL, answers). */
  add(
    contactId: string,
    phone: string,
    m: Omit<GhlChatMessage, 'whatsapp'> & { whatsapp?: boolean },
  ) {
    this.phones.set(contactId, phone);
    const list = this.messages.get(contactId) ?? [];
    list.push({ whatsapp: true, ...m });
    this.messages.set(contactId, list);
  }
}
