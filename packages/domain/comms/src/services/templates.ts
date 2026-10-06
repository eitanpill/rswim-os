/**
 * Message templates and automations. Every organization starts with the brief's set, in a warm tone; the owner edits
 * the words and turns each automation on or off. Keys are fixed (the code knows which variables it fills).
 */
import { z } from 'zod';
import { TemplateKey, checkbox, requiredText, type TemplateKey as Key } from '@rswim/contracts';
import { and, asc, eq, schema, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { templateVariables } from '../policies';

const { automationRules, messageTemplates } = schema;

type Bodies = { he: string; en: string };

/** The starting words for every template. `{{variables}}` are filled when a message is queued. */
export const DEFAULT_TEMPLATES: Record<Key, Bodies> = {
  trial_confirmation: {
    he: 'היי {{guardian_name}} 😊 שיעור הניסיון של {{student_name}} נקבע ל{{date}} בשעה {{time}} ב{{venue}}. כדאי להגיע 10 דקות לפני, עם בגד ים, מגבת וכובע ים. מחכים לכם! {{school_name}}',
    en: "Hi {{guardian_name}} 😊 {{student_name}}'s trial lesson is booked for {{date}} at {{time}}, {{venue}}. Please come 10 minutes early with a swimsuit, towel and cap. See you! {{school_name}}",
  },
  private_confirmation: {
    he: 'היי {{guardian_name}}, השיעור של {{student_name}} נקבע ל{{date}} בשעה {{time}} ב{{venue}}. נתראה! {{school_name}}',
    en: "Hi {{guardian_name}}, {{student_name}}'s lesson is booked for {{date}} at {{time}}, {{venue}}. See you! {{school_name}}",
  },
  enrollment_welcome: {
    he: 'ברוכים הבאים ל{{school_name}}! 🎉 {{student_name}} רשום/ה לקבוצה {{group}} החל מ{{date}}. שמחים שהצטרפתם.',
    en: 'Welcome to {{school_name}}! 🎉 {{student_name}} is enrolled in {{group}} from {{date}}. We are glad you joined.',
  },
  lesson_reminder: {
    he: 'תזכורת: היום בשעה {{time}} שיעור של {{student_name}} ב{{venue}}. {{school_name}}',
    en: "Reminder: {{student_name}}'s lesson is today at {{time}}, {{venue}}. {{school_name}}",
  },
  absence_received: {
    he: 'תודה {{guardian_name}}, רשמנו ש{{student_name}} לא יגיע/תגיע לשיעור ב{{date}} ({{group}}). ההודעה הגיעה בזמן, אז מגיע שיעור השלמה החודש. אפשר לקבוע אותו באזור האישי.',
    en: 'Thanks {{guardian_name}}, we noted that {{student_name}} will miss the lesson on {{date}} ({{group}}). The notice came in time, so a makeup lesson is due this month. You can book it in your family area.',
  },
  absence_received_no_makeup: {
    he: 'תודה {{guardian_name}}, רשמנו ש{{student_name}} לא יגיע/תגיע לשיעור ב{{date}} ({{group}}). לפי התקנון הפעם לא מגיע שיעור השלמה (ההודעה הגיעה מאוחר, או שההשלמה של החודש כבר נוצלה).',
    en: 'Thanks {{guardian_name}}, we noted that {{student_name}} will miss the lesson on {{date}} ({{group}}). Under the regulations no makeup is due this time (late notice, or this month’s makeup was already used).',
  },
  makeup_confirmed: {
    he: 'שיעור ההשלמה של {{student_name}} נקבע ל{{date}} בשעה {{time}} ב{{venue}} ({{group}}). נתראה! {{school_name}}',
    en: "{{student_name}}'s makeup lesson is booked for {{date}} at {{time}}, {{venue}} ({{group}}). See you! {{school_name}}",
  },
  instructor_change: {
    he: 'עדכון לגבי {{group}}: בשיעור ב{{date}} ילמד/תלמד {{instructor}}. אם יש שאלות, אנחנו כאן. {{school_name}}',
    en: 'An update about {{group}}: {{instructor}} will teach the lesson on {{date}}. Questions are welcome. {{school_name}}',
  },
  closure_notice: {
    he: 'הודעה חשובה: בגלל סגירה של {{venue}} לא יתקיימו שיעורים מ{{from}} עד {{to}}. שיעור שבוטל מזכה בהשלמה לפי התקנון, ונעדכן כשחוזרים לפעילות. {{school_name}}',
    en: 'Important: {{venue}} is closed, so there are no lessons from {{from}} to {{to}}. Cancelled lessons earn a makeup under the regulations; we will update you when we reopen. {{school_name}}',
  },
  reopening_makeups: {
    he: 'חזרנו לפעילות ב{{venue}} 🏊 אפשר לקבוע את שיעורי ההשלמה באזור האישי. {{school_name}}',
    en: 'We are back at {{venue}} 🏊 You can book makeup lessons in your family area. {{school_name}}',
  },
  last_call_makeups: {
    he: 'תזכורת: ל{{student_name}} יש שיעור השלמה שעוד לא נוצל. אפשר לקבוע אותו עד {{date}}. {{school_name}}',
    en: '{{student_name}} has an unused makeup lesson. Book it by {{date}}. {{school_name}}',
  },
  payment_link: {
    he: 'היי {{guardian_name}}, זה הקישור לתשלום על סך {{amount}}: {{url}} תודה! {{school_name}}',
    en: 'Hi {{guardian_name}}, here is the payment link for {{amount}}: {{url}} Thank you! {{school_name}}',
  },
  payment_failed: {
    he: 'היי {{guardian_name}}, החיוב על סך {{amount}} לא עבר. אפשר לעדכן אמצעי תשלום, או לענות להודעה הזו ונעזור. {{school_name}}',
    en: 'Hi {{guardian_name}}, the charge of {{amount}} did not go through. You can update the payment method, or reply here and we will help. {{school_name}}',
  },
  receipt_ready: {
    he: 'הקבלה על סך {{amount}} מוכנה: {{url}} {{school_name}}',
    en: 'Your receipt for {{amount}} is ready: {{url}} {{school_name}}',
  },
  progress_card: {
    he: '{{student_name}} התקדם/ה ב{{group}}! כל הכבוד 💪 {{school_name}}',
    en: '{{student_name}} made progress in {{group}}! Well done 💪 {{school_name}}',
  },
  freeze_approved: {
    he: 'היי {{guardian_name}}, ההקפאה של {{student_name}} ב{{group}} אושרה. על ימי ההקפאה אין חיוב. {{school_name}}',
    en: "Hi {{guardian_name}}, {{student_name}}'s freeze in {{group}} is approved. Frozen days are not charged. {{school_name}}",
  },
  cancellation_confirmed: {
    he: 'היי {{guardian_name}}, קיבלנו את בקשת הביטול של {{student_name}}. החודש האחרון לחיוב: {{period}}, והמקום שמור עד {{date}}. היה לנו כיף איתכם. {{school_name}}',
    en: "Hi {{guardian_name}}, we received {{student_name}}'s cancellation. The last month charged is {{period}}, and the place is kept until {{date}}. It was a pleasure. {{school_name}}",
  },
  holiday_schedule: {
    he: 'חג שמח מ{{school_name}}! 🌿 אין שיעורים מ{{from}} עד {{to}}. חוזרים לשגרה ב{{resume_on}}.',
    en: 'Happy holiday from {{school_name}}! 🌿 No lessons from {{from}} to {{to}}. Back to routine on {{resume_on}}.',
  },
  transport_left_school: {
    he: '🚌 {{student_name}} בדרך לבריכה: הקבוצה יצאה מ{{pickup}} בשעה {{time}}. {{school_name}}',
    en: '🚌 {{student_name}} is on the way to the pool: the group left {{pickup}} at {{time}}. {{school_name}}',
  },
  transport_arrived_pool: {
    he: '🏊 הגענו לבריכה! {{student_name}} ב{{venue}} מ-{{time}}. {{school_name}}',
    en: '🏊 We arrived at the pool! {{student_name}} is at {{venue}} since {{time}}. {{school_name}}',
  },
  transport_left_pool: {
    he: '🚌 יצאנו מהבריכה ב-{{time}}. {{student_name}} בדרך לנקודת ההורדה, בעוד כ-{{minutes}} דק׳. {{school_name}}',
    en: '🚌 We left the pool at {{time}}. {{student_name}} is on the way to the drop-off, about {{minutes}} minutes. {{school_name}}',
  },
  transport_dropped_off: {
    he: '✅ {{student_name}} ירד/ה מההסעה ב{{point}} בשעה {{time}}. {{school_name}}',
    en: '✅ {{student_name}} got off at {{point}} at {{time}}. {{school_name}}',
  },
  free_text: { he: '{{text}}', en: '{{text}}' },
};

/** The events that send a template, on by default. `calendar.holiday_ahead` is the daily holiday check. */
export const DEFAULT_AUTOMATIONS: [eventType: string, templateKey: Key][] = [
  ['enrollment.trial_booked', 'trial_confirmation'],
  ['scheduling.slot_booked', 'private_confirmation'],
  ['enrollment.trial_converted', 'enrollment_welcome'],
  ['attendance.absence_processed', 'absence_received'],
  ['attendance.makeup_booked', 'makeup_confirmed'],
  ['scheduling.staff_changed', 'instructor_change'],
  ['attendance.closure_opened', 'closure_notice'],
  ['billing.payment_link_created', 'payment_link'],
  ['billing.dunning_step', 'payment_failed'],
  ['billing.freeze_decided', 'freeze_approved'],
  ['billing.cancellation_requested', 'cancellation_confirmed'],
  ['calendar.holiday_ahead', 'holiday_schedule'],
  ['transport.left_school', 'transport_left_school'],
  ['transport.arrived_pool', 'transport_arrived_pool'],
  ['transport.left_pool', 'transport_left_pool'],
  ['transport.rider_dropped', 'transport_dropped_off'],
];

/** Gives an organization every template and automation it lacks. Running it twice changes nothing. */
export async function ensureCommsDefaults(tx: Tx, orgId: string) {
  const templates = Object.entries(DEFAULT_TEMPLATES).flatMap(([key, b]) =>
    (['he', 'en'] as const).map((locale) => ({
      organizationId: orgId,
      key,
      locale,
      body: b[locale],
    })),
  );
  await tx.insert(messageTemplates).values(templates).onConflictDoNothing();
  await tx
    .insert(automationRules)
    .values(
      DEFAULT_AUTOMATIONS.map(([eventType, templateKey]) => ({
        organizationId: orgId,
        eventType,
        templateKey,
      })),
    )
    .onConflictDoNothing();
}

export async function listTemplates(tx: Tx) {
  return tx
    .select()
    .from(messageTemplates)
    .orderBy(asc(messageTemplates.key), asc(messageTemplates.locale));
}

export async function listAutomations(tx: Tx) {
  return tx.select().from(automationRules).orderBy(asc(automationRules.eventType));
}

export const TemplateInput = z.object({
  id: z.uuid(),
  body: requiredText(2000),
  active: checkbox(),
  ghlTemplateId: z
    .string()
    .trim()
    .max(200)
    .transform((v) => v || null)
    .nullable()
    .default(null),
});
export type TemplateInput = z.input<typeof TemplateInput>;

/**
 * Saves a template's words. Only the variables the code fills for that key (those in the default body, plus the
 * family's and school's names) are allowed, so a typo cannot block every message.
 */
export async function updateTemplate(tx: Tx, ctx: ServiceContext, raw: TemplateInput) {
  const input = TemplateInput.parse(raw);
  const [t] = await tx.select().from(messageTemplates).where(eq(messageTemplates.id, input.id));
  if (!t) throw new DomainError('common.errors.notFound');
  const known = new Set([
    ...templateVariables(DEFAULT_TEMPLATES[TemplateKey.parse(t.key)].he),
    'guardian_name',
    'school_name',
    'student_name',
  ]);
  const unknown = templateVariables(input.body).filter((v) => !known.has(v));
  if (unknown.length > 0) {
    throw new DomainError('comms.errors.unknownVariable', { names: unknown.join(', ') });
  }
  await tx
    .update(messageTemplates)
    .set({
      body: input.body,
      active: input.active,
      ghlTemplateId: input.ghlTemplateId,
      updatedBy: ctx.userId,
    })
    .where(eq(messageTemplates.id, input.id));
}

export async function setAutomation(tx: Tx, id: string, enabled: boolean) {
  const rows = await tx
    .update(automationRules)
    .set({ enabled })
    .where(eq(automationRules.id, id))
    .returning({ id: automationRules.id });
  if (rows.length === 0) throw new DomainError('common.errors.notFound');
}

/** The template a message uses: the guardian's language if written, else Hebrew. */
export async function templateFor(tx: Tx, key: Key, locale: string) {
  const rows = await tx
    .select()
    .from(messageTemplates)
    .where(and(eq(messageTemplates.key, key)));
  return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === 'he') ?? null;
}
