import { z } from 'zod';

/** What the owner's copilot may propose (brief §6.15). Each runs through the same domain service once confirmed. */
export const COPILOT_ACTION_KINDS = [
  'move_student',
  'message_family',
  'open_makeup_slots',
] as const;
export const CopilotActionKind = z.enum(COPILOT_ACTION_KINDS);
export type CopilotActionKind = z.infer<typeof CopilotActionKind>;

/** proposed → confirmed (done) | failed | dismissed; a confirmed move may be undone. */
export const COPILOT_ACTION_STATUSES = [
  'proposed',
  'confirmed',
  'failed',
  'dismissed',
  'undone',
] as const;
export const CopilotActionStatus = z.enum(COPILOT_ACTION_STATUSES);
export type CopilotActionStatus = z.infer<typeof CopilotActionStatus>;

export const COPILOT_REQUEST_STATUSES = ['answered', 'failed'] as const;
export const CopilotRequestStatus = z.enum(COPILOT_REQUEST_STATUSES);
export type CopilotRequestStatus = z.infer<typeof CopilotRequestStatus>;

/** A weekly digest item's section. */
export const DIGEST_SECTIONS = ['happened', 'attention', 'suggestion'] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];

/**
 * What the owner's insights feed notices on its own (advisory only: an insight never changes data). Each kind is one
 * rule in the reports module; the owner can set an insight aside until a later date.
 */
export const INSIGHT_KINDS = [
  'group_emptying',
  'churn_risk',
  'leaving',
  'old_debts',
  'venue_loss',
  'waitlist_cluster',
  'trial_followup',
  'uncovered_lessons',
  'staff_overload',
] as const;
export const InsightKind = z.enum(INSIGHT_KINDS);
export type InsightKind = z.infer<typeof InsightKind>;

export const INSIGHT_SEVERITIES = ['high', 'medium', 'low'] as const;
export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

/** open → dismissed (set aside until a date) | resolved (the rule no longer fires); either may open again. */
export const INSIGHT_STATUSES = ['open', 'dismissed', 'resolved'] as const;
export type InsightStatus = (typeof INSIGHT_STATUSES)[number];
// ─── The parents' WhatsApp bot ──────────────────────────────────────────────

/** What the bot did with one family message: answered it, or handed it to the office with a summary. */
export const BOT_REPLY_OUTCOMES = ['answered', 'handed_off'] as const;
export type BotReplyOutcome = (typeof BOT_REPLY_OUTCOMES)[number];

/** Why a message went to a person. */
export const BOT_HANDOFF_REASONS = [
  'unknown',
  'sensitive',
  'needs_action',
  'model_failed',
] as const;
export const BotHandoffReason = z.enum(BOT_HANDOFF_REASONS);
export type BotHandoffReason = z.infer<typeof BotHandoffReason>;

/** The office's verdict on an answer the bot sent. */
export const BOT_REVIEWS = ['unreviewed', 'good', 'bad'] as const;
export type BotReview = (typeof BOT_REVIEWS)[number];

/** suggested (learned from the office's reply, waits for approval) → active | archived. */
export const BOT_KNOWLEDGE_STATUSES = ['suggested', 'active', 'archived'] as const;
export type BotKnowledgeStatus = (typeof BOT_KNOWLEDGE_STATUSES)[number];

/** Written by the office, or learned from the office's answer to a question the bot handed off. */
export const BOT_KNOWLEDGE_SOURCES = ['office', 'learned'] as const;
export type BotKnowledgeSource = (typeof BOT_KNOWLEDGE_SOURCES)[number];
