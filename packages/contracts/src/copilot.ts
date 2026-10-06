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
