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
