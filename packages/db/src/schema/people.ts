import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { bytea, createdAt, id, orgId, updatedAt } from './_helpers';
import { organizations } from './tenancy';

export const households = pgTable(
  'households',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    preferredLocale: text('preferred_locale').notNull().default('he'),
    billingStatus: text('billing_status').notNull().default('active'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('households_org_id').on(t.organizationId, t.id)],
);

export const guardians = pgTable(
  'guardians',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phoneE164: text('phone_e164'),
    email: text('email'),
    whatsappOptIn: boolean('whatsapp_opt_in').notNull().default(false),
    locale: text('locale').notNull().default('he'),
    relation: text('relation'), // mother, father, self, grandparent…
    isBillingContact: boolean('is_billing_contact').notNull().default(false),
    ghlContactId: text('ghl_contact_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('guardians_org_id').on(t.organizationId, t.id),
    unique('guardians_org_ghl').on(t.organizationId, t.ghlContactId),
    index('guardians_org_phone').on(t.organizationId, t.phoneE164),
    foreignKey({
      name: 'guardians_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
  ],
);

export const students = pgTable(
  'students',
  {
    id: id(),
    organizationId: orgId(),
    householdId: uuid('household_id').notNull(),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    dob: date('dob'),
    gender: text('gender'), // female | male
    school: text('school'),
    grade: text('grade'),
    waterFear: boolean('water_fear').notNull().default(false),
    photoConsent: boolean('photo_consent').notNull().default(true),
    isSelfGuardian: boolean('is_self_guardian').notNull().default(false),
    requiresFemaleInstructor: boolean('requires_female_instructor').notNull().default(false),
    custodyPattern: text('custody_pattern'),
    encMedicalNotes: bytea('enc_medical_notes'),
    encNationalId: bytea('enc_national_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('students_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'students_household_fk',
      columns: [t.organizationId, t.householdId],
      foreignColumns: [households.organizationId, households.id],
    }).onDelete('cascade'),
    check('students_gender_check', sql`${t.gender} is null or ${t.gender} in ('female', 'male')`),
  ],
);

export const staffMembers = pgTable(
  'staff_members',
  {
    id: id(),
    organizationId: orgId().references(() => organizations.id, { onDelete: 'cascade' }),
    firstName: text('first_name').notNull(),
    lastName: text('last_name').notNull(),
    phoneE164: text('phone_e164'),
    email: text('email'),
    gender: text('gender'),
    employmentType: text('employment_type').notNull(), // employee | freelancer_exempt | freelancer_licensed | hybrid
    startDate: date('start_date'),
    endDate: date('end_date'),
    status: text('status').notNull().default('active'),
    encNationalId: bytea('enc_national_id'),
    encBankDetails: bytea('enc_bank_details'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('staff_members_org_id').on(t.organizationId, t.id),
    check(
      'staff_members_employment_type_check',
      sql`${t.employmentType} in ('employee', 'freelancer_exempt', 'freelancer_licensed', 'hybrid')`,
    ),
  ],
);
