/**
 * Pure copilot rules (brief §6.15, docs/POLICIES.md §17): who may ask, what a proposal must look like before it is
 * stored, which step an action may take next, what the owner reads before confirming, the instructions the model gets,
 * and the rules-based stand-in used for demos and tests. The model never acts: it proposes, the owner confirms, and the
 * ordinary domain service runs.
 */
import { z } from 'zod';
import {
  CLOSURE_SOURCES,
  FREEZE_REASONS,
  TimeOfDay,
  type CopilotActionKind,
  type CopilotActionStatus,
} from '@rswim/contracts';
import { undoable } from './agent-policies';
import { periodFromWords, rememberRequest } from './memory-policies';

export type Check = { ok: true } | { ok: false; code: string };
export type Explanation = { code: string; params: Record<string, string | number> };

const ok: Check = { ok: true };
const refuse = (code: string): Check => ({ ok: false, code: `copilot.errors.${code}` });

// ─── Who may ask ────────────────────────────────────────────────────────────

/** The copilot runs for the owner only, when the policy turns it on and a model is configured. */
export function copilotGate(g: { enabled: boolean; owner: boolean; model: boolean }): Check {
  if (!g.owner) return refuse('ownerOnly');
  if (!g.enabled) return refuse('disabled');
  if (!g.model) return refuse('noModel');
  return ok;
}

// ─── Proposals ──────────────────────────────────────────────────────────────

const Date_ = z.iso.date();

export const MoveProposal = z
  .object({
    studentId: z.uuid(),
    /** The group the child leaves; null to add them to a group. */
    fromGroupId: z.uuid().nullable(),
    toGroupId: z.uuid(),
    onDate: Date_,
  })
  .strict()
  .refine((v) => v.fromGroupId !== v.toGroupId);

export const MessageProposal = z
  .object({ householdId: z.uuid(), text: z.string().trim().min(1).max(1000) })
  .strict();

export const SlotsProposal = z
  .object({
    staffId: z.uuid(),
    venueId: z.uuid(),
    date: Date_,
    startsAt: TimeOfDay,
    endsAt: TimeOfDay,
    capacity: z.int().min(1).max(10).optional(),
  })
  .strict()
  .refine((v) => v.endsAt > v.startsAt);

export const PaymentProposal = z
  .object({
    householdId: z.uuid(),
    amountAgorot: z.int().min(100).max(10_000_000),
    description: z.string().trim().min(1).max(200),
  })
  .strict();

/** One lesson a child will miss, as the family wrote it: received when the message arrived (Israel time). */
export const AbsenceProposal = z
  .object({
    studentId: z.uuid(),
    sessionId: z.uuid(),
    receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
    note: z.string().trim().max(500).nullable(),
  })
  .strict();

export const MakeupProposal = z.object({ creditId: z.uuid(), sessionId: z.uuid() }).strict();

export const FreezeProposal = z
  .object({
    enrollmentId: z.uuid(),
    fromDate: Date_,
    toDate: Date_,
    reason: z.enum(FREEZE_REASONS),
  })
  .strict()
  .refine((v) => v.toDate >= v.fromDate);

/**
 * Cancelling lessons on a day or a range, at one venue or everywhere: a closure event the brain opens (sessions
 * cancelled, credits issued, families told by the closure template). The makeup window runs to `makeupDeadline`.
 */
export const CancelLessonsProposal = z
  .object({
    venueId: z.uuid().nullable(),
    startsOn: Date_,
    endsOn: Date_,
    reason: z.string().trim().min(1).max(300),
    source: z.enum(CLOSURE_SOURCES),
    makeupDeadline: Date_,
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn && v.makeupDeadline > v.endsOn);

/** An instructor cannot teach a lesson: the substitute finder offers it to qualified colleagues. */
export const SubstituteProposal = z
  .object({ sessionId: z.uuid(), reason: z.string().trim().max(300).nullable() })
  .strict();

export const PROPOSALS = {
  move_student: MoveProposal,
  message_family: MessageProposal,
  open_makeup_slots: SlotsProposal,
  payment_link: PaymentProposal,
  report_absence: AbsenceProposal,
  book_makeup: MakeupProposal,
  freeze: FreezeProposal,
  cancel_lessons: CancelLessonsProposal,
  substitute: SubstituteProposal,
} as const;

export type ProposalParams = {
  move_student: z.infer<typeof MoveProposal>;
  message_family: z.infer<typeof MessageProposal>;
  open_makeup_slots: z.infer<typeof SlotsProposal>;
  payment_link: z.infer<typeof PaymentProposal>;
  report_absence: z.infer<typeof AbsenceProposal>;
  book_makeup: z.infer<typeof MakeupProposal>;
  freeze: z.infer<typeof FreezeProposal>;
  cancel_lessons: z.infer<typeof CancelLessonsProposal>;
  substitute: z.infer<typeof SubstituteProposal>;
};

/** Validates what the model proposed; anything off-shape is refused rather than repaired. */
export function parseProposal<K extends CopilotActionKind>(
  kind: K,
  raw: unknown,
): { ok: true; params: ProposalParams[K] } | { ok: false; code: string } {
  const r = PROPOSALS[kind].safeParse(raw);
  return r.success
    ? { ok: true, params: r.data as ProposalParams[K] }
    : { ok: false, code: 'copilot.errors.badProposal' };
}

/** What the owner reads on the card: built from the looked-up names, never from the model's wording. */
export function proposalSummary(
  p:
    | { kind: 'move_student'; student: string; from: string | null; to: string; date: string }
    | { kind: 'message_family'; family: string; text: string }
    | { kind: 'payment_link'; family: string; amountAgorot: number; description: string }
    | { kind: 'report_absence'; student: string; group: string; date: string; time: string }
    | { kind: 'book_makeup'; student: string; group: string; date: string; time: string }
    | { kind: 'freeze'; student: string; group: string; date: string; until: string }
    | {
        kind: 'cancel_lessons';
        venue: string | null;
        date: string;
        until: string;
        sessions: number;
        reason: string;
      }
    | { kind: 'substitute'; staff: string | null; group: string; date: string; time: string }
    | {
        kind: 'open_makeup_slots';
        staff: string;
        venue: string;
        date: string;
        from: string;
        to: string;
        capacity: number;
      },
): Explanation {
  switch (p.kind) {
    case 'move_student':
      return p.from === null
        ? { code: 'copilot.summary.add', params: { student: p.student, to: p.to, date: p.date } }
        : {
            code: 'copilot.summary.move',
            params: { student: p.student, from: p.from, to: p.to, date: p.date },
          };
    case 'message_family':
      return { code: 'copilot.summary.message', params: { family: p.family, text: p.text } };
    case 'payment_link':
      return {
        code: 'copilot.summary.payment',
        // Agorot: the screens show money params in shekels.
        params: { family: p.family, amount: p.amountAgorot, description: p.description },
      };
    case 'report_absence':
    case 'book_makeup':
      return {
        code: p.kind === 'report_absence' ? 'copilot.summary.absence' : 'copilot.summary.makeup',
        params: { student: p.student, group: p.group, date: p.date, time: p.time },
      };
    case 'freeze':
      return {
        code: 'copilot.summary.freeze',
        params: { student: p.student, group: p.group, date: p.date, until: p.until },
      };
    case 'cancel_lessons':
      return p.venue === null
        ? {
            code: 'copilot.summary.cancelLessonsAll',
            params: { date: p.date, until: p.until, sessions: p.sessions, reason: p.reason },
          }
        : {
            code: 'copilot.summary.cancelLessons',
            params: {
              venue: p.venue,
              date: p.date,
              until: p.until,
              sessions: p.sessions,
              reason: p.reason,
            },
          };
    case 'substitute':
      // A lesson nobody teaches yet asks for an instructor, not a substitute for someone.
      return p.staff === null
        ? {
            code: 'copilot.summary.substituteOpen',
            params: { group: p.group, date: p.date, time: p.time },
          }
        : {
            code: 'copilot.summary.substitute',
            params: { staff: p.staff, group: p.group, date: p.date, time: p.time },
          };
    default:
      return {
        code: 'copilot.summary.slots',
        params: {
          staff: p.staff,
          venue: p.venue,
          date: p.date,
          from: p.from,
          to: p.to,
          capacity: p.capacity,
        },
      };
  }
}

// ─── An action's next step ──────────────────────────────────────────────────

export type ActionStep = 'confirm' | 'dismiss' | 'undo';

/**
 * proposed → confirmed | dismissed (and failed when the service refuses); a confirmed action of an undoable kind (a
 * move, makeup slots, a payment link) can be undone, once.
 */
export function actionStep(
  a: { status: CopilotActionStatus; kind: CopilotActionKind },
  step: ActionStep,
): Check {
  if (step === 'undo') {
    if (!undoable(a.kind)) return refuse('notUndoable');
    return a.status === 'confirmed' ? ok : refuse('notConfirmed');
  }
  return a.status === 'proposed' ? ok : refuse('alreadyDecided');
}

// ─── The model's instructions ───────────────────────────────────────────────

/** The system prompt: the school's context, the tools' contract and the rule that nothing happens without the owner. */
export function copilotSystem(c: { today: string; school: string }): string {
  return `You are the operations copilot of ${c.school}, a children's swim school in Israel. The owner writes to you,
usually in Hebrew; always answer in the owner's language, briefly and plainly. Today is ${c.today} (Asia/Jerusalem).

- Read only through the tools. Never guess ids: find children, groups and staff with the find tools first.
- You change things only through the propose_ tools (move a child, message a family, open makeup slots, send a
  payment link, cancel lessons on a day, find a substitute for an instructor's lesson). The owner's settings decide what happens next, and the tool's answer says it: status "done" means
  it already ran; "waiting" means it waits for the owner's confirmation on a card; "failed" means the rules refused
  it. Tell the owner exactly that, never more.
- A proposal the tools refuse is not made: tell the owner why, in their words.
- Amounts are in agorot in the tools (100 agorot = 1 shekel); speak to the owner in shekels.
- Dates are YYYY-MM-DD and times HH:MM. When the owner gives no date for a move, use the next lesson date of the
  target group that is at least today.
- Cancelling lessons cancels every lesson in the range (at one venue, or all venues when venueId is null), gives the
  children their makeup credits by the regulations and tells the families. Unless the owner says otherwise, the
  makeup deadline is the last day of the month after the closure, and the source is "school".
- For a substitute, find the instructor's lessons with staff_lessons and propose one substitute per lesson.
- You have a memory of the business. Before answering about the past ("how was April", "what happened last
  Passover", "what do we know about this family"), read it: month_report for a month's numbers against the month before
  and the same month last year, recall for the owner's notes and the events. Say plainly when you do not remember.
- When the owner asks you to remember something ("תזכור ש..."), save it with remember in the owner's own words, about
  the right family, child, instructor, venue or group when there is one, and say you saved it.
- Never invent prices, debts or policies; if a tool does not tell you, say you don't know.`;
}

// ─── The rules-based stand-in (RSWIM_COPILOT_FAKE=1) ─────────────────────────

export type FakeIntent =
  | { kind: 'move'; splits: { student: string; group: string }[]; date: string | null }
  | { kind: 'message'; student: string; text: string }
  | { kind: 'slots'; staff: string; date: string; from: string; to: string }
  | { kind: 'payment'; student: string; shekels: number }
  | { kind: 'cancel'; date: string; venue: string | null; reason: string | null }
  | { kind: 'substitute'; staff: string; date: string }
  | { kind: 'debts' }
  | { kind: 'lessons'; date: string | null }
  | { kind: 'remember'; body: string }
  | { kind: 'month'; period: string }
  | { kind: 'recall'; query: string }
  | { kind: 'help' };

const DATE = '(\\d{4}-\\d{2}-\\d{2})';

/**
 * Understands a few fixed Hebrew phrasings, enough to demo and test the confirm-before-act flow without a model:
 * "תעביר את <ילד> ל<קבוצה> [מ-<תאריך>]", "תשלח ל<ילד>: <טקסט>", "תפתח השלמות עם <מדריך> ב-<תאריך> <שעה>-<שעה>",
 * "תבטל את השיעורים ב-<תאריך> [ב<בריכה>] [בגלל <סיבה>]", "תמצא מחליף ל<מדריך> ב-<תאריך>", "מי חייב",
 * "מה יש היום / ב-<תאריך>", "תזכור ש<...>", "איך היה <חודש>" / "מה קרה ב<חודש>", "מה אתה זוכר על <...>".
 * "היום" and "מחר" stand for dates.
 */
export function fakeIntent(prompt: string, today: string): FakeIntent {
  const text = prompt.trim().replace(/\s+/g, ' ');
  const note = rememberRequest(text);
  if (note) return { kind: 'remember', body: note.body };
  const month = /^(?:איך היה|איך הלך|מה קרה)(?: לנו)? (.+?)[?.!]?$/.exec(text);
  const period = month ? periodFromWords(month[1] as string, today) : null;
  if (period) return { kind: 'month', period };
  const about = /^מה (?:אתה זוכר|את זוכרת|אתה יודע|את יודעת|ידוע לך) על (.+?)[?.!]?$/.exec(text);
  if (about) return { kind: 'recall', query: about[1] as string };
  const day = (w: string) => (w === 'היום' ? today : w === 'מחר' ? addDays(today, 1) : w);
  const cancel = new RegExp(
    `^(?:תבטל|בטל|לבטל) (?:את )?(?:כל )?(?:ה)?שיעורים (?:ב-?)?(${DATE.slice(1, -1)}|היום|מחר)(?: ב(?!גלל)(.+?))?(?: (?:בגלל|כי) (.+?))?[.!]?$`,
  ).exec(text);
  if (cancel)
    return {
      kind: 'cancel',
      date: day(cancel[1] as string),
      venue: cancel[2] ?? null,
      reason: cancel[3] ?? null,
    };
  const sub = new RegExp(
    `^(?:תמצא|מצא|למצוא|תחפש|חפש) מחלי(?:ף|פ)\\S* ל(.+?) (?:ב-?)?(${DATE.slice(1, -1)}|היום|מחר)[.!]?$`,
  ).exec(text);
  if (sub) return { kind: 'substitute', staff: sub[1] as string, date: day(sub[2] as string) };
  const move = new RegExp(
    `^(?:תעביר|העבר|להעביר) את (.+? ל.+?)(?: (?:מ-?|החל מ-?)${DATE})?[.!]?$`,
  ).exec(text);
  if (move) {
    // "את יואב לוי למעורבת": the name may itself hold " ל", so every split is a candidate, earliest first.
    const body = move[1] as string;
    const splits = [...body.matchAll(/ ל/g)].map((m) => ({
      student: body.slice(0, m.index),
      group: body.slice(m.index + 2).replace(/^(?:קבוצת |קבוצה )/, ''),
    }));
    return { kind: 'move', splits, date: move[2] ?? null };
  }
  const payment =
    /^(?:תשלח|שלח|לשלוח) (?:קישור|לינק) (?:ל?תשלום )?ל(?:הורים של |משפחה של )?(.+?) על (\d+)(?: ?₪| שקל(?:ים)?)?[.!]?$/.exec(
      text,
    );
  if (payment)
    return { kind: 'payment', student: payment[1] as string, shekels: Number(payment[2]) };
  const message = /^(?:תשלח|שלח|לשלוח)(?: הודעה)? ל(?:הורים של |משפחה של )?(.+?): (.+)$/.exec(text);
  if (message)
    return { kind: 'message', student: message[1] as string, text: message[2] as string };
  const slots = new RegExp(
    `^(?:תפתח|פתח|לפתוח) (?:שיעורי |מקומות )?השלמ\\S* עם (.+?) ב-?${DATE} (\\d{2}:\\d{2})-(\\d{2}:\\d{2})`,
  ).exec(text);
  if (slots) {
    return {
      kind: 'slots',
      staff: slots[1] as string,
      date: slots[2] as string,
      from: slots[3] as string,
      to: slots[4] as string,
    };
  }
  if (/חייב|חוב/.test(text)) return { kind: 'debts' };
  const date = new RegExp(DATE).exec(text);
  if (date || /היום|שיעורים/.test(text)) return { kind: 'lessons', date: date?.[1] ?? null };
  return { kind: 'help' };
}

/** A date plus whole days. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The last day of the month after the one `date` falls in (a closure's default makeup deadline). */
export function endOfNextMonth(date: string): string {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
}

/** The first date on or after `from` that falls on a weekday (0 = Sunday). */
export function nextWeekday(from: string, weekday: number): string {
  const t = Date.parse(`${from}T12:00:00Z`);
  const ahead = (weekday - new Date(t).getUTCDay() + 7) % 7;
  return new Date(t + ahead * 86_400_000).toISOString().slice(0, 10);
}
