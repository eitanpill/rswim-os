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

/** One source's month (WhatsApp track W4): how many leads came, how many booked a trial, how many joined. */
export interface SourceMonth {
  source: string;
  leads: number;
  trials: number;
  joined: number;
}

/**
 * The monthly sources report: the busiest source first, with each one's joining rate (whole percent, null without
 * leads) and a total row.
 */
export function sourcesReport(rows: readonly SourceMonth[]): {
  rows: (SourceMonth & { rate: number | null })[];
  total: SourceMonth & { rate: number | null };
} {
  const rate = (r: SourceMonth) => (r.leads ? Math.round((r.joined / r.leads) * 100) : null);
  const total = rows.reduce(
    (t, r) => ({
      source: 'total',
      leads: t.leads + r.leads,
      trials: t.trials + r.trials,
      joined: t.joined + r.joined,
    }),
    { source: 'total', leads: 0, trials: 0, joined: 0 },
  );
  return {
    rows: [...rows]
      .sort((a, b) => b.leads - a.leads || b.joined - a.joined || a.source.localeCompare(b.source))
      .map((r) => ({ ...r, rate: rate(r) })),
    total: { ...total, rate: rate(total) },
  };
}

/** The month before and after `YYYY-MM`, for the report's arrows. */
export function monthSteps(month: string): { prev: string; next: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const at = (k: number) => {
    const d = new Date(Date.UTC(y, m - 1 + k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  return { prev: at(-1), next: at(1) };
}
