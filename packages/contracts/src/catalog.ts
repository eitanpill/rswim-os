import { z } from 'zod';

/** Shared enums for Phase 1 core data. Stored as text with CHECK constraints built from these lists. */

export const VENUE_KINDS = [
  'country_club',
  'hotel',
  'community_center',
  'municipal',
  'other',
] as const;
export const VenueKind = z.enum(VENUE_KINDS);
export type VenueKind = z.infer<typeof VenueKind>;

/** A venue is temporary by nature (brief §1.2). */
export const VENUE_STATUSES = ['prospect', 'active', 'renovation', 'closing', 'closed'] as const;
export const VenueStatus = z.enum(VENUE_STATUSES);
export type VenueStatus = z.infer<typeof VenueStatus>;

/**
 * Who a pool window admits. `female` = women and girls (e.g. "Monday women/girls"), `male` = men and boys;
 * the narrower values split by age as well.
 */
export const GENDER_RESTRICTIONS = [
  'mixed',
  'female',
  'male',
  'women',
  'men',
  'girls',
  'boys',
] as const;
export const GenderRestriction = z.enum(GENDER_RESTRICTIONS);
export type GenderRestriction = z.infer<typeof GenderRestriction>;

export const RENT_MODELS = [
  'fixed_monthly',
  'per_hour',
  'per_lane_hour',
  'revenue_share',
  'none',
] as const;
export const RentModel = z.enum(RENT_MODELS);
export type RentModel = z.infer<typeof RentModel>;

export const CONTRACT_KINDS = ['rent', 'tender', 'partnership'] as const;
export const ContractKind = z.enum(CONTRACT_KINDS);
export type ContractKind = z.infer<typeof ContractKind>;

/** Who caused a closure decides how it is treated (POLICIES §6). */
export const CLOSURE_SOURCES = [
  'school',
  'venue',
  'authority',
  'technical',
  'water_quality',
  'holiday',
] as const;
export const ClosureSource = z.enum(CLOSURE_SOURCES);
export type ClosureSource = z.infer<typeof ClosureSource>;

export const PROGRAM_KINDS = [
  'group_kids',
  'baby',
  'adult_beginner',
  'adult_style',
  'private',
  'pair',
  'trio',
  'therapy',
  'after_school',
  'intensive_course',
  'camp',
  'school_program',
] as const;
export const ProgramKind = z.enum(PROGRAM_KINDS);
export type ProgramKind = z.infer<typeof ProgramKind>;

/** Program kinds billed per lesson rather than as a monthly group subscription. */
export const PER_LESSON_PROGRAMS: readonly ProgramKind[] = ['private', 'pair', 'trio', 'therapy'];

export const PRICE_ITEM_KINDS = ['monthly', 'trial', 'single', 'package', 'entry_fee'] as const;
export const PriceItemKind = z.enum(PRICE_ITEM_KINDS);
export type PriceItemKind = z.infer<typeof PriceItemKind>;

/** Policy and price scopes, most specific first (ADR-0004). */
export const SCOPE_TYPES = ['class_template', 'venue_program', 'program', 'venue', 'org'] as const;
export const ScopeType = z.enum(SCOPE_TYPES);
export type ScopeType = z.infer<typeof ScopeType>;

export const EMPLOYMENT_TYPES = [
  'employee',
  'freelancer_exempt',
  'freelancer_licensed',
  'hybrid',
] as const;
export const EmploymentType = z.enum(EMPLOYMENT_TYPES);
export type EmploymentType = z.infer<typeof EmploymentType>;

export const CERTIFICATION_TYPES = [
  'swim_instructor',
  'lifeguard',
  'hydrotherapy',
  'baby_swim',
  'first_aid',
  'pool_operator',
] as const;
export const CertificationType = z.enum(CERTIFICATION_TYPES);
export type CertificationType = z.infer<typeof CertificationType>;

export const STAFF_SKILLS = [
  'babies',
  'water_fear',
  'therapy',
  'adults',
  'advanced',
  'special_needs',
] as const;
export const StaffSkill = z.enum(STAFF_SKILLS);
export type StaffSkill = z.infer<typeof StaffSkill>;

/** How a pay rule counts: per hour worked, per session taught, or per student in the session. */
export const PAY_BASES = ['per_hour', 'per_session', 'per_head'] as const;
export const PayBasis = z.enum(PAY_BASES);
export type PayBasis = z.infer<typeof PayBasis>;

/** Where a payroll line goes: the accountant's payslip, or a bank transfer against an invoice. */
export const PAY_ROUTINGS = ['payslip', 'transfer'] as const;
export const PayRouting = z.enum(PAY_ROUTINGS);
export type PayRouting = z.infer<typeof PayRouting>;

export const STUDENT_RELATION_TYPES = ['sibling', 'friend'] as const;
export const StudentRelationType = z.enum(STUDENT_RELATION_TYPES);
export type StudentRelationType = z.infer<typeof StudentRelationType>;

/** 0 = Sunday … 6 = Saturday, matching Postgres `extract(dow)` and JavaScript `getDay()`. */
export const Weekday = z.int().min(0).max(6);
export type Weekday = z.infer<typeof Weekday>;

/** "HH:MM", 24h. */
export const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה');
export type TimeOfDay = z.infer<typeof TimeOfDay>;

/** "YYYY-MM-DD". */
export const LocalDate = z.iso.date();
export type LocalDate = z.infer<typeof LocalDate>;

/** Which students a gender window admits. `null` gender (unknown) is admitted only to mixed windows. */
export function windowAdmits(
  restriction: GenderRestriction,
  person: { gender: 'female' | 'male' | null; isAdult: boolean },
): boolean {
  switch (restriction) {
    case 'mixed':
      return true;
    case 'female':
      return person.gender === 'female';
    case 'male':
      return person.gender === 'male';
    case 'women':
      return person.gender === 'female' && person.isAdult;
    case 'men':
      return person.gender === 'male' && person.isAdult;
    case 'girls':
      return person.gender === 'female' && !person.isAdult;
    case 'boys':
      return person.gender === 'male' && !person.isAdult;
  }
}
