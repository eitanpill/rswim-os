/**
 * Pure copilot rules (brief §6.15, docs/POLICIES.md §17): who may ask, what a proposal must look like before it is
 * stored, which step an action may take next, what the owner reads before confirming, the instructions the model gets,
 * and the rules-based stand-in used for demos and tests. The model never acts: it proposes, the owner confirms, and the
 * ordinary domain service runs.
 */
import { z } from 'zod';
import { TimeOfDay, type CopilotActionKind, type CopilotActionStatus } from '@rswim/contracts';

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

export const PROPOSALS = {
  move_student: MoveProposal,
  message_family: MessageProposal,
  open_makeup_slots: SlotsProposal,
} as const;

export type ProposalParams = {
  move_student: z.infer<typeof MoveProposal>;
  message_family: z.infer<typeof MessageProposal>;
  open_makeup_slots: z.infer<typeof SlotsProposal>;
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
 * proposed → confirmed | dismissed (and failed when the service refuses); only a confirmed move can be undone, and
 * only once.
 */
export function actionStep(
  a: { status: CopilotActionStatus; kind: CopilotActionKind },
  step: ActionStep,
): Check {
  if (step === 'undo') {
    if (a.kind !== 'move_student') return refuse('notUndoable');
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
- You cannot change anything yourself. To move a child, message a family or open makeup slots, call the matching
  propose_ tool; the owner sees a card and decides. Say that the proposal is waiting for their confirmation.
- A proposal the tools refuse is not made: tell the owner why, in their words.
- Dates are YYYY-MM-DD and times HH:MM. When the owner gives no date for a move, use the next lesson date of the
  target group that is at least today.
- Never invent prices, debts or policies; if a tool does not tell you, say you don't know.`;
}

// ─── The rules-based stand-in (RSWIM_COPILOT_FAKE=1) ─────────────────────────

export type FakeIntent =
  | { kind: 'move'; splits: { student: string; group: string }[]; date: string | null }
  | { kind: 'message'; student: string; text: string }
  | { kind: 'slots'; staff: string; date: string; from: string; to: string }
  | { kind: 'debts' }
  | { kind: 'lessons'; date: string | null }
  | { kind: 'help' };

const DATE = '(\\d{4}-\\d{2}-\\d{2})';

/**
 * Understands a few fixed Hebrew phrasings, enough to demo and test the confirm-before-act flow without a model:
 * "תעביר את <ילד> ל<קבוצה> [מ-<תאריך>]", "תשלח ל<ילד>: <טקסט>", "תפתח השלמות עם <מדריך> ב-<תאריך> <שעה>-<שעה>",
 * "מי חייב", "מה יש היום / ב-<תאריך>".
 */
export function fakeIntent(prompt: string): FakeIntent {
  const text = prompt.trim().replace(/\s+/g, ' ');
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

/** The first date on or after `from` that falls on a weekday (0 = Sunday). */
export function nextWeekday(from: string, weekday: number): string {
  const t = Date.parse(`${from}T12:00:00Z`);
  const ahead = (weekday - new Date(t).getUTCDay() + 7) % 7;
  return new Date(t + ahead * 86_400_000).toISOString().slice(0, 10);
}
