/**
 * Pure rules of the lead list (WhatsApp track, stage 1). The database triggers that move a lead on a join request,
 * a trial or a new family follow the same order (app.lead_stage_rank, migration 0065).
 */
import type { LeadStage } from '@rswim/contracts';

const RANK: Record<LeadStage, number> = { lost: 0, new: 1, talking: 2, trial_booked: 3, joined: 4 };

/** The stage after something happened: a stage only moves forward, and a lost lead comes back when it acts again. */
export function leadStageAfter(current: LeadStage | null, happened: LeadStage): LeadStage {
  if (current === null || current === 'lost') return happened;
  return RANK[happened] > RANK[current] ? happened : current;
}

/** A WhatsApp message from the lead's number: a new number opens a lead, a lost one comes back as new. */
export function leadStageAfterMessage(current: LeadStage | null): LeadStage {
  return leadStageAfter(current, 'new');
}

export type LeadAttention = 'reply' | 'follow_up' | null;

/**
 * What the office owes a lead: an answer to a new one waiting more than `replyHours`, or the follow-up it promised
 * (next action date today or before). Leads that joined or dropped owe nothing.
 */
export function leadAttention(
  lead: { stage: LeadStage; stageChangedAt: Date; nextActionOn: string | null },
  now: Date,
  today: string,
  replyHours = 2,
): LeadAttention {
  if (lead.stage === 'joined' || lead.stage === 'lost') return null;
  if (lead.nextActionOn !== null && lead.nextActionOn <= today) return 'follow_up';
  if (
    lead.stage === 'new' &&
    now.getTime() - lead.stageChangedAt.getTime() > replyHours * 3_600_000
  )
    return 'reply';
  return null;
}
