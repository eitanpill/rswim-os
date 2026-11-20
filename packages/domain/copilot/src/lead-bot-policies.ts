/**
 * Pure rules of the WhatsApp bot for new customers (docs/whatsapp/PLAN.md, W2): which lead messages it takes, the
 * details it collects one question at a time, what the model is told, and the rules-based stand-in used for demos
 * and tests. The same bot serves swim schools and freediving clubs; an optional module (lodging, …) adds its own facts
 * and tools.
 */
import { z } from 'zod';
import type { BotHandoffReason, LeadStage, Vertical } from '@rswim/contracts';
import { sensitiveTopic } from './bot-policies';

// ─── Which lead messages the bot takes ──────────────────────────────────────

export interface LeadBotFacts {
  enabled: boolean;
  /** The message is still open (new or needs_human). */
  open: boolean;
  stage: LeadStage;
  /** The office wrote to this lead in the last hours: a person is in the conversation, so the bot keeps out. */
  officeTalking: boolean;
  text: string;
}

export type LeadBotRoute =
  | { route: 'skip'; reason: 'off' | 'closed' | 'office_talking' | 'joined' }
  | { route: 'handoff'; reason: BotHandoffReason }
  | { route: 'ask' };

/** Someone asking for a person by name or role gets one. */
const WANTS_HUMAN =
  /נציג|בן אדם|אדם אמיתי|מישהו אמיתי|לדבר עם|שיחזרו אלי|תתקשרו|להתקשר|human|agent|call me/i;

export function wantsHuman(text: string): boolean {
  return WANTS_HUMAN.test(text);
}

export function leadBotRoute(f: LeadBotFacts): LeadBotRoute {
  if (!f.enabled) return { route: 'skip', reason: 'off' };
  if (!f.open) return { route: 'skip', reason: 'closed' };
  // A lead that joined is a customer now; the family bot or the office takes it from here.
  if (f.stage === 'joined') return { route: 'skip', reason: 'joined' };
  if (f.officeTalking) return { route: 'skip', reason: 'office_talking' };
  if (sensitiveTopic(f.text)) return { route: 'handoff', reason: 'sensitive' };
  if (wantsHuman(f.text)) return { route: 'handoff', reason: 'needs_action' };
  return { route: 'ask' };
}

// ─── The details it collects ────────────────────────────────────────────────

/** What the bot asks a new customer, in order, by kind of business. One question per message. */
export const LEAD_QUESTIONS: Record<Vertical, readonly LeadDetailKey[]> = {
  swim: ['name', 'child_age', 'area', 'days'],
  freediving: ['name', 'experience', 'dates'],
};

export const LEAD_DETAIL_KEYS = [
  'name',
  'child_age',
  'area',
  'days',
  'experience',
  'dates',
] as const;
export type LeadDetailKey = (typeof LEAD_DETAIL_KEYS)[number];

/** What the model may save about the lead (save_details); every field optional, at least one. */
export const LeadDetailsPatch = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    child_age: z.string().trim().min(1).max(40).optional(),
    area: z.string().trim().min(1).max(60).optional(),
    days: z.string().trim().min(1).max(80).optional(),
    experience: z.string().trim().min(1).max(120).optional(),
    dates: z.string().trim().min(1).max(80).optional(),
    child_name: z.string().trim().min(1).max(60).optional(),
    child_dob: z.iso.date().optional(),
    interest: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine((d) => Object.keys(d).length > 0, 'empty');
export type LeadDetailsPatch = z.infer<typeof LeadDetailsPatch>;

export interface LeadKnown {
  name: string | null;
  details: Record<string, unknown>;
}

const has = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

/** The next detail the bot still needs, or null when it has them all. */
export function nextLeadQuestion(vertical: Vertical, lead: LeadKnown): LeadDetailKey | null {
  for (const key of LEAD_QUESTIONS[vertical]) {
    const known = key === 'name' ? has(lead.name) : has(lead.details[key]);
    if (!known) return key;
  }
  return null;
}

/** How the bot asks for one detail, in Hebrew (the stand-in's words; the model writes its own). */
export const QUESTION_HE: Record<LeadDetailKey, string> = {
  name: 'איך קוראים לך?',
  child_age: 'בן או בת כמה הילד/ה?',
  area: 'מאיזה אזור אתם?',
  days: 'אילו ימים ושעות נוחים לכם?',
  experience: 'יש לך ניסיון בצלילה חופשית? (מתחיל/ה, קורס בסיסי, מתקדם/ת)',
  dates: 'באילו תאריכים את/ה מתכנן/ת להגיע?',
};

/** The saved details merged: a new value replaces the old, the name goes on the lead itself. */
export function mergeLeadDetails(
  lead: LeadKnown,
  patch: LeadDetailsPatch,
): { name: string | null; interest: string | null; details: Record<string, unknown> } {
  const { name, interest, ...rest } = patch;
  return {
    name: name ?? lead.name,
    interest: interest ?? null,
    details: { ...lead.details, ...rest },
  };
}

// ─── What the business offers ───────────────────────────────────────────────

/** One thing a new customer can sign up for, with its prices and the nearest open seats. */
export interface Offer {
  name: string;
  /** Ages it is for, in words (swim), or the level it needs (dive). */
  who: string | null;
  prices: { label: string; agorot: number }[];
  /** Open places: "יום ב׳ 17:00, בריכת גילה, 3 מקומות". */
  openings: string[];
}

export const shekels = (agorot: number) =>
  `${Number.isInteger(agorot / 100) ? agorot / 100 : (agorot / 100).toFixed(2)} ₪`;

/** Months to words: 6-36 → "גילאי 0.5-3", null bounds left open. */
export function agesInWords(minMonths: number | null, maxMonths: number | null): string | null {
  const y = (m: number) => (m % 12 === 0 ? String(m / 12) : (m / 12).toFixed(1));
  if (minMonths === null && maxMonths === null) return null;
  if (minMonths !== null && maxMonths !== null) return `גילאי ${y(minMonths)}-${y(maxMonths)}`;
  if (minMonths !== null) return `מגיל ${y(minMonths)}`;
  return `עד גיל ${y(maxMonths as number)}`;
}

/** The offers as plain lines for the model and the stand-in. */
export function offerLines(offers: readonly Offer[]): string[] {
  return offers.map((o) => {
    const prices = o.prices.map((p) => `${p.label} ${shekels(p.agorot)}`).join(', ');
    const parts = [o.name, o.who, prices || null].filter(Boolean).join(' · ');
    return o.openings.length
      ? `${parts} — פנוי: ${o.openings.join('; ')}`
      : `${parts} — אין כרגע מקום פנוי`;
  });
}

// ─── What the model is told ─────────────────────────────────────────────────

export interface LeadBotPromptFacts {
  business: string;
  vertical: Vertical;
  today: string;
  city: string | null;
  lead: LeadKnown & { phone: string };
  next: LeadDetailKey | null;
  /** A swim school's bot books trials (trial_options, book_trial); a club's sends its sign-up link. */
  canBookTrial: boolean;
  /** The school's rules in plain lines (policyFacts). */
  facts: string[];
  /** Facts an enabled module adds (lodging: rooms and nightly prices…). */
  moduleFacts: string[];
  knowledge: { id: string; question: string; answer: string }[];
}

export function leadBotSystem(c: LeadBotPromptFacts): string {
  const kind = c.vertical === 'freediving' ? 'a freediving club' : "a children's swim school";
  const kb = c.knowledge.length
    ? c.knowledge.map((k) => `- [${k.id}] Q: ${k.question}\n  A: ${k.answer}`).join('\n')
    : '- (empty)';
  const lines = (l: string[]) => (l.length ? l.map((f) => `- ${f}`).join('\n') : '- (none)');
  const known = Object.entries({ name: c.lead.name, ...c.lead.details })
    .filter(([, v]) => has(v))
    .map(([k, v]) => `${k}: ${String(v)}`)
    .join('; ');
  return `You answer WhatsApp messages from people who are not yet customers of ${c.business}, ${kind} in Israel${
    c.city ? ` (${c.city})` : ''
  }. Today is ${c.today} (Asia/Jerusalem). You are the business's front desk: friendly, quick and accurate.

What you know about this person: ${known || 'nothing yet'}.
The next detail to ask for: ${c.next ?? 'none, you have what you need'}.

How to work:
- Answer questions only from business_info, search_knowledge and the facts below. Never guess prices, times, places
  or rules. If they don't hold the answer, hand off with reason unknown.
- Whenever the person tells you something about themselves (name, age of the child, area, days that suit them,
  experience, dates), save it with save_details before you answer.
- After answering, ask for the next missing detail, one question per message, never a list of questions.
${
  c.canBookTrial
    ? `- When they want a trial lesson: ask for the child's first name, date of birth, boy or girl, and the parent's full name
  (one question per message), call trial_options with the date of birth, offer up to three lessons as a short
  numbered list (day, date, time, group, place), and when they choose one call book_trial with the same childGender. "done": confirm the
  lesson in one line (the school also sends its confirmation; when payment is "done" a payment link for the trial
  went out too). "waiting": the office confirms soon. "failed" or "not_allowed": hand off with reason needs_action.
  Never book a lesson trial_options did not offer, and never book before they chose.`
    : `- When they want to come, send the sign-up link from join_link; the club confirms and they book their first dive
  in the app.`
}
- For joining for good (not a trial), send the sign-up link from join_link.
- Hand off with reason sensitive for health, injuries, complaints, refunds or safety, and with reason needs_action
  when they ask for a person, a discount or anything you can't answer.
- Finish by calling exactly one of reply_to_lead or hand_off_to_office. The handoff summary is for the office, in
  Hebrew, one or two lines.
- Write in their language (usually Hebrew), warm and short, like a good secretary. No markdown, no lists of more
  than three lines. Don't mention tools or systems, or that you are a bot unless asked.

The business's rules:
${lines(c.facts)}
${c.moduleFacts.length ? `\nMore the business offers:\n${lines(c.moduleFacts)}\n` : ''}
The business's answers to common questions (cite the ids you used):
${kb}`;
}

// ─── The rules-based stand-in ───────────────────────────────────────────────

const GREETING = /^\s*(היי|הי|שלום|בוקר טוב|ערב טוב|אהלן|hi|hello)(?![\p{L}])/iu;

export type LeadIntent = 'price' | 'schedule' | 'where' | 'greeting' | 'other';

/** What a new customer's message is about, by keywords (the stand-in only). */
export function fakeLeadIntent(text: string): LeadIntent {
  if (/מחיר|עולה|עלות|כמה זה|תשלום|price|cost/i.test(text)) return 'price';
  if (/מתי|שעות|ימים|ימי|קבוצ|מקום פנוי|פנוי|לוח|when|schedule/i.test(text)) return 'schedule';
  if (/איפה|כתובת|מיקום|בריכה|איזו בריכה|where/i.test(text)) return 'where';
  if (GREETING.test(text) || text.trim().length < 25) return 'greeting';
  return 'other';
}

const NAME = /(?:קוראים לי|שמי|השם שלי|my name is)\s+([\p{L}'-]{2,20}(?:\s[\p{L}'-]{2,20})?)/iu;
const AGE = /(?:בן|בת|גיל|age)\s*(\d{1,2}(?:\.\d)?)/i;

/**
 * The details a message gives (the stand-in only): a stated name or age anywhere, and when the message answers the
 * question asked, the whole short answer for that detail.
 */
export function fakeLeadDetails(
  text: string,
  asked: LeadDetailKey | null,
): Partial<LeadDetailsPatch> {
  const out: Record<string, string> = {};
  const t = text.trim();
  const name = NAME.exec(t);
  if (name?.[1]) out.name = name[1];
  const age = AGE.exec(t);
  if (age?.[1]) out.child_age = age[1];
  const short = t.length <= 40 && !t.includes('?');
  if (asked && short && !out[asked]) {
    if (asked === 'child_age') {
      const n = /\d{1,2}(?:\.\d)?/.exec(t);
      if (n) out.child_age = n[0];
    } else if (
      asked !== 'name' ||
      (/^[\p{L}'-]{2,20}(?:\s[\p{L}'-]{2,20})?$/u.test(t) && !GREETING.test(t))
    ) {
      out[asked] = t;
    }
  }
  return out;
}

export type ClosingIntent = 'trial' | 'join' | 'choice' | null;

/** A wish to come for a trial, to sign up, or a pick from a numbered list (the stand-in only). */
export function fakeClosingIntent(text: string): ClosingIntent {
  if (/^\s*[1-9]\s*$/.test(text)) return 'choice';
  if (/ניסיון|לנסות|trial/i.test(text)) return 'trial';
  if (/להירשם|הרשמה|לינק|קישור|sign up/i.test(text)) return 'join';
  return null;
}

/** "נועה 12.3.2020": the child's first name and date of birth (the stand-in only). */
export function parseChildBirth(text: string): { name: string | null; dob: string | null } {
  const m = /(?:([\p{L}'-]{2,20})\s+)?(\d{1,2})[./](\d{1,2})[./](\d{4})/u.exec(text);
  if (!m) return { name: null, dob: null };
  const pad = (v: string) => v.padStart(2, '0');
  return { name: m[1] ?? null, dob: `${m[4]}-${pad(m[3] as string)}-${pad(m[2] as string)}` };
}

/** What the instructions say the bot knows ("name: X; child_age: 5"), for the stand-in. */
export function knownFromSystem(system: string): Record<string, string> {
  const line = /What you know about this person: (.*)\.\n/.exec(system)?.[1] ?? '';
  if (line === 'nothing yet') return {};
  return Object.fromEntries(
    line
      .split('; ')
      .map((p) => p.split(': '))
      .filter((kv): kv is [string, string] => kv.length === 2),
  );
}
