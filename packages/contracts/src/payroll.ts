/**
 * Staff operations and payroll (brief §6.8–6.9): timesheets, payroll runs and lines, adjustments, sick leave,
 * substitute requests and offers, and the applicant pipeline.
 */
import { z } from 'zod';

/** open → confirmed | disputed; a dispute ends resolved by the owner. */
export const TIMESHEET_STATUSES = ['open', 'confirmed', 'disputed', 'resolved'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export const PAYROLL_RUN_STATUSES = ['draft', 'approved'] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_LINE_KINDS = ['work', 'travel', 'adjustment'] as const;
export type PayrollLineKind = (typeof PAYROLL_LINE_KINDS)[number];

/** What an hour of work was: a group lesson or a booked private / therapy slot. */
export const WORK_KINDS = ['group', 'slot'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export const ADJUSTMENT_KINDS = ['bonus', 'correction', 'expense'] as const;
export const AdjustmentKind = z.enum(ADJUSTMENT_KINDS);
export type AdjustmentKind = z.infer<typeof AdjustmentKind>;

/** Sick leave in half days: accrued by an approved run, taken when the owner records a sick day. */
export const SICK_ENTRY_KINDS = ['accrual', 'taken'] as const;
export type SickEntryKind = (typeof SICK_ENTRY_KINDS)[number];

export const SUBSTITUTE_REQUEST_STATUSES = ['open', 'filled', 'unfilled', 'cancelled'] as const;
export type SubstituteRequestStatus = (typeof SUBSTITUTE_REQUEST_STATUSES)[number];

/** queued (a later wave) → offered → accepted | declined; the rest are withdrawn once someone accepts. */
export const SUBSTITUTE_OFFER_STATUSES = [
  'queued',
  'offered',
  'accepted',
  'declined',
  'withdrawn',
] as const;
export type SubstituteOfferStatus = (typeof SUBSTITUTE_OFFER_STATUSES)[number];

export const APPLICANT_STAGES = [
  'new',
  'screening',
  'trial_day',
  'offer',
  'hired',
  'talent_pool',
  'rejected',
] as const;
export const ApplicantStage = z.enum(APPLICANT_STAGES);
export type ApplicantStage = z.infer<typeof ApplicantStage>;

export const APPLICANT_SOURCES = [
  'facebook',
  'college',
  'referral',
  'swim_club',
  'website',
  'other',
] as const;
export const ApplicantSource = z.enum(APPLICANT_SOURCES);
export type ApplicantSource = z.infer<typeof ApplicantSource>;
