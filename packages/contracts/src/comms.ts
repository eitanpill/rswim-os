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
  'free_text',
] as const;
export const TemplateKey = z.enum(TEMPLATE_KEYS);
export type TemplateKey = z.infer<typeof TemplateKey>;

export const MESSAGE_CHANNELS = ['whatsapp', 'sms'] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

/** queued → sent | failed; held waits for a send window; blocked never goes out (the reason is kept). */
export const MESSAGE_STATUSES = ['queued', 'held', 'sent', 'failed', 'blocked'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const HOLD_REASONS = ['quiet_hours', 'rest_window'] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export const BLOCK_REASONS = [
  'opted_out',
  'no_phone',
  'missing_variable',
  'template_inactive',
  'no_provider',
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
