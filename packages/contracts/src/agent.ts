import { z } from 'zod';

/**
 * The business brain (docs/AI-BRAIN.md): one AI agent per school that answers people and acts through the ordinary
 * domain services. The owner sets, per kind of action, how much it may do on its own.
 */

/** Every kind of action the brain knows. Kinds not wired yet (AGENT_WIRED_KINDS) show in the settings as coming. */
export const AGENT_ACTION_KINDS = [
  'report_absence',
  'book_makeup',
  'lesson_reminder',
  'payment_link',
  'freeze',
  'move_student',
  'message_family',
  'substitute',
  'cancel_lessons',
  'open_makeup_slots',
] as const;
export const AgentActionKind = z.enum(AGENT_ACTION_KINDS);
export type AgentActionKind = z.infer<typeof AgentActionKind>;

/**
 * The kinds the brain can already carry out: the owner's chat moves children, messages families, opens makeup slots,
 * sends payment links, cancels lessons and asks for substitutes; the parents' bot records absences, books makeups and
 * asks for freezes; an instructor's WhatsApp asks for a substitute. The rest join later.
 */
export const AGENT_WIRED_KINDS: readonly AgentActionKind[] = [
  'move_student',
  'message_family',
  'open_makeup_slots',
  'payment_link',
  'report_absence',
  'book_makeup',
  'freeze',
  'cancel_lessons',
  'substitute',
];

/** off: never; suggest: a proposal only; approve: ready, runs on the owner's tap; auto: runs at once and is reported. */
export const AUTONOMY_LEVELS = ['off', 'suggest', 'approve', 'auto'] as const;
export const AutonomyLevel = z.enum(AUTONOMY_LEVELS);
export type AutonomyLevel = z.infer<typeof AutonomyLevel>;

/** The highest level each kind may ever reach, whatever the owner sets: some things always wait for a person. */
export const AGENT_KIND_CEILING: Record<AgentActionKind, AutonomyLevel> = {
  report_absence: 'auto',
  book_makeup: 'auto',
  lesson_reminder: 'auto',
  payment_link: 'auto',
  freeze: 'auto',
  move_student: 'auto',
  // Free text written by a model goes out only after a person read it.
  message_family: 'approve',
  substitute: 'auto',
  // Cancelling lessons touches many families at once.
  cancel_lessons: 'approve',
  open_makeup_slots: 'auto',
};

/** Ready-made settings for the whole table; the owner can change any row afterwards. */
export const AGENT_PROFILES = ['careful', 'balanced', 'autopilot'] as const;
export const AgentProfile = z.enum(AGENT_PROFILES);
export type AgentProfile = z.infer<typeof AgentProfile>;

const all = (level: AutonomyLevel) =>
  Object.fromEntries(AGENT_ACTION_KINDS.map((k) => [k, level])) as Record<
    AgentActionKind,
    AutonomyLevel
  >;

export const AGENT_PROFILE_LEVELS: Record<AgentProfile, Record<AgentActionKind, AutonomyLevel>> = {
  careful: {
    ...all('approve'),
    report_absence: 'auto',
    lesson_reminder: 'auto',
    open_makeup_slots: 'suggest',
  },
  balanced: {
    ...all('approve'),
    report_absence: 'auto',
    lesson_reminder: 'auto',
    book_makeup: 'auto',
    payment_link: 'auto',
  },
  // Everything as far as its ceiling allows.
  autopilot: { ...AGENT_KIND_CEILING },
};

/** Where a request to the brain came from. */
export const AGENT_SOURCES = ['owner_chat', 'parent_whatsapp', 'staff', 'morning_check'] as const;
export type AgentSource = (typeof AGENT_SOURCES)[number];

export const AgentSettingsInput = z
  .object({
    profile: AgentProfile,
    levels: z.partialRecord(AgentActionKind, AutonomyLevel),
    /** How many actions may run on their own in one day before the rest wait for the owner. */
    maxAutoPerDay: z.int().min(0).max(500),
    /** A payment link above this amount waits for the owner even when payment links run on their own. */
    maxAutoPaymentAgorot: z.int().min(0).max(10_000_000),
    /** The stop switch: nothing runs on its own while paused. */
    paused: z.boolean(),
  })
  .strict();
export type AgentSettingsInput = z.infer<typeof AgentSettingsInput>;

export const AGENT_DEFAULT_SETTINGS: AgentSettingsInput = {
  profile: 'careful',
  levels: AGENT_PROFILE_LEVELS.careful,
  maxAutoPerDay: 30,
  maxAutoPaymentAgorot: 30_000,
  paused: false,
};
