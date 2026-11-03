/**
 * Pure rules of the business brain (docs/AI-BRAIN.md, docs/POLICIES.md §20): the level each kind of action runs at,
 * and the gate every action passes before anything changes. The model only fills in an action; this decides whether it
 * runs now, waits for the owner, or is refused.
 */
import {
  AGENT_ACTION_KINDS,
  AGENT_KIND_CEILING,
  AGENT_PROFILE_LEVELS,
  AUTONOMY_LEVELS,
  type AgentActionKind,
  type AgentProfile,
  type AutonomyLevel,
} from '@rswim/contracts';

const rank = (l: AutonomyLevel) => AUTONOMY_LEVELS.indexOf(l);

/** The lower of two levels. */
export function capLevel(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
  return rank(a) <= rank(b) ? a : b;
}

export interface AgentSettingsView {
  profile: AgentProfile;
  levels: Partial<Record<AgentActionKind, AutonomyLevel>>;
  maxAutoPerDay: number;
  maxAutoPaymentAgorot: number;
  paused: boolean;
}

/** The level of every kind: what the owner set, else the profile's, never above the kind's ceiling. */
export function effectiveLevels(s: AgentSettingsView): Record<AgentActionKind, AutonomyLevel> {
  return Object.fromEntries(
    AGENT_ACTION_KINDS.map((k) => [
      k,
      capLevel(s.levels[k] ?? AGENT_PROFILE_LEVELS[s.profile][k], AGENT_KIND_CEILING[k]),
    ]),
  ) as Record<AgentActionKind, AutonomyLevel>;
}

/** The profile whose table matches the levels exactly, or null when the owner changed rows ("custom"). */
export function matchingProfile(s: AgentSettingsView): AgentProfile | null {
  const levels = effectiveLevels(s);
  const base = effectiveLevels({ ...s, levels: {} });
  return AGENT_ACTION_KINDS.every((k) => levels[k] === base[k]) ? s.profile : null;
}

/** A level the owner asked for above a kind's ceiling is refused, not lowered silently. */
export function levelsWithinCeiling(levels: Partial<Record<AgentActionKind, AutonomyLevel>>): {
  ok: boolean;
  kind?: AgentActionKind;
} {
  for (const k of AGENT_ACTION_KINDS) {
    const l = levels[k];
    if (l && rank(l) > rank(AGENT_KIND_CEILING[k])) return { ok: false, kind: k };
  }
  return { ok: true };
}

// ─── The gate ───────────────────────────────────────────────────────────────

export type WaitReason = 'level' | 'paused' | 'daily_cap' | 'amount_cap';

export type GateDecision =
  { route: 'refuse'; code: string } | { route: 'wait'; reason: WaitReason } | { route: 'run' };

export interface GateFacts {
  level: AutonomyLevel;
  paused: boolean;
  /** Actions that already ran on their own today (Asia/Jerusalem). */
  ranAloneToday: number;
  maxAutoPerDay: number;
  /** The money the action asks for, when it asks for money. */
  amountAgorot: number | null;
  maxAutoPaymentAgorot: number;
}

/**
 * off → refused; suggest and approve → waits for the owner; auto → runs, unless the brain is paused, today's quota of
 * actions on its own is used up, or the amount is above the owner's cap (then it waits, never refused).
 */
export function agentGate(f: GateFacts): GateDecision {
  if (f.level === 'off') return { route: 'refuse', code: 'agent.errors.off' };
  if (f.level !== 'auto') return { route: 'wait', reason: 'level' };
  if (f.paused) return { route: 'wait', reason: 'paused' };
  if (f.ranAloneToday >= f.maxAutoPerDay) return { route: 'wait', reason: 'daily_cap' };
  if (f.amountAgorot !== null && f.amountAgorot > f.maxAutoPaymentAgorot)
    return { route: 'wait', reason: 'amount_cap' };
  return { route: 'run' };
}

/**
 * Kinds whose effect the journal can take back with one tap. A message that went out cannot be unsent, and an absence
 * already decided the child's makeup credit (the office voids a credit on the child's page).
 */
const UNDOABLE: ReadonlySet<AgentActionKind> = new Set([
  'move_student',
  'open_makeup_slots',
  'payment_link',
  'book_makeup',
  'freeze',
]);

export function undoable(kind: AgentActionKind): boolean {
  return UNDOABLE.has(kind);
}
