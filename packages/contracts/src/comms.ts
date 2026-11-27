/**
 * Communications hub (brief §6.12): template keys, message and inbound statuses, triage intents and actions, and
 * broadcast segments. The worker, the inbox and the log share these.
 */
import { z } from 'zod';

/** Every template the system sends. Bodies are per-organization rows the owner edits; keys are fixed. */
export const TEMPLATE_KEYS = [
  'trial_confirmation',
  'private_confirmation',
  'enrollment_welcome',
  'lesson_reminder',
  'absence_received',
  'absence_received_no_makeup',
  'makeup_confirmed',
  'instructor_change',
  'closure_notice',
  'reopening_makeups',
  'last_call_makeups',
  'payment_link',
  'payment_failed',
  'receipt_ready',
  'progress_card',
  'freeze_approved',
  'cancellation_confirmed',
  'holiday_schedule',
  'transport_left_school',
  'transport_arrived_pool',
  'transport_left_pool',
  'transport_dropped_off',
  'venue_migration',
  'venue_migration_reverted',
  'bot_handoff',
  'dive_reminder',
  'mandate_request',
  'trial_reminder',
  'forms_reminder',
  'free_text',
] as const;
export const TemplateKey = z.enum(TEMPLATE_KEYS);
export type TemplateKey = z.infer<typeof TemplateKey>;

/** `push`: a message that reached the person's phone through the store app instead of WhatsApp (store stage 6). */
export const MESSAGE_CHANNELS = ['whatsapp', 'sms', 'push'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** The store app's platforms that take push notifications (APNs on the iPhone, FCM on Android). */
export const PUSH_PLATFORMS = ['ios', 'android'] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

/**
 * queued → sent | failed; held waits for a send window; blocked never goes out (the reason is kept). suggested is a
 * bot's answer while the GHL bridge is in shadow mode: it waits for a person to send it (→ queued) or drop it
 * (→ dismissed).
 */
export const MESSAGE_STATUSES = [
  'queued',
  'held',
  'sent',
  'failed',
  'blocked',
  'suggested',
  'dismissed',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const HOLD_REASONS = ['quiet_hours', 'rest_window'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const BLOCK_REASONS = [
  'opted_out',
  'no_phone',
  'missing_variable',
  'template_inactive',
  'no_provider',
  // WhatsApp only lets a business start a conversation after 24 hours with an approved template (WhatsApp W5).
  'outside_window',
] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

/** What a family's WhatsApp message is about (brief §6.12). */
export const INBOUND_INTENTS = [
  'absence_notice',
  'makeup_request',
  'schedule_question',
  'payment_question',
  'receipt_request',
  'cancellation_request',
  'freeze_request',
  'lead',
  'complaint',
  'instructor_message',
  'personal_other',
] as const;
export const InboundIntent = z.enum(INBOUND_INTENTS);
export type InboundIntent = z.infer<typeof InboundIntent>;

export const INBOUND_STATUSES = ['new', 'actioned', 'dismissed', 'needs_human'] as const;
export type InboundStatus = (typeof INBOUND_STATUSES)[number];

/** Draft actions the inbox approves with one tap (or opens for the office to finish). */
export const TRIAGE_ACTION_KINDS = [
  'absence_notice',
  'makeup_request',
  'freeze_request',
  'cancellation_request',
  'receipt_request',
] as const;
export type TriageActionKind = (typeof TRIAGE_ACTION_KINDS)[number];

export const TRIAGE_ACTION_STATUSES = ['pending', 'approved', 'dismissed'] as const;
export type TriageActionStatus = (typeof TRIAGE_ACTION_STATUSES)[number];

export const BROADCAST_STATUSES = ['draft', 'scheduled', 'sent', 'cancelled'] as const;
export type BroadcastStatus = (typeof BROADCAST_STATUSES)[number];

/** Who a broadcast reaches. Empty lists mean "any"; every set filter must match. */
export const Segment = z.object({
  venueIds: z.array(z.uuid()).default([]),
  groupIds: z.array(z.uuid()).default([]),
  programIds: z.array(z.uuid()).default([]),
  /** Only families who owe money. */
  owing: z.boolean().default(false),
});
export type Segment = z.infer<typeof Segment>;

/** A classifier's verdict on one inbound message (rules or AI), stored as-is. */
export const Classification = z.object({
  intent: InboundIntent,
  /** 0–100. */
  confidence: z.number().int().min(0).max(100),
  studentIds: z.array(z.uuid()).default([]),
  /** The local date the message is about, when it names one. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .default(null),
  classifier: z.string(),
  /** Short reason codes for the inbox ("matched:student", "word:לא יגיע"). */
  signals: z.array(z.string()).default([]),
});
export type Classification = z.infer<typeof Classification>;

// ─── WhatsApp Cloud API (WhatsApp track W5) ─────────────────────────────────

/** A business's own WhatsApp number on Meta's Cloud API: connected, switched off, or refused by Meta's check. */
export const WHATSAPP_CONNECTION_STATUSES = ['connected', 'disconnected', 'failed'] as const;
export type WhatsAppConnectionStatus = (typeof WHATSAPP_CONNECTION_STATUSES)[number];

/** What the owner copies from Meta's WhatsApp Manager to connect the business's number. */
export const WhatsAppConnectInput = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'whatsapp.errors.phoneNumberId'),
  businessAccountId: z
    .string()
    .trim()
    .regex(/^\d{6,20}$/, 'whatsapp.errors.businessAccountId'),
  displayPhone: z.string().trim().min(6).max(30),
  accessToken: z.string().trim().min(20, 'whatsapp.errors.accessToken').max(1000),
  appSecret: z
    .string()
    .trim()
    .regex(/^[0-9a-f]{32}$/i, 'whatsapp.errors.appSecret'),
});
export type WhatsAppConnectInput = z.input<typeof WhatsAppConnectInput>;

/**
 * Registering the number on Meta's Cloud API: the six-digit PIN of the number's two-step verification. A number
 * without one gets this PIN; a number that has one needs the same PIN.
 */
export const WhatsAppRegisterInput = z.object({
  pin: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'whatsapp.errors.pin'),
});
export type WhatsAppRegisterInput = z.input<typeof WhatsAppRegisterInput>;

/** An approved Meta template for a message key: its name in WhatsApp Manager and its {{1}}, {{2}}… in order. */
export const MetaTemplateInput = z.object({
  key: TemplateKey,
  locale: z.enum(['he', 'en']),
  metaName: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, 'whatsapp.errors.templateName')
    .or(z.literal('')),
  metaParams: z.string().trim().max(500),
});
export type MetaTemplateInput = z.input<typeof MetaTemplateInput>;

// ─── WhatsApp through the business's own GHL sub-account (the GHL bridge) ──

/**
 * shadow: the bots read every message and write their answer as a suggestion for a person to send; nothing they write
 * goes out alone. live: the bots answer on their own, as on any other route.
 */
export const GHL_BRIDGE_MODES = ['shadow', 'live'] as const;
export type GhlBridgeMode = (typeof GHL_BRIDGE_MODES)[number];
export const GHL_BRIDGE_STATUSES = ['connected', 'disconnected'] as const;
export type GhlBridgeStatus = (typeof GHL_BRIDGE_STATUSES)[number];

/** What the owner copies from her GHL sub-account: its location id and a Private Integration token. */
export const GhlBridgeConnectInput = z.object({
  locationId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-]{6,64}$/, 'ghlBridge.errors.locationId'),
  token: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9._-]{20,2000}$/, 'ghlBridge.errors.token'),
});
export type GhlBridgeConnectInput = z.input<typeof GhlBridgeConnectInput>;

export const GhlBridgeModeInput = z.object({ mode: z.enum(GHL_BRIDGE_MODES) });
export type GhlBridgeModeInput = z.input<typeof GhlBridgeModeInput>;
