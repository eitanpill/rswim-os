/**
 * Messaging adapters (brief §4.2, §6.12): WhatsApp through GHL's conversations API, an in-memory fake for tests and
 * demos (`RSWIM_MESSAGING_FAKE=1`), and the optional AI triage classifier.
 */
import { AI_MODEL_FOR } from '@rswim/contracts';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GhlApiError } from './ghl';
import type { MessagingProvider, OutboundMessage, ProviderContext } from './index';
import { reportUsage } from './usage';

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export interface FakeSent {
  ctx: ProviderContext;
  message: OutboundMessage;
  providerMessageId: string;
}

/**
 * A fake WhatsApp. Remembers what it sent (once per idempotency key, like the real API with its idempotency header)
 * and fails for a number containing "0000000" so the demo can show a failed message.
 */
export class FakeMessagingProvider implements MessagingProvider {
  readonly sent: FakeSent[] = [];
  failNext = 0;

  /** With `window`, it stands in for Meta's Cloud API (WhatsApp W5): the dispatcher keeps to the 24-hour window. */
  constructor(readonly window = false) {}

  async send(ctx: ProviderContext, message: OutboundMessage) {
    const seen = this.sent.find((s) => s.ctx.idempotencyKey === ctx.idempotencyKey);
    if (seen) return { providerMessageId: seen.providerMessageId };
    if (this.failNext > 0 || message.toPhoneE164.includes('0000000')) {
      if (this.failNext > 0) this.failNext--;
      throw new Error('fake provider: recipient unreachable');
    }
    const providerMessageId = `fake_msg_${short(ctx.idempotencyKey)}`;
    this.sent.push({ ctx, message, providerMessageId });
    return { providerMessageId };
  }
}

export interface GhlMessagingOptions {
  token: string;
  locationId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * WhatsApp through GHL (LeadConnector API v2). A message goes to a contact, so the phone is first upserted to its
 * contact (GHL dedupes on phone), then POST /conversations/messages with type WhatsApp. Outside WhatsApp's 24-hour
 * window GHL needs an approved template, which the template's GHL id names.
 * Verified against the public API description at build time (2026-10); not yet exercised against a live sub-account.
 */
export class GhlMessagingProvider implements MessagingProvider {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: GhlMessagingOptions) {
    this.baseUrl = opts.baseUrl ?? 'https://services.leadconnectorhq.com';
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call<T>(path: string, body: unknown, idempotencyKey: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opts.token}`,
        Version: '2021-04-15',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new GhlApiError(res.status, text);
    return JSON.parse(text) as T;
  }

  async send(ctx: ProviderContext, message: OutboundMessage) {
    const contact = await this.call<{ contact: { id: string } }>(
      '/contacts/upsert',
      { locationId: this.opts.locationId, phone: message.toPhoneE164 },
      `${ctx.idempotencyKey}:contact`,
    );
    const res = await this.call<{ messageId: string }>(
      '/conversations/messages',
      {
        type: 'WhatsApp',
        contactId: contact.contact.id,
        message: message.text,
        ...(message.template ? { templateId: message.template.id } : {}),
      },
      ctx.idempotencyKey,
    );
    return { providerMessageId: res.messageId };
  }
}

// ─── Meta's WhatsApp Cloud API (WhatsApp track W5) ──────────────────────────

export interface MetaCloudOptions {
  phoneNumberId: string;
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class MetaApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Meta Cloud API ${status}: ${body.slice(0, 300)}`);
  }
}

/**
 * WhatsApp through the business's own number on Meta's Cloud API: POST /<phone-number-id>/messages with free text
 * inside the 24-hour window, or an approved template (by name, language, and its body's values in order) outside it.
 * Meta has no idempotency header, so a retry after a lost answer can send twice; the dispatcher retries only failed
 * calls. Written against Meta's published API (2026-11); not yet exercised against a live number.
 */
export class MetaCloudMessagingProvider implements MessagingProvider {
  readonly window = true;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: MetaCloudOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async send(_ctx: ProviderContext, message: OutboundMessage) {
    const to = message.toPhoneE164.replace(/^\+/, '');
    const body = message.template
      ? {
          messaging_product: 'whatsapp',
          to,
          type: 'template',
          template: {
            name: message.template.id,
            language: { code: message.locale },
            components: message.template.values?.length
              ? [
                  {
                    type: 'body',
                    parameters: message.template.values.map((text) => ({ type: 'text', text })),
                  },
                ]
              : [],
          },
        }
      : {
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body: message.text ?? '', preview_url: true },
        };
    const res = await this.fetchImpl(
      `${this.opts.baseUrl ?? 'https://graph.facebook.com'}/${this.opts.apiVersion ?? 'v21.0'}/${this.opts.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opts.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new MetaApiError(res.status, text);
    const id = (JSON.parse(text) as { messages?: { id: string }[] }).messages?.[0]?.id;
    if (!id) throw new MetaApiError(res.status, text);
    return { providerMessageId: id };
  }
}

// ─── Meta's management API for one business account (WhatsApp track W10) ────

export interface WhatsAppNumberInfo {
  displayPhone: string | null;
  verifiedName: string | null;
  /** GREEN, YELLOW, RED or NA. */
  quality: string | null;
}

export interface MetaTemplateDraft {
  name: string;
  language: 'he' | 'en';
  /** The text with {{1}}, {{2}}… */
  text: string;
  /** One example value per placeholder, in order. */
  examples: string[];
}

export interface MetaTemplateState {
  id: string | null;
  name: string;
  language: string;
  /** Meta's word: PENDING, APPROVED, REJECTED, PAUSED, DISABLED… */
  status: string;
}

/** What the worker asks of Meta about a connected business: its number, its webhook and its templates. */
export interface WhatsAppAdmin {
  number(): Promise<WhatsAppNumberInfo>;
  /** Has Meta send this business account's messages to `callbackUrl` (checked by Meta with `verifyToken`). */
  subscribe(callbackUrl: string, verifyToken: string): Promise<void>;
  /**
   * Registers the number on the Cloud API (WhatsApp Manager shows it "not connected" until then) with the six-digit
   * PIN of its two-step verification; a number still on the WhatsApp Business app leaves it.
   */
  register(pin: string): Promise<void>;
  createTemplate(draft: MetaTemplateDraft): Promise<MetaTemplateState>;
  templates(): Promise<MetaTemplateState[]>;
}

export interface MetaAdminOptions {
  phoneNumberId: string;
  businessAccountId: string;
  accessToken: string;
  apiVersion?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

/**
 * Meta's Graph API for a WhatsApp Business Account, as published in 2026-11: GET /<phone-number-id>,
 * POST /<waba-id>/subscribed_apps (first plain, then with `override_callback_uri` and `verify_token`: Meta refuses an
 * override before the app is subscribed to the account, error #100, seen on staging 2026-11-21),
 * POST /<phone-number-id>/register (a number Meta shows "not connected" receives nothing until it is registered, seen
 * on staging 2026-11-23), and POST / GET /<waba-id>/message_templates. Not yet exercised against a live account.
 */
export class MetaWhatsAppAdmin implements WhatsAppAdmin {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: MetaAdminOptions) {
    this.fetchImpl = opts.fetch ?? fetch;
  }

  private async call(path: string, init: { method: 'GET' | 'POST'; body?: unknown }) {
    const res = await this.fetchImpl(
      `${this.opts.baseUrl ?? 'https://graph.facebook.com'}/${this.opts.apiVersion ?? 'v23.0'}/${path}`,
      {
        method: init.method,
        headers: {
          Authorization: `Bearer ${this.opts.accessToken}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new MetaApiError(res.status, text);
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new MetaApiError(res.status, text);
    }
  }

  async number(): Promise<WhatsAppNumberInfo> {
    const r = await this.call(
      `${this.opts.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
      { method: 'GET' },
    );
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return {
      displayPhone: str(r.display_phone_number),
      verifiedName: str(r.verified_name),
      quality: str(r.quality_rating),
    };
  }

  async subscribe(callbackUrl: string, verifyToken: string): Promise<void> {
    const path = `${this.opts.businessAccountId}/subscribed_apps`;
    const plain = await this.call(path, { method: 'POST' });
    if (plain.success !== true) throw new MetaApiError(200, JSON.stringify(plain));
    const r = await this.call(path, {
      method: 'POST',
      body: { override_callback_uri: callbackUrl, verify_token: verifyToken },
    });
    if (r.success !== true) throw new MetaApiError(200, JSON.stringify(r));
  }

  async register(pin: string): Promise<void> {
    const r = await this.call(`${this.opts.phoneNumberId}/register`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', pin },
    });
    if (r.success !== true) throw new MetaApiError(200, JSON.stringify(r));
  }

  async createTemplate(draft: MetaTemplateDraft): Promise<MetaTemplateState> {
    const r = await this.call(`${this.opts.businessAccountId}/message_templates`, {
      method: 'POST',
      body: {
        name: draft.name,
        language: draft.language,
        category: 'utility',
        parameter_format: 'positional',
        components: [
          {
            type: 'body',
            text: draft.text,
            ...(draft.examples.length ? { example: { body_text: [draft.examples] } } : {}),
          },
        ],
      },
    });
    return {
      id: typeof r.id === 'string' ? r.id : null,
      name: draft.name,
      language: draft.language,
      status: typeof r.status === 'string' ? r.status : 'PENDING',
    };
  }

  async templates(): Promise<MetaTemplateState[]> {
    const r = await this.call(
      `${this.opts.businessAccountId}/message_templates?fields=id,name,language,status&limit=250`,
      { method: 'GET' },
    );
    const data = Array.isArray(r.data) ? (r.data as Record<string, unknown>[]) : [];
    return data.flatMap((t) =>
      typeof t.name === 'string' && typeof t.language === 'string' && typeof t.status === 'string'
        ? [
            {
              id: typeof t.id === 'string' ? t.id : null,
              name: t.name,
              language: t.language,
              status: t.status,
            },
          ]
        : [],
    );
  }
}

/**
 * Meta's management API in memory, for demos and tests: a number named after its id, templates that wait as PENDING
 * until `review()`, and a business account id containing 0000000 refuses everything.
 */
export class FakeWhatsAppAdmin implements WhatsAppAdmin {
  readonly subscriptions: { callbackUrl: string; verifyToken: string }[] = [];
  /** PINs the number was registered with; a PIN of zeros is refused like a wrong one. */
  readonly registrations: string[] = [];
  readonly created = new Map<string, MetaTemplateState & { text: string; examples: string[] }>();

  constructor(private readonly opts: { phoneNumberId: string; businessAccountId: string }) {}

  private guard() {
    if (this.opts.businessAccountId.includes('0000000'))
      throw new MetaApiError(400, '{"error":{"message":"(#100) Invalid parameter"}}');
  }

  async number(): Promise<WhatsAppNumberInfo> {
    this.guard();
    return { displayPhone: null, verifiedName: 'Demo Business', quality: 'GREEN' };
  }

  async subscribe(callbackUrl: string, verifyToken: string): Promise<void> {
    this.guard();
    this.subscriptions.push({ callbackUrl, verifyToken });
  }

  async register(pin: string): Promise<void> {
    this.guard();
    if (pin === '000000')
      throw new MetaApiError(
        400,
        '{"error":{"message":"(#133005) Two step verification PIN Mismatch"}}',
      );
    this.registrations.push(pin);
  }

  async createTemplate(draft: MetaTemplateDraft): Promise<MetaTemplateState> {
    this.guard();
    const key = `${draft.name}:${draft.language}`;
    if (this.created.has(key))
      throw new MetaApiError(400, '{"error":{"message":"Template name already exists"}}');
    const state = {
      id: `tpl_${this.created.size + 1}`,
      name: draft.name,
      language: draft.language,
      status: 'PENDING',
    };
    this.created.set(key, { ...state, text: draft.text, examples: draft.examples });
    return state;
  }

  async templates(): Promise<MetaTemplateState[]> {
    this.guard();
    return [...this.created.values()].map(({ id, name, language, status }) => ({
      id,
      name,
      language,
      status,
    }));
  }

  /** Meta's review, in tests: every waiting template is approved, or the named ones refused. */
  review(rejected: string[] = []) {
    for (const t of this.created.values())
      if (t.status === 'PENDING') t.status = rejected.includes(t.name) ? 'REJECTED' : 'APPROVED';
  }
}

/**
 * Checks Meta's webhook signature (`X-Hub-Signature-256: sha256=<hex>`, an HMAC-SHA256 of the raw body with the app
 * secret), in constant time. False on anything malformed.
 */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header ?? '');
  if (!m) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(m[1] as string, 'hex'));
}

/** Signs a body as Meta would (the fake webhook in demos and tests). */
export function signMetaBody(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

// ─── AI triage ──────────────────────────────────────────────────────────────

export interface TriageInput {
  text: string;
  today: string;
  known: boolean;
  isStaff: boolean;
  students: { id: string; firstName: string }[];
  intents: readonly string[];
}

/** A classifier's verdict; the caller validates it before use. */
export interface TriageVerdict {
  intent: string;
  confidence: number;
  studentIds: string[];
  date: string | null;
  signals: string[];
}

export interface TriageClassifier {
  readonly name: string;
  /** Null when the classifier declines or answers something unusable; the rules' verdict then stands. */
  classify(input: TriageInput): Promise<TriageVerdict | null>;
}

const SYSTEM = `You triage WhatsApp messages that families send to a children's swim school in Israel. Messages are
usually Hebrew. Decide what the sender wants and report it as JSON.

- intent: one of the allowed intents. "absence_notice" means a child will miss a lesson. Use "complaint" for any
  dissatisfaction, and "cancellation_request" only for leaving the school or a program, not for missing one lesson.
  Use "personal_other" for greetings, thanks and anything that needs no action.
- studentIds: ids of the children the message is about, chosen only from the list given. Empty when none is named
  and the family has more than one child.
- date: the day the message is about as YYYY-MM-DD (today is given), or null.
- confidence: 0-100, how sure you are of the intent and the details together.
- signals: two or three short reasons, in English.`;

/**
 * Claude as a second opinion on inbound messages (`comms.ai_triage`). Used only when the owner turns it on and the
 * worker has ANTHROPIC_API_KEY; the deterministic rules classifier stays the baseline and the fallback.
 */
export class ClaudeTriageClassifier implements TriageClassifier {
  readonly name: string;
  private readonly client: Anthropic;

  private readonly model: string;

  constructor(opts: { apiKey?: string; model?: string; client?: Anthropic } = {}) {
    this.client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });
    this.model = opts.model ?? AI_MODEL_FOR.triage;
    this.name = `claude:${this.model}`;
  }

  async classify(input: TriageInput): Promise<TriageVerdict | null> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['intent', 'confidence', 'studentIds', 'date', 'signals'],
            properties: {
              intent: { type: 'string', enum: [...input.intents] },
              confidence: { type: 'integer' },
              studentIds: { type: 'array', items: { type: 'string' } },
              date: { type: ['string', 'null'] },
              signals: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            today: input.today,
            senderIsKnownFamily: input.known,
            senderIsStaff: input.isStaff,
            children: input.students,
            message: input.text,
          }),
        },
      ],
    });
    reportUsage(this.model, response.usage);
    if (response.stop_reason !== 'end_turn') return null;
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return null;
    try {
      return JSON.parse(text.text) as TriageVerdict;
    } catch {
      return null;
    }
  }
}
