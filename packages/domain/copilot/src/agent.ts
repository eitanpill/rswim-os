/**
 * The business brain's settings and journal (docs/AI-BRAIN.md). The owner sets how much the brain may do per kind of
 * action; every action, from any channel, is one row in copilot_actions with the level the gate applied, and the owner
 * approves, dismisses or undoes it from the "waiting for you" queue and the journal.
 */
import {
  AGENT_DEFAULT_SETTINGS,
  AGENT_PROFILE_LEVELS,
  AgentSettingsInput,
  type AgentActionKind,
  type AgentProfile,
  type AgentSource,
  type AutonomyLevel,
  type CopilotActionStatus,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  agentGate,
  effectiveLevels,
  levelsWithinCeiling,
  matchingProfile,
  type AgentSettingsView,
  type GateDecision,
} from './agent-policies';
import type { Explanation } from './policies';

const { agentSettings, copilotActions } = schema;

// ─── Settings ───────────────────────────────────────────────────────────────

export interface AgentSettingsState extends AgentSettingsView {
  /** Each kind's level after the profile and the ceilings. */
  effective: Record<AgentActionKind, AutonomyLevel>;
  /** The profile the table still matches, or null once the owner changed a row. */
  matches: AgentProfile | null;
}

/** The school's settings, or the careful defaults when the owner never saved any. */
export async function getAgentSettings(tx: Tx): Promise<AgentSettingsState> {
  const [row] = await tx.select().from(agentSettings).limit(1);
  const view: AgentSettingsView = row
    ? {
        profile: row.profile as AgentProfile,
        levels: row.levels as AgentSettingsView['levels'],
        maxAutoPerDay: row.maxAutoPerDay,
        maxAutoPaymentAgorot: row.maxAutoPaymentAgorot,
        paused: row.paused,
      }
    : { ...AGENT_DEFAULT_SETTINGS, levels: {} };
  return { ...view, effective: effectiveLevels(view), matches: matchingProfile(view) };
}

async function upsert(
  tx: Tx,
  ctx: ServiceContext,
  values: Partial<typeof agentSettings.$inferInsert>,
) {
  await tx
    .insert(agentSettings)
    .values({ organizationId: ctx.orgId, ...values, updatedBy: ctx.userId })
    .onConflictDoUpdate({
      target: agentSettings.organizationId,
      set: { ...values, updatedBy: ctx.userId },
    });
}

/** Saves the whole table. A level above a kind's ceiling is refused. */
export async function saveAgentSettings(tx: Tx, ctx: ServiceContext, raw: AgentSettingsInput) {
  const input = AgentSettingsInput.parse(raw);
  const within = levelsWithinCeiling(input.levels);
  if (!within.ok) throw new DomainError('agent.errors.aboveCeiling', { kind: within.kind ?? '' });
  await upsert(tx, ctx, {
    profile: input.profile,
    levels: input.levels,
    maxAutoPerDay: input.maxAutoPerDay,
    maxAutoPaymentAgorot: input.maxAutoPaymentAgorot,
    paused: input.paused,
  });
}

/** Picks a ready-made profile: every row takes its level, the caps stay. */
export async function applyAgentProfile(tx: Tx, ctx: ServiceContext, profile: AgentProfile) {
  await upsert(tx, ctx, { profile, levels: AGENT_PROFILE_LEVELS[profile] });
}

/** The stop switch: while paused nothing runs on its own; everything waits for the owner. */
export async function setAgentPaused(tx: Tx, ctx: ServiceContext, paused: boolean) {
  await upsert(tx, ctx, { paused });
}

// ─── The gate ───────────────────────────────────────────────────────────────

/** Actions that ran without a person's tap today (Asia/Jerusalem), counted against the daily cap. */
export async function ranAloneToday(tx: Tx): Promise<number> {
  const r = await tx.execute<{ n: number }>(
    sql`select count(*)::int n from copilot_actions
        where ran_alone and (decided_at at time zone 'Asia/Jerusalem')::date = app.today()`,
  );
  return (r.rows[0] as { n: number }).n;
}

/** Where one action goes under this school's settings, and the level it was judged at. */
export async function gateFor(
  tx: Tx,
  kind: AgentActionKind,
  amountAgorot: number | null,
): Promise<{ level: AutonomyLevel; decision: GateDecision }> {
  const s = await getAgentSettings(tx);
  const level = s.effective[kind];
  const decision = agentGate({
    level,
    paused: s.paused,
    ranAloneToday: level === 'auto' ? await ranAloneToday(tx) : 0,
    maxAutoPerDay: s.maxAutoPerDay,
    amountAgorot,
    maxAutoPaymentAgorot: s.maxAutoPaymentAgorot,
  });
  return { level, decision };
}

// ─── The journal ────────────────────────────────────────────────────────────

export interface AgentActionRow {
  id: string;
  kind: AgentActionKind;
  source: AgentSource;
  autonomy: AutonomyLevel | null;
  ranAlone: boolean;
  summary: Explanation;
  status: CopilotActionStatus;
  result: unknown;
  errorCode: string | null;
  /** The owner's words, for actions that came from the chat. */
  prompt: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  undoneAt: Date | null;
}

/** Newest first; `statuses` narrows to e.g. the proposals waiting for the owner. */
export async function listAgentActions(
  tx: Tx,
  opts: { statuses?: CopilotActionStatus[]; limit?: number } = {},
): Promise<AgentActionRow[]> {
  const rows = await tx
    .select({
      a: copilotActions,
      prompt: schema.copilotRequests.prompt,
    })
    .from(copilotActions)
    .leftJoin(
      schema.copilotRequests,
      and(
        eq(schema.copilotRequests.organizationId, copilotActions.organizationId),
        eq(schema.copilotRequests.id, copilotActions.requestId),
      ),
    )
    .where(opts.statuses?.length ? inArray(copilotActions.status, opts.statuses) : undefined)
    .orderBy(desc(copilotActions.createdAt))
    .limit(opts.limit ?? 100);
  return rows.map(({ a, prompt }) => ({
    id: a.id,
    kind: a.kind as AgentActionKind,
    source: a.source as AgentSource,
    autonomy: a.autonomy as AutonomyLevel | null,
    ranAlone: a.ranAlone,
    summary: a.summary as Explanation,
    status: a.status as CopilotActionStatus,
    result: a.result,
    errorCode: a.errorCode,
    prompt,
    createdAt: a.createdAt,
    decidedAt: a.decidedAt,
    undoneAt: a.undoneAt,
  }));
}

/** How many proposals wait for the owner (the home page's badge). */
export async function waitingActionsCount(tx: Tx): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(copilotActions)
    .where(eq(copilotActions.status, 'proposed'));
  return r?.n ?? 0;
}

/** Whether the signed-in user is the school's owner: the brain's settings and journal are theirs alone. */
export async function isAgentOwner(tx: Tx): Promise<boolean> {
  const r = await tx.execute<{ owner: boolean }>(sql`select app.is_owner() owner`);
  return (r.rows[0] as { owner: boolean } | undefined)?.owner === true;
}
