import { PRODUCT } from '@rswim/contracts';

/**
 * The public privacy policy (Meta needs its URL to publish the WhatsApp app; the stores need one too).
 * It says only what the system actually does today. A lawyer reviews it before the first paying school
 * (docs/saas/PIT-TASKS.md, section 3); change it here, in both languages, and move UPDATED.
 */
export const UPDATED = '2026-11-21';

export interface Section {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

export interface Policy {
  lang: 'he' | 'en';
  dir: 'rtl' | 'ltr';
  title: string;
  updated: string;
  intro: string[];
  sections: Section[];
}

const email = PRODUCT.supportEmail;

export const HE: Policy = {
  lang: 'he',
  dir: 'rtl',
  title: `מדיניות פרטיות: ${PRODUCT.name}`,
  updated: 'עודכן לאחרונה: 21 בנובמבר 2026',
  intro: [
    `${PRODUCT.name} היא מערכת לניהול בתי ספר לשחייה ומועדוני צלילה (להלן "העסק"). העסק משתמש במערכת כדי לנהל את הלקוחות שלו: משפחות, תלמידים וצוללים. המערכת זמינה באתר ${PRODUCT.domain} ובאפליקציה.`,
    'המידע על הלקוחות של עסק שייך לעסק ומנוהל על ידו. אנחנו מפעילים את המערכת עבורו. העמוד הזה מסביר איזה מידע נשמר במערכת, למה, איפה, עם מי הוא משותף ואיך מוחקים אותו.',
  ],
  sections: [
    {
      title: 'איזה מידע נשמר',
      items: [
        'בעלי עסקים וצוות: שם, טלפון, אימייל ופרטי התחברות.',
        'הורים, תלמידים וצוללים: שמות, טלפון, אימייל, שמות ותאריכי לידה של ילדים, שיבוץ לקבוצות ושיעורים, נוכחות, הסעות ומנויים.',
        'כסף: חיובים, תשלומים וקבלות. התשלום עצמו עובר דרך חברת הסליקה שהעסק בחר, ואנחנו לא שומרים מספרי כרטיסי אשראי. מספר תעודת זהות של משלם, כשנדרש לקבלה, נשמר מוצפן.',
        'טפסים ומסמכים שהעסק מבקש: הצהרות בריאות, כתבי ויתור, ביטוח, חתימות ותעודות (למשל תעודת צלילה). קבצים נשמרים באחסון פרטי.',
        'הודעות: הודעות וואטסאפ, SMS ואימייל שהוחלפו בין הלקוח לעסק דרך המערכת.',
        'נתונים טכניים: רישום פעולות במערכת (מי שינה מה ומתי) ודיווחי תקלות.',
      ],
    },
    {
      title: 'וואטסאפ',
      paragraphs: [
        'עסק יכול לחבר למערכת את מספר הוואטסאפ העסקי שלו דרך WhatsApp Business Platform של Meta. הודעות שנשלחות למספר הזה מגיעות למערכת ונשמרות בשיחות של אותו עסק בלבד, כדי שהעסק יוכל לענות, לקבוע שיעורים, לשלוח תזכורות, קישורי תשלום וקבלות.',
        'אם העסק הפעיל זאת, עוזר אוטומטי (בינה מלאכותית) עונה בשם העסק ומבצע פעולות לפי ההרשאות שהעסק קבע. איש צוות יכול להשתלט על שיחה בכל רגע, ואז העוזר שותק. הודעות יזומות נשלחות רק בתבניות ש-Meta אישרה.',
        'אנחנו לא משתמשים בהודעות לפרסום, לא מוכרים אותן ולא משתפים אותן עם עסקים אחרים.',
      ],
    },
    {
      title: 'למה משתמשים במידע',
      items: [
        'כדי להפעיל את השירות: לוח שיעורים, נוכחות, הרשמה, חיובים, קבלות, תזכורות ותשובות ללקוחות.',
        'כדי להראות לבעל העסק תמונת מצב, התראות וסיכומים על העסק שלו.',
        'כדי לאבטח את המערכת, לאתר תקלות ולתקן אותן.',
      ],
    },
    {
      title: 'איפה המידע נשמר ואיך הוא מוגן',
      items: [
        'מסד הנתונים וההתחברות נמצאים ב-Supabase, באזור פרנקפורט (האיחוד האירופי).',
        'כל עסק רואה רק את המידע שלו, וכל משתמש רואה רק מה שהתפקיד שלו מתיר (בעלים, משרד, מדריך, הורה). ההפרדה נאכפת במסד הנתונים עצמו.',
        'שדות רגישים מוצפנים במפתח נפרד לכל עסק. התקשורת מוצפנת (HTTPS).',
      ],
    },
    {
      title: 'עם מי המידע משותף',
      paragraphs: [
        'אנחנו לא מוכרים מידע אישי. המידע עובר רק לספקים שמפעילים חלק מהשירות, ורק במידה הדרושה לכך:',
      ],
      items: [
        'Supabase: מסד נתונים, התחברות ואחסון קבצים.',
        'Vercel ו-Railway: אירוח האתר והשרת.',
        'Inngest: הרצת משימות ברקע (תזכורות, סיכומים).',
        'Meta (WhatsApp): שליחה וקבלה של הודעות וואטסאפ.',
        'Anthropic (Claude): ניסוח תשובות ועיבוד הודעות בעוזר האוטומטי, כשהעסק הפעיל אותו.',
        'Resend: שליחת אימיילים מהמערכת.',
        'Sentry: דיווח על תקלות טכניות.',
        'חברת הסליקה וחברת הקבלות שהעסק בחר (למשל Grow, Cardcom, Tranzila, PayPlus, חשבונית ירוקה), ו-GoHighLevel אם העסק חיבר אותו.',
      ],
    },
    {
      title: 'ילדים',
      paragraphs: [
        'מידע על ילדים נכנס למערכת על ידי ההורה או על ידי העסק, לצורך השיעורים בלבד. ילדים לא נרשמים למערכת בעצמם.',
      ],
    },
    {
      title: 'מחיקת מידע',
      items: [
        'כל משתמש יכול למחוק את החשבון שלו באפליקציה, בעמוד "החשבון שלי". המחיקה מסירה את ההתחברות ואת השיוך לעסקים.',
        'התיק שהעסק מחזיק עליכם (למשל שיעורים, נוכחות ותשלומים) נשאר אצל העסק. כדי למחוק או לתקן אותו, פנו לעסק או כתבו לנו ונעביר את הבקשה.',
        `בעל עסק שרוצה למחוק את כל המידע של העסק יכול לכתוב לנו ל-${email}.`,
      ],
    },
    {
      title: 'יצירת קשר',
      paragraphs: [
        `לשאלות, לבקשה לעיין במידע, לתקן אותו או למחוק אותו: ${email}.`,
        'אם נשנה את המדיניות, נעדכן את העמוד הזה ואת תאריך העדכון שבראשו.',
      ],
    },
  ],
};

export const EN: Policy = {
  lang: 'en',
  dir: 'ltr',
  title: `Privacy policy: ${PRODUCT.name}`,
  updated: 'Last updated: November 21, 2026',
  intro: [
    `${PRODUCT.name} is a system for running swim schools and dive clubs (each a "business"). A business uses it to manage its customers: families, students and divers. It runs on ${PRODUCT.domain} and in the app.`,
    "A business's customer data belongs to that business and is managed by it; we operate the system on its behalf. This page explains what the system keeps, why, where, who it is shared with and how to delete it.",
  ],
  sections: [
    {
      title: 'What we keep',
      items: [
        'Business owners and staff: name, phone, email and sign-in details.',
        "Parents, students and divers: names, phone, email, children's names and birth dates, groups and lessons, attendance, transport and passes.",
        "Money: charges, payments and receipts. Payments go through the payment processor the business chose; we never store card numbers. A payer's ID number, when a receipt requires it, is stored encrypted.",
        'Forms and documents the business asks for: health declarations, waivers, insurance, signatures and certificates (for example a diving card). Files are kept in private storage.',
        'Messages: WhatsApp, SMS and email messages exchanged between a customer and the business through the system.',
        'Technical data: an activity log (who changed what, and when) and error reports.',
      ],
    },
    {
      title: 'WhatsApp',
      paragraphs: [
        "A business can connect its own WhatsApp Business number through Meta's WhatsApp Business Platform. Messages sent to that number reach the system and are kept in that business's conversations only, so the business can answer, book lessons and send reminders, payment links and receipts.",
        'If the business turns it on, an automatic assistant (AI) answers on its behalf and takes actions within the permissions the business set. A staff member can take over a conversation at any time, and the assistant then stays silent. Messages the business starts use templates approved by Meta.',
        'We do not use messages for advertising, do not sell them and do not share them with other businesses.',
      ],
    },
    {
      title: 'Why we use it',
      items: [
        'To run the service: schedule, attendance, sign-up, billing, receipts, reminders and answers to customers.',
        'To show the business owner an overview, alerts and summaries of their own business.',
        'To secure the system and find and fix errors.',
      ],
    },
    {
      title: 'Where it is kept and how it is protected',
      items: [
        'The database and sign-in run on Supabase, in the Frankfurt region (European Union).',
        'Each business sees only its own data, and each user sees only what their role allows (owner, office, instructor, parent). The database itself enforces this.',
        'Sensitive fields are encrypted with a separate key for each business. Traffic is encrypted (HTTPS).',
      ],
    },
    {
      title: 'Who it is shared with',
      paragraphs: [
        'We do not sell personal data. It goes only to providers that run part of the service, and only as far as needed:',
      ],
      items: [
        'Supabase: database, sign-in and file storage.',
        'Vercel and Railway: hosting of the website and the server.',
        'Inngest: background jobs (reminders, summaries).',
        'Meta (WhatsApp): sending and receiving WhatsApp messages.',
        'Anthropic (Claude): drafting answers and reading messages in the automatic assistant, when the business turned it on.',
        'Resend: emails sent by the system.',
        'Sentry: technical error reports.',
        'The payment and receipt providers the business chose (for example Grow, Cardcom, Tranzila, PayPlus, Green Invoice), and GoHighLevel if the business connected it.',
      ],
    },
    {
      title: 'Children',
      paragraphs: [
        'Information about children is entered by a parent or by the business, for the lessons only. Children do not sign up themselves.',
      ],
    },
    {
      title: 'Deleting data',
      items: [
        'Any user can delete their account in the app, on the "My account" page. This removes the sign-in and the links to businesses.',
        'The file a business keeps about you (for example lessons, attendance and payments) stays with that business. To delete or correct it, contact the business, or write to us and we will pass the request on.',
        `A business owner who wants all of the business's data deleted can write to us at ${email}.`,
      ],
    },
    {
      title: 'Contact',
      paragraphs: [
        `Questions, or a request to see, correct or delete your data: ${email}.`,
        'If this policy changes, we update this page and the date at its top.',
      ],
    },
  ],
};
