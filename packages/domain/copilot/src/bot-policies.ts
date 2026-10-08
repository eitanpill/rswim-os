/**
 * Pure rules of the parents' WhatsApp bot (docs/POLICIES.md §19): which family messages it may answer, which go
 * straight to a person, what the model is told, how a learned answer is matched, and the rules-based stand-in used for
 * demos and tests. The bot reads the family's own data and the school's knowledge; it never changes anything.
 */
import { z } from 'zod';
import type { BotHandoffReason, InboundIntent, PolicyRules } from '@rswim/contracts';

// ─── Which messages the bot takes ───────────────────────────────────────────

export interface BotFacts {
  enabled: boolean;
  /** The sender is a guardian of a known family. */
  family: boolean;
  isStaff: boolean;
  /** The inbound message is still open (new or needs_human). */
  open: boolean;
  intent: InboundIntent;
  /** The inbox already drafted an action (an absence, a freeze…) the office approves with one tap. */
  actionDrafted: boolean;
  text: string;
}

export type BotRoute =
  | { route: 'skip'; reason: 'off' | 'not_family' | 'closed' | 'action_drafted' }
  | { route: 'handoff'; reason: BotHandoffReason }
  | { route: 'ask' };

/** Intents a person always handles, like the inbox (complaints and leaving the school). */
const ALWAYS_HUMAN: ReadonlySet<InboundIntent> = new Set(['complaint', 'cancellation_request']);

/**
 * Health, money disputes, safety and unhappiness go to a person whatever the model would say. Checked on the text so
 * a sensitive message never reaches the model at all.
 */
const SENSITIVE =
  /חום|חול[הי]|מחל[הת]|תרופ|אלרג|פציע|נפצע|רופא|אסתמ|אפילפ|דלקת|הקאה|החזר כספי|החזר|זיכוי|לזכות אות|חיוב כפול|חויבתי פעמיים|טעות בחיוב|תלונה|מתלונ|לא מרוצ|מאוכזב|כועס|טבע|הטרד|אלימ|פגע/;

export function sensitiveTopic(text: string): boolean {
  return SENSITIVE.test(text);
}

/** Where a family message goes: skipped (the inbox handles it as before), straight to a person, or to the model. */
export function botRoute(f: BotFacts): BotRoute {
  if (!f.enabled) return { route: 'skip', reason: 'off' };
  if (!f.family || f.isStaff) return { route: 'skip', reason: 'not_family' };
  if (!f.open) return { route: 'skip', reason: 'closed' };
  if (f.actionDrafted) return { route: 'skip', reason: 'action_drafted' };
  if (ALWAYS_HUMAN.has(f.intent) || sensitiveTopic(f.text))
    return { route: 'handoff', reason: 'sensitive' };
  return { route: 'ask' };
}

/**
 * The "we passed it on" note goes once in a while, not after every message of a family that writes in bursts.
 * `lastNoteAt` is the family's previous note.
 */
export function handoffNoteDue(lastNoteAt: Date | null, now: Date, quietMinutes = 120): boolean {
  return lastNoteAt === null || now.getTime() - lastNoteAt.getTime() >= quietMinutes * 60_000;
}

// ─── What the model may hand back ───────────────────────────────────────────

export const BotAnswer = z
  .object({
    text: z.string().trim().min(1).max(1000),
    /** The knowledge entries the answer used, if any. */
    knowledgeIds: z.array(z.string()).max(20).default([]),
  })
  .strict();
export type BotAnswer = z.infer<typeof BotAnswer>;

export const BotHandoff = z
  .object({
    summary: z.string().trim().min(1).max(500),
    reason: z.enum(['unknown', 'needs_action', 'sensitive']),
  })
  .strict();
export type BotHandoff = z.infer<typeof BotHandoff>;

// ─── What the model is told ─────────────────────────────────────────────────

/**
 * The school's rules, in plain English lines, from the resolved policy (docs/POLICIES.md). Only what a family asks
 * about; a rule the policy leaves out is left out here too, so the model never states a rule the school has not set.
 */
export function policyFacts(rules: PolicyRules): string[] {
  const out: string[] = [];
  const a = rules.absence;
  if (a?.notice_min_hours !== undefined)
    out.push(
      `Absence notice: at least ${a.notice_min_hours} hours before the lesson${a.timely_earns_makeup ? ' earns a makeup lesson' : ''}. Late notice or no-show: no makeup.`,
    );
  const m = rules.makeup;
  if (m?.enabled === false) out.push('Makeup lessons: not offered.');
  else if (m?.max_per_month !== undefined)
    out.push(
      `Makeup lessons: up to ${m.max_per_month} per month, valid until ${m.expiry ?? 'end_of_source_month'}${m.self_booking ? '; families book them in the family area of the app' : '; the office books them'}.`,
    );
  const b = rules.billing;
  if (b?.run_day !== undefined) out.push(`Monthly charge: on day ${b.run_day} of the month.`);
  if (b?.cancellation_cutoff_day !== undefined)
    out.push(
      `Leaving the school: notice by day ${b.cancellation_cutoff_day} of the month to stop the next month's charge.`,
    );
  if (b?.freeze_charge !== undefined)
    out.push(
      `Freezing a place: ${b.freeze_charge === 'none_while_frozen' ? 'no charge while frozen' : 'charged in full'}${b.freeze_requires_approval ? ', needs the office approval' : ''}.`,
    );
  const sib = rules.discount?.sibling;
  if (sib?.percent_bp !== undefined && sib.kind !== 'flat')
    out.push(`Sibling discount: ${sib.percent_bp / 100}% off for each additional child.`);
  const v = rules.venue;
  if (v?.companions_per_child !== undefined)
    out.push(`Companions at the pool: ${v.companions_per_child} per child.`);
  const h = rules.health;
  if (h?.declaration_required) out.push('A signed health declaration is required for every child.');
  if (h?.sick_children_allowed === false) out.push('Sick children do not come to lessons.');
  return out;
}

export interface BotPromptFacts {
  school: string;
  today: string;
  guardian: string;
  children: string[];
  facts: string[];
  knowledge: { id: string; question: string; answer: string }[];
}

/** The bot's instructions. Long-standing behaviour lives here; the school's own words come from the knowledge base. */
export function botSystem(c: BotPromptFacts): string {
  const kb = c.knowledge.length
    ? c.knowledge.map((k) => `- [${k.id}] Q: ${k.question}\n  A: ${k.answer}`).join('\n')
    : '- (empty)';
  const facts = c.facts.length ? c.facts.map((f) => `- ${f}`).join('\n') : '- (none set)';
  return `You answer WhatsApp messages that parents send to ${c.school}, a children's swim school in Israel. Today is
${c.today} (Asia/Jerusalem). The parent writing is ${c.guardian}; their children: ${c.children.join(', ') || 'none listed'}.

How to work:
- Answer only from the family tools and from the school's rules and knowledge below. Never guess dates, times,
  prices, balances or rules. If they don't give you the answer, hand off.
- You cannot change anything: you cannot record an absence, book a makeup, freeze, cancel, refund or move a child.
  If the parent wants something done, hand off with reason needs_action.
- Hand off with reason sensitive for health, injuries, complaints, refunds, billing disputes, safety, or a parent who
  sounds upset.
- Finish by calling exactly one of reply_to_parent or hand_off_to_office. The handoff summary is for the office, in
  Hebrew, one or two lines: what the parent asked and what is missing.
- Write to the parent in their language (usually Hebrew), warm, short and plain, like a friendly school secretary.
  No markdown. Use first names. Don't mention tools, systems or that you are a bot unless asked.
- Times are Israel time; say dates as day and month (for example "יום ראשון 12.10").

The school's rules:
${facts}

The school's answers to common questions (cite the ids you used):
${kb}`;
}

// ─── Learned answers ────────────────────────────────────────────────────────

const STOP = new Set(
  'של את מה מתי איך אני יש לא זה זו הוא היא אם עם על אפשר רוצה רציתי שאלה היי הי שלום תודה בבקשה גם או כי אבל לנו לי שלנו שלי'.split(
    ' ',
  ),
);

/** The words of a question that carry meaning, with one Hebrew prefix letter (ו ה ב ל מ ש כ) dropped. */
export function keywords(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    const w = raw.length >= 4 && /^[והבלמשכ]/.test(raw) ? raw.slice(1) : raw;
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

/** The knowledge entries a message is about, best first: an entry matches when most of its question's words appear. */
export function matchKnowledge<T extends { question: string }>(
  text: string,
  entries: readonly T[],
  minScore = 0.6,
): T[] {
  const words = keywords(text);
  return entries
    .map((e) => {
      const q = keywords(e.question);
      const shared = [...q].filter((w) => words.has(w)).length;
      return { e, score: q.size ? shared / q.size : 0 };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.e);
}

// ─── The rules-based stand-in (RSWIM_BOT_FAKE=1) ─────────────────────────────

export type FakeBotIntent = 'makeups' | 'balance' | 'lessons' | 'other';

/** What the stand-in thinks a family asks about, from a few fixed Hebrew words. */
export function fakeBotIntent(text: string): FakeBotIntent {
  if (/השלמ/.test(text)) return 'makeups';
  if (/חייב|חוב|יתרה|לשלם|תשלום/.test(text)) return 'balance';
  if (/מתי|באיזו שעה|באיזה יום|שיעור הבא|יש שיעור|מחר|השבוע/.test(text)) return 'lessons';
  return 'other';
}
