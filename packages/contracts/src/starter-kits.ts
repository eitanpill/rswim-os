/**
 * The starter kits a new business gets the moment it opens (SaaS stage 4), one per kind of business. Generic sample
 * content, never a real school's: the owner reviews it and changes anything (prices stay a draft, forms stay drafts
 * until the club publishes them). The demo seed uses the same texts.
 */
import type { CatalogTemplate } from './platform';
import type { DiveAgency, DiveFormKind, DiveProgramKind } from './dive';

// ─── Swim school ────────────────────────────────────────────────────────────

/** Common programs with their levels, and a sample monthly price list (a draft, for the owner to set before use). */
export const SWIM_STARTER_CATALOG = {
  programs: [
    {
      code: 'kids',
      kind: 'group_kids',
      nameHe: 'קבוצות ילדים',
      nameEn: 'Kids groups',
      defaultDurationMin: 45,
      defaultCapacity: 6,
      minAgeMonths: 48,
      maxAgeMonths: 168,
      parentInWater: false,
      levels: [
        { code: 'k1', nameHe: 'הסתגלות למים' },
        { code: 'k2', nameHe: 'ציפה וגלישה' },
        { code: 'k3', nameHe: 'חתירה ראשונה' },
        { code: 'k4', nameHe: 'חתירה וגב' },
        { code: 'k5', nameHe: 'סגנונות ושיפור' },
      ],
    },
    {
      code: 'baby',
      kind: 'baby',
      nameHe: 'שחיית תינוקות (הורה במים)',
      nameEn: 'Baby swim (parent in the water)',
      defaultDurationMin: 30,
      defaultCapacity: 6,
      minAgeMonths: 4,
      maxAgeMonths: 36,
      parentInWater: true,
      levels: [],
    },
    {
      code: 'adults',
      kind: 'adult_beginner',
      nameHe: 'מבוגרים מתחילים',
      nameEn: 'Adult beginners',
      defaultDurationMin: 45,
      defaultCapacity: 6,
      minAgeMonths: 216,
      maxAgeMonths: null,
      parentInWater: false,
      levels: [],
    },
    {
      code: 'private',
      kind: 'private',
      nameHe: 'שיעור פרטי',
      nameEn: 'Private lesson',
      defaultDurationMin: 30,
      defaultCapacity: 1,
      minAgeMonths: null,
      maxAgeMonths: null,
      parentInWater: false,
      levels: [],
    },
  ],
  prices: [
    {
      program: 'kids',
      kind: 'monthly',
      durationMin: 45,
      sessionsCount: null,
      amountAgorot: 32000,
      label: 'פעם בשבוע',
    },
    {
      program: 'kids',
      kind: 'trial',
      durationMin: 45,
      sessionsCount: null,
      amountAgorot: 6000,
      label: 'שיעור ניסיון',
    },
    {
      program: 'baby',
      kind: 'monthly',
      durationMin: 30,
      sessionsCount: null,
      amountAgorot: 30000,
      label: 'פעם בשבוע',
    },
    {
      program: 'adults',
      kind: 'monthly',
      durationMin: 45,
      sessionsCount: null,
      amountAgorot: 34000,
      label: 'פעם בשבוע',
    },
    {
      program: 'private',
      kind: 'single',
      durationMin: 30,
      sessionsCount: null,
      amountAgorot: 18000,
      label: null,
    },
    {
      program: 'private',
      kind: 'package',
      durationMin: 30,
      sessionsCount: 10,
      amountAgorot: 165000,
      label: '10 שיעורים',
    },
  ],
} satisfies CatalogTemplate;

// ─── Freediving club ────────────────────────────────────────────────────────

export interface DiveStarterProgram {
  code: string;
  nameHe: string;
  nameEn: string;
  kind: DiveProgramKind;
  agency: DiveAgency;
  minLevel: number;
  grantsLevel: number | null;
  days: number;
  durationMin: number;
  maxDepthM: number | null;
  priceAgorot: number;
  color: string;
  description: string;
}

/** Programs most clubs run; the owner edits prices and turns off what the club doesn't teach. */
export const DIVE_STARTER_PROGRAMS: readonly DiveStarterProgram[] = [
  {
    code: 'discover',
    nameHe: 'חוויית צלילה חופשית',
    nameEn: 'Discover freediving',
    kind: 'experience',
    agency: 'club',
    minLevel: 0,
    grantsLevel: 1,
    days: 1,
    durationMin: 180,
    maxDepthM: 8,
    priceAgorot: 39000,
    color: '#2dd4bf',
    description: 'נשימה ורגיעה, ואז צלילות ראשונות לאורך חבל. בלי ניסיון קודם.',
  },
  {
    code: 'course1',
    nameHe: 'קורס צלילה חופשית רמה 1',
    nameEn: 'Freediving course level 1',
    kind: 'course',
    agency: 'club',
    minLevel: 0,
    grantsLevel: 2,
    days: 2,
    durationMin: 420,
    maxDepthM: 16,
    priceAgorot: 165000,
    color: '#38bdf8',
    description:
      'תיאוריה, סטטי, השוואת לחצים, הצלה, וצלילות בים. אפשר לשנות לסוכנות שהמועדון מלמד בה.',
  },
  {
    code: 'line',
    nameHe: 'אימון חבלים',
    nameEn: 'Line training',
    kind: 'training',
    agency: 'club',
    minLevel: 2,
    grantsLevel: null,
    days: 1,
    durationMin: 150,
    maxDepthM: 30,
    priceAgorot: 18000,
    color: '#14b8a6',
    description: 'אימון עומק על חבלים, מדריך לכל שלושה צוללים, צלילה בזוגות.',
  },
  {
    code: 'pool',
    nameHe: 'אימון בריכה: סטטי ודינמי',
    nameEn: 'Pool: static & dynamic',
    kind: 'training',
    agency: 'club',
    minLevel: 1,
    grantsLevel: null,
    days: 1,
    durationMin: 90,
    maxDepthM: null,
    priceAgorot: 12000,
    color: '#22d3ee',
    description: 'טבלאות סטטי ודינמי עם בטיחות צמודה.',
  },
];

export const DIVE_HEALTH_QUESTIONS = [
  {
    code: 'heart',
    he: 'האם אובחנת אי פעם במחלת לב, הפרעת קצב, או שאתה/את נוטל/ת תרופות ללב או ללחץ דם?',
    flag: true,
  },
  {
    code: 'lungs',
    he: 'האם יש או הייתה לך אסתמה, מחלת ריאות, או קריסת ריאה (פנאומוטורקס)?',
    flag: true,
  },
  {
    code: 'epilepsy',
    he: 'האם סבלת אי פעם מאפילפסיה, פרכוסים, אובדן הכרה או עילפונים?',
    flag: true,
  },
  { code: 'diabetes', he: 'האם יש לך סוכרת שמטופלת בתרופות או באינסולין?', flag: true },
  {
    code: 'ears',
    he: 'האם עברת ניתוח באוזניים או בסינוסים, או שיש לך קושי חוזר להשוות לחץ?',
    flag: true,
  },
  { code: 'surgery', he: 'האם עברת ניתוח או אשפוז בשנה האחרונה?', flag: true },
  { code: 'pregnant', he: 'האם את בהיריון או שייתכן שאת בהיריון?', flag: true },
  {
    code: 'meds',
    he: 'האם את/ה נוטל/ת כרגע תרופות קבועות (מלבד גלולות או ויטמינים)?',
    flag: false,
  },
  { code: 'cold', he: 'האם יש לך כרגע הצטננות, גודש או דלקת אוזניים?', flag: false },
  { code: 'blackout', he: 'האם היה לך בעבר אובדן הכרה (בלאקאאוט) או סמבה בצלילה?', flag: false },
] as const;

export const DIVE_HEALTH_BODY = `הצהרת בריאות לצלילה חופשית (נוסח לדוגמה)

צלילה חופשית היא פעילות בעצירת נשימה, ומצבים רפואיים מסוימים מגדילים בה את הסיכון. כדי שנוכל לשמור עליך, ענה/י בכנות על כל השאלות. תשובת "כן" אינה פוסלת אותך: היא אומרת שנבקש אישור רופא או שנבדוק יחד לפני הכניסה למים.

אני מצהיר/ה כי:
1. התשובות שנתתי נכונות ומלאות.
2. אעדכן את המועדון לפני כל צלילה אם חל שינוי במצבי הבריאותי.
3. ידוע לי שהמועדון רשאי שלא לאפשר לי להיכנס למים אם מצבי אינו מאפשר זאת בבטחה.

ההצהרה תקפה לשנה מיום החתימה.`;

export const DIVE_WAIVER_BODY = `כתב ויתור, הסכמה ושחרור מאחריות (נוסח לדוגמה)

1. ידוע לי שצלילה חופשית, ביחס לכל פעילות במים פתוחים ובבריכה, כרוכה בסיכונים, ובהם אובדן שליטה מוטורית (סמבה), אובדן הכרה, פגיעות לחץ באוזניים, בסינוסים ובריאות, פגיעה מבעלי חיים ימיים, וכן סיכונים הנובעים ממזג האוויר ומתנאי הים.
2. אני מתחייב/ת לפעול לפי הוראות המדריכים ונהלי הבטיחות של המועדון, לצלול רק עם בן/בת זוג (באדי) ובחבל מסומן, ולא לחרוג מהעומק שאושר לי.
3. אני מאשר/ת שאני כשיר/ה לפעילות, שמילאתי הצהרת בריאות נכונה, ושאודיע למדריך על כל שינוי או תחושה חריגה.
4. בכפוף לדין, אני משחרר/ת את המועדון, עובדיו ומדריכיו מאחריות לנזק שייגרם לי כתוצאה מהסיכונים הטבועים בפעילות, למעט נזק שנגרם ברשלנות.
5. אני מסכים/ה לצילום במהלך הפעילות לצורכי בטיחות והדרכה.

כתב הוויתור תקף לשנה מיום החתימה.`;

export const DIVE_INSURANCE_BODY = `עדכון ביטוח צלילה (נוסח לדוגמה)

המועדון ממליץ לכל צולל/ת להחזיק ביטוח בתוקף שמכסה צלילה חופשית, כולל חילוץ ופינוי. מלאו את פרטי הפוליסה ואת תאריך הסיום, וצרפו צילום אם יש. נזכיר לכם לפני שהביטוח נגמר.`;

/** The club's three forms, opened as drafts: the club reads them, changes what it needs, and publishes. */
export const DIVE_STARTER_FORMS: readonly {
  kind: DiveFormKind;
  title: string;
  body: string;
  questions: readonly { code: string; he: string; flag: boolean }[];
}[] = [
  {
    kind: 'health',
    title: 'הצהרת בריאות',
    body: DIVE_HEALTH_BODY,
    questions: DIVE_HEALTH_QUESTIONS,
  },
  { kind: 'waiver', title: 'כתב ויתור ושחרור מאחריות', body: DIVE_WAIVER_BODY, questions: [] },
  { kind: 'insurance', title: 'עדכון ביטוח צלילה', body: DIVE_INSURANCE_BODY, questions: [] },
];
