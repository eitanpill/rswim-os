/**
 * Leads (WhatsApp track, stage 1): one list of people who asked about the business and are not customers yet, for
 * swim schools and freediving clubs alike. A new number writing on WhatsApp opens one; a join request, a trial and
 * a new family or diver move it on. The office moves it by hand too.
 */
export const LEAD_STAGES = ['new', 'talking', 'trial_booked', 'joined', 'lost'] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

/** Stages a lead is still being worked in (the board's open columns). */
export const OPEN_LEAD_STAGES = [
  'new',
  'talking',
  'trial_booked',
] as const satisfies readonly LeadStage[];

export const LEAD_SOURCES = [
  'whatsapp',
  'join_link',
  'instagram',
  'facebook',
  'google',
  'website',
  'referral',
  'hotel',
  'walk_in',
  'phone',
  'other',
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

/** Why a lead did not become a customer (one tap when the office marks it lost). */
export const LEAD_LOST_REASONS = [
  'price',
  'schedule',
  'location',
  'no_answer',
  'chose_other',
  'not_relevant',
  'other',
] as const;
export type LeadLostReason = (typeof LEAD_LOST_REASONS)[number];
