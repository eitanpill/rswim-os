/**
 * Bringing a business's data in from a file (SaaS stage 5): what can be imported, the fields each kind of file fills,
 * and the column names that point at each field in the files schools and clubs keep (Hebrew and English). The owner
 * confirms or corrects the guess before anything is saved.
 */
import { z } from 'zod';

/** families: a swim school's families and children; divers: a club's divers; staff: either kind's team. */
export const IMPORT_KINDS = ['families', 'divers', 'staff'] as const;
export const ImportKind = z.enum(IMPORT_KINDS);
export type ImportKind = z.infer<typeof ImportKind>;

/** The kinds each kind of business imports. */
export const IMPORT_KINDS_BY_VERTICAL = {
  swim: ['families', 'staff'],
  freediving: ['divers', 'staff'],
} as const satisfies Record<string, readonly ImportKind[]>;

export const IMPORT_STATUSES = ['draft', 'running', 'succeeded', 'failed', 'undone'] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** One file's limits: rows read, bytes uploaded. */
export const IMPORT_MAX_ROWS = 3000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
/** An import can be taken back for this long after it was saved. */
export const IMPORT_UNDO_HOURS = 24;

export const FAMILY_FIELDS = [
  'parentFullName',
  'parentFirstName',
  'parentLastName',
  'phone',
  'email',
  'parent2FullName',
  'parent2Phone',
  'childFullName',
  'childFirstName',
  'childLastName',
  'childDob',
  'childGender',
  'level',
  'group',
  'balance',
  'notes',
] as const;

export const DIVER_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'phone',
  'email',
  'dob',
  'gender',
  'certLevel',
  'certAgency',
  'certNumber',
  'city',
  'emergencyName',
  'emergencyPhone',
  'notes',
] as const;

export const STAFF_FIELDS = [
  'fullName',
  'firstName',
  'lastName',
  'phone',
  'email',
  'gender',
  'employmentType',
  'startDate',
  'notes',
] as const;

export type FamilyField = (typeof FAMILY_FIELDS)[number];
export type DiverField = (typeof DIVER_FIELDS)[number];
export type StaffField = (typeof STAFF_FIELDS)[number];
export type ImportField = FamilyField | DiverField | StaffField;

export const IMPORT_FIELDS: Record<ImportKind, readonly ImportField[]> = {
  families: FAMILY_FIELDS,
  divers: DIVER_FIELDS,
  staff: STAFF_FIELDS,
};

/** Column index → field ('' = not imported). */
export const ImportMapping = z.record(z.string().regex(/^\d+$/), z.string());
export type ImportMapping = Record<string, ImportField | ''>;

/**
 * Column names that mean each field, compared after `normalizeHeader`. A header matches a field when it equals one of
 * these, or (for names of 3 letters or more) contains one; the longest match wins.
 */
export const HEADER_SYNONYMS: Record<ImportKind, Partial<Record<ImportField, readonly string[]>>> = {
  families: {
    parentFullName: [
      'שם הורה', 'שם ההורה', 'הורה', 'שם האם', 'שם האמא', 'שם אמא', 'אמא', 'שם האב', 'שם אבא', 'אבא',
      'איש קשר', 'שם איש קשר', 'parent', 'parent name', 'guardian', 'contact', 'contact name', 'mother', 'father',
    ],
    parentFirstName: ['שם פרטי הורה', 'שם פרטי של ההורה', 'parent first name', 'guardian first name'],
    parentLastName: ['שם משפחה', 'משפחה', 'שם משפחה הורה', 'last name', 'surname', 'family name', 'parent last name'],
    phone: [
      'טלפון', 'נייד', 'פלאפון', 'סלולרי', 'טלפון הורה', 'נייד הורה', 'טלפון נייד', 'מספר טלפון', 'phone', 'mobile',
      'cell', 'phone number', 'tel',
    ],
    email: ['אימייל', 'מייל', 'דואל', 'דוא"ל', 'דואר אלקטרוני', 'email', 'e-mail', 'mail'],
    parent2FullName: ['הורה 2', 'הורה שני', 'שם הורה 2', 'שם הורה שני', 'parent 2', 'second parent'],
    parent2Phone: ['טלפון הורה 2', 'טלפון הורה שני', 'נייד הורה 2', 'טלפון 2', 'נייד 2', 'phone 2', 'second phone'],
    childFullName: [
      'שם הילד', 'שם ילד', 'שם הילדה', 'ילד', 'ילדה', 'שם התלמיד', 'שם תלמיד', 'תלמיד', 'שם השחיין', 'שחיין',
      'שם המשתתף', 'משתתף', 'child', 'child name', 'student', 'student name', 'kid', 'swimmer',
    ],
    childFirstName: ['שם פרטי', 'שם פרטי ילד', 'שם פרטי תלמיד', 'first name', 'child first name', 'student first name'],
    childLastName: ['שם משפחה ילד', 'שם משפחה תלמיד', 'child last name', 'student last name'],
    childDob: ['תאריך לידה', 'ת. לידה', 'ת לידה', 'לידה', 'יום הולדת', 'date of birth', 'birth date', 'birthday', 'dob'],
    childGender: ['מין', 'מגדר', 'בן/בת', 'בן בת', 'gender', 'sex'],
    level: ['רמה', 'שלב', 'דרגה', 'level', 'stage'],
    group: ['קבוצה', 'שם קבוצה', 'חוג', 'כיתה', 'שיעור', 'group', 'class', 'course'],
    balance: ['יתרה', 'חוב', 'יתרת חוב', 'יתרה לתשלום', 'לתשלום', 'balance', 'debt', 'owed', 'amount due'],
    notes: ['הערות', 'הערה', 'notes', 'note', 'comments', 'remarks'],
  },
  divers: {
    fullName: ['שם מלא', 'שם', 'שם הצולל', 'שם לקוח', 'לקוח', 'צולל', 'full name', 'name', 'diver', 'customer'],
    firstName: ['שם פרטי', 'first name', 'given name'],
    lastName: ['שם משפחה', 'משפחה', 'last name', 'surname', 'family name'],
    phone: ['טלפון', 'נייד', 'פלאפון', 'סלולרי', 'טלפון נייד', 'מספר טלפון', 'phone', 'mobile', 'cell', 'tel'],
    email: ['אימייל', 'מייל', 'דואל', 'דוא"ל', 'דואר אלקטרוני', 'email', 'e-mail', 'mail'],
    dob: ['תאריך לידה', 'ת. לידה', 'ת לידה', 'לידה', 'date of birth', 'birth date', 'birthday', 'dob'],
    gender: ['מין', 'מגדר', 'gender', 'sex'],
    certLevel: ['רמה', 'דרגה', 'רמת הסמכה', 'הסמכה', 'כוכבים', 'level', 'cert level', 'certification', 'stars'],
    certAgency: ['ארגון', 'ארגון הסמכה', 'סוכנות', 'agency', 'organization', 'cert agency'],
    certNumber: ['מספר הסמכה', 'מס הסמכה', 'מספר תעודה', 'תעודה', 'cert number', 'certificate', 'certificate number'],
    city: ['עיר', 'יישוב', 'מקום מגורים', 'city', 'town'],
    emergencyName: ['איש קשר לחירום', 'קשר חירום', 'חירום', 'emergency contact', 'emergency name', 'emergency'],
    emergencyPhone: ['טלפון חירום', 'טלפון לחירום', 'emergency phone'],
    notes: ['הערות', 'הערה', 'notes', 'note', 'comments', 'remarks'],
  },
  staff: {
    fullName: ['שם מלא', 'שם', 'שם העובד', 'שם המדריך', 'עובד', 'מדריך', 'מדריכה', 'full name', 'name', 'employee', 'instructor'],
    firstName: ['שם פרטי', 'first name', 'given name'],
    lastName: ['שם משפחה', 'משפחה', 'last name', 'surname', 'family name'],
    phone: ['טלפון', 'נייד', 'פלאפון', 'סלולרי', 'טלפון נייד', 'מספר טלפון', 'phone', 'mobile', 'cell', 'tel'],
    email: ['אימייל', 'מייל', 'דואל', 'דוא"ל', 'דואר אלקטרוני', 'email', 'e-mail', 'mail'],
    gender: ['מין', 'מגדר', 'gender', 'sex'],
    employmentType: ['סוג העסקה', 'העסקה', 'שכיר/עצמאי', 'שכיר עצמאי', 'סטטוס העסקה', 'employment', 'employment type'],
    startDate: ['תאריך התחלה', 'תחילת עבודה', 'התחיל', 'start date', 'started', 'hired'],
    notes: ['הערות', 'הערה', 'notes', 'note', 'comments', 'remarks'],
  },
};

/** Lowercase, no quotes, punctuation or extra spaces: "שם האמא:" and " שם  האמא" compare equal. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["'`׳״]/g, '')
    .replace(/[^\p{L}\p{N}/ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
