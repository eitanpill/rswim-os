import { z } from 'zod';

/** Scheduling enums (brief §5 "Programs & scheduling", "Enrollment"), shared by the database checks and Zod. */

export const TERM_KINDS = ['school_year', 'summer', 'course', 'custom'] as const;
export const TermKind = z.enum(TERM_KINDS);
export type TermKind = z.infer<typeof TermKind>;

/** Who a group admits. The pool window may narrow it further (girls, women…). */
export const ADMITTED_GENDERS = ['mixed', 'female', 'male'] as const;
export const AdmittedGender = z.enum(ADMITTED_GENDERS);
export type AdmittedGender = z.infer<typeof AdmittedGender>;

export const SESSION_STATUSES = [
  'scheduled',
  'cancelled_by_school',
  'cancelled_external',
  'completed',
] as const;
export const SessionStatus = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof SessionStatus>;

export const SESSION_STAFF_ROLES = ['lead', 'assistant', 'substitute'] as const;
export const SessionStaffRole = z.enum(SESSION_STAFF_ROLES);
export type SessionStaffRole = z.infer<typeof SessionStaffRole>;

/** The full lifecycle from the brief. Phase 2 places children as `active` or `trial_booked`; Phase 3 adds the flow. */
export const ENROLLMENT_STATUSES = [
  'lead',
  'trial_booked',
  'trial_done',
  'active',
  'frozen',
  'cancel_requested',
  'cancelled',
  'completed',
] as const;
export const EnrollmentStatus = z.enum(ENROLLMENT_STATUSES);
export type EnrollmentStatus = z.infer<typeof EnrollmentStatus>;

/** Statuses that hold a seat in a group. */
export const SEAT_HOLDING_STATUSES: readonly EnrollmentStatus[] = [
  'trial_booked',
  'active',
  'frozen',
  'cancel_requested',
];

export const SLOT_KINDS = ['private', 'pair', 'trio', 'therapy', 'trial', 'makeup'] as const;
export const SlotKind = z.enum(SLOT_KINDS);
export type SlotKind = z.infer<typeof SlotKind>;

/** Seats per slot kind unless the owner sets another capacity. */
export const SLOT_DEFAULT_CAPACITY: Record<SlotKind, number> = {
  private: 1,
  pair: 2,
  trio: 3,
  therapy: 1,
  trial: 1,
  makeup: 1,
};

export const SLOT_STATUSES = ['open', 'full', 'cancelled'] as const;
export const SlotStatus = z.enum(SLOT_STATUSES);
export type SlotStatus = z.infer<typeof SlotStatus>;

export const BOOKING_STATUSES = ['booked', 'cancelled'] as const;
export const BookingStatus = z.enum(BOOKING_STATUSES);
export type BookingStatus = z.infer<typeof BookingStatus>;

export const WAITLIST_STATUSES = ['waiting', 'offered', 'placed', 'withdrawn'] as const;
export const WaitlistStatus = z.enum(WAITLIST_STATUSES);
export type WaitlistStatus = z.infer<typeof WaitlistStatus>;

/**
 * A change to an instructor's shift (brief §6.3 change-protection rule):
 * - `reassign_group`: a group gets another lead instructor from a date on;
 * - `reassign_session`: one session gets another lead instructor;
 * - `reschedule_session`: one session moves to another time on the same day.
 */
export const SHIFT_CHANGE_KINDS = [
  'reassign_group',
  'reassign_session',
  'reschedule_session',
] as const;
export const ShiftChangeKind = z.enum(SHIFT_CHANGE_KINDS);
export type ShiftChangeKind = z.infer<typeof ShiftChangeKind>;

export const SHIFT_CHANGE_STATUSES = [
  'pending',
  'accepted',
  'declined',
  'escalated',
  'applied',
  'cancelled',
] as const;
export const ShiftChangeStatus = z.enum(SHIFT_CHANGE_STATUSES);
export type ShiftChangeStatus = z.infer<typeof ShiftChangeStatus>;

export const STAFF_GENDERS = ['female', 'male'] as const;
export const StaffGender = z.enum(STAFF_GENDERS);
export type StaffGender = z.infer<typeof StaffGender>;
