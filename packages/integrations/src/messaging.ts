/**
 * Messaging adapters (brief §4.2, §6.12): WhatsApp through GHL's conversations API, an in-memory fake for tests and
 * demos (`RSWIM_MESSAGING_FAKE=1`), and the optional AI triage classifier.
 */
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { GhlApiError } from './ghl';
import type { MessagingProvider, OutboundMessage, ProviderContext } from './index';

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
    this.model = opts.model ?? 'claude-opus-5-5';
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
