import { z } from 'zod';

/** Attendance, absences, makeups, trials, forms and closures (brief §5 "Attendance", "Makeups", "Forms"). */

/** Who a lineup row is: a child holding a seat in the group, a makeup guest, or a trial. */
export const ATTENDANCE_KINDS = ['member', 'makeup', 'trial'] as const;
export const AttendanceKind = z.enum(ATTENDANCE_KINDS);
export type AttendanceKind = z.infer<typeof AttendanceKind>;

/** `late` attended; arriving later than `attendance.late_threshold_min` is recorded as `absent`. */
export const ATTENDANCE_STATUSES = ['present', 'late', 'absent'] as const;
export const AttendanceStatus = z.enum(ATTENDANCE_STATUSES);
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

export const ABSENCE_CHANNELS = [
  'parent_portal',
  'phone',
  'whatsapp',
  'instructor',
  'other',
] as const;
export const AbsenceChannel = z.enum(ABSENCE_CHANNELS);
export type AbsenceChannel = z.infer<typeof AbsenceChannel>;

/** A notice waits (`pending`) until it is classified against the regulations (`processed`). */
export const ABSENCE_NOTICE_STATUSES = ['pending', 'processed', 'withdrawn'] as const;
export const AbsenceNoticeStatus = z.enum(ABSENCE_NOTICE_STATUSES);
export type AbsenceNoticeStatus = z.infer<typeof AbsenceNoticeStatus>;

export const ABSENCE_CLASSIFICATIONS = ['timely', 'late_notice'] as const;
export const AbsenceClassification = z.enum(ABSENCE_CLASSIFICATIONS);
export type AbsenceClassification = z.infer<typeof AbsenceClassification>;

export const CREDIT_REASONS = [
  'notified_absence',
  'school_cancellation',
  'external_closure',
  'goodwill',
] as const;
export const CreditReason = z.enum(CREDIT_REASONS);
export type CreditReason = z.infer<typeof CreditReason>;

/** `converted`: a closure ended with the credit turned into money (Phase 4 ledger). `void`: withdrawn by the owner. */
export const CREDIT_STATUSES = ['open', 'booked', 'used', 'expired', 'converted', 'void'] as const;
export const CreditStatus = z.enum(CREDIT_STATUSES);
export type CreditStatus = z.infer<typeof CreditStatus>;

export const MAKEUP_BOOKING_STATUSES = ['booked', 'attended', 'missed', 'cancelled'] as const;
export const MakeupBookingStatus = z.enum(MAKEUP_BOOKING_STATUSES);
export type MakeupBookingStatus = z.infer<typeof MakeupBookingStatus>;

export const TRIAL_STATUSES = ['booked', 'attended', 'no_show', 'cancelled'] as const;
export const TrialStatus = z.enum(TRIAL_STATUSES);
export type TrialStatus = z.infer<typeof TrialStatus>;

export const TRIAL_OUTCOMES = ['fit', 'not_fit'] as const;
export const TrialOutcome = z.enum(TRIAL_OUTCOMES);
export type TrialOutcome = z.infer<typeof TrialOutcome>;

export const FORM_KINDS = [
  'registration',
  'health_declaration',
  'regulations',
  'photo_consent',
] as const;
export const FormKind = z.enum(FORM_KINDS);
export type FormKind = z.infer<typeof FormKind>;

/** Forms signed per child; the others are signed once per household. */
export const PER_STUDENT_FORMS: readonly FormKind[] = ['health_declaration', 'photo_consent'];

export const FORM_CHANNELS = ['parent_portal', 'owner_recorded', 'paper'] as const;
export const FormChannel = z.enum(FORM_CHANNELS);
export type FormChannel = z.infer<typeof FormChannel>;

/** A mass cancellation (brief §6.5): draft while the owner checks the preview, open while makeups run. */
export const CLOSURE_EVENT_STATUSES = ['draft', 'open', 'closed', 'cancelled'] as const;
export const ClosureEventStatus = z.enum(CLOSURE_EVENT_STATUSES);
export type ClosureEventStatus = z.infer<typeof ClosureEventStatus>;

export const CLOSURE_END_RULES = ['expire', 'convert_to_credit', 'partial_refund'] as const;
export const ClosureEndRule = z.enum(CLOSURE_END_RULES);
export type ClosureEndRule = z.infer<typeof ClosureEndRule>;

export const MAKEUP_GUARANTEES = ['guaranteed', 'best_effort', 'none'] as const;
export const MakeupGuarantee = z.enum(MAKEUP_GUARANTEES);
export type MakeupGuarantee = z.infer<typeof MakeupGuarantee>;
