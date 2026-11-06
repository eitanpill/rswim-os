/**
 * The brain learns the owner (docs/AI-BRAIN.md, stage 6): it reads her decisions of the last months, suggests a level
 * per kind of action (she accepts or declines on the brain's page, never set behind her back), tells the morning check
 * which families and amounts to leave alone, and once a week tells her WhatsApp what it learned. Rules only, no model.
 */
import type { AgentActionKind, AutonomyLevel, DismissReason } from '@rswim/contracts';
import { schema, sql, type Tx } from '@rswim/db';
import { enqueueMessage } from '@rswim/domain-comms';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { todayIL } from '@rswim/domain-scheduling';
import { getAgentSettings, saveAgentSettings } from './agent';
import {
  declinedUntil,
  kindStats,
  learnedMinLink,
  learnedSuggestions,
  learningText,
  LEARN_WINDOW_DAYS,
  skippedHouseholds,
  SPECIAL_CASE_DAYS,
  type DecisionRow,
  type KindStats,
  type LevelSuggestion,
} from './learning-policies';

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

interface LearningMemo {
  declined?: Partial<Record<AgentActionKind, string>>;
}

async function memo(tx: Tx): Promise<LearningMemo> {
  const [r] = await rows<{ learning: LearningMemo }>(
    tx,
    sql`select learning from ${schema.agentSettings} limit 1`,
  );
  return r?.learning ?? {};
}

/** What the payment links the owner decided teach the morning check. */
async function linkLessons(tx: Tx) {
  const links = await rows<{
    householdId: string;
    amount: number;
    status: string;
    ranAlone: boolean;
    reason: DismissReason | null;
    daysAgo: number;
  }>(
    tx,
    sql`select params->>'householdId' "householdId", (params->>'amountAgorot')::int amount, status,
               ran_alone "ranAlone", dismiss_reason reason,
               (app.today() - (decided_at at time zone 'Asia/Jerusalem')::date)::int "daysAgo"
        from ${schema.copilotActions}
        where kind = 'payment_link' and decided_at is not null
          and decided_at > now() - make_interval(days => ${Math.max(SPECIAL_CASE_DAYS, LEARN_WINDOW_DAYS * 2)}::int)`,
  );
  return {
    dismissals: links
      .filter((l) => l.status === 'dismissed')
      .map((l) => ({ householdId: l.householdId, reason: l.reason, daysAgo: l.daysAgo })),
    minLinkAgorot: learnedMinLink({
      tooSmall: links.filter((l) => l.reason === 'too_small').map((l) => l.amount),
      approved: links
        .filter((l) => !l.ranAlone && (l.status === 'confirmed' || l.status === 'failed'))
        .map((l) => l.amount),
    }),
  };
}

/** What the morning check leaves alone today: families she dropped a link for, and balances she called too small. */
export async function morningLessons(
  tx: Tx,
  debtAttentionDays: number,
): Promise<{ skippedHouseholds: string[]; minLinkAgorot: number }> {
  const l = await linkLessons(tx);
  return {
    skippedHouseholds: skippedHouseholds(l.dismissals, debtAttentionDays),
    minLinkAgorot: l.minLinkAgorot,
  };
}

export interface LearningState {
  suggestions: LevelSuggestion[];
  stats: Record<AgentActionKind, KindStats>;
  minLinkAgorot: number;
  /** Suggestions she declined, and until when they stay quiet. */
  declined: Partial<Record<AgentActionKind, string>>;
  windowDays: number;
}

/** What the brain learned from the owner's decisions of the last LEARN_WINDOW_DAYS. */
export async function learningState(tx: Tx): Promise<LearningState> {
  const today = await todayIL(tx);
  const decisions = await rows<DecisionRow>(
    tx,
    sql`select kind, status, ran_alone "ranAlone", dismiss_reason "dismissReason"
        from ${schema.copilotActions}
        where status in ('confirmed', 'failed', 'dismissed', 'undone') and decided_at is not null
          and decided_at > now() - make_interval(days => ${LEARN_WINDOW_DAYS}::int)`,
  );
  const stats = kindStats(decisions);
  const settings = await getAgentSettings(tx);
  const declined = (await memo(tx)).declined ?? {};
  return {
    suggestions: learnedSuggestions({ stats, levels: settings.effective, declined, today }),
    stats,
    minLinkAgorot: (await linkLessons(tx)).minLinkAgorot,
    declined,
    windowDays: LEARN_WINDOW_DAYS,
  };
}

async function suggestionFor(tx: Tx, kind: AgentActionKind): Promise<LevelSuggestion> {
  const s = (await learningState(tx)).suggestions.find((x) => x.kind === kind);
  if (!s) throw new DomainError('agent.learning.errors.gone');
  return s;
}

/** The owner accepts a suggestion: that kind's level changes, as if she changed the row herself. */
export async function acceptLearning(
  tx: Tx,
  ctx: ServiceContext,
  kind: AgentActionKind,
): Promise<{ kind: AgentActionKind; level: AutonomyLevel }> {
  const s = await suggestionFor(tx, kind);
  const settings = await getAgentSettings(tx);
  await saveAgentSettings(tx, ctx, {
    profile: settings.profile,
    levels: { ...settings.levels, [kind]: s.to },
    maxAutoPerDay: settings.maxAutoPerDay,
    maxAutoPaymentAgorot: settings.maxAutoPaymentAgorot,
    paused: settings.paused,
  });
  return { kind, level: s.to };
}

/** The owner declines a suggestion: it stays quiet for LEARN_DECLINE_DAYS, whatever she decides meanwhile. */
export async function declineLearning(
  tx: Tx,
  ctx: ServiceContext,
  kind: AgentActionKind,
): Promise<{ until: string }> {
  await suggestionFor(tx, kind);
  const until = declinedUntil(await todayIL(tx));
  const patch = JSON.stringify({ [kind]: until });
  await tx.execute(
    sql`insert into ${schema.agentSettings} (organization_id, learning, updated_by)
        values (${ctx.orgId}, jsonb_build_object('declined', ${patch}::jsonb), ${ctx.userId})
        on conflict (organization_id) do update set
          learning = jsonb_set(${schema.agentSettings}.learning, '{declined}',
                       coalesce(${schema.agentSettings}.learning->'declined', '{}'::jsonb) || ${patch}::jsonb),
          updated_by = excluded.updated_by`,
  );
  return { until };
}

/**
 * The weekly WhatsApp to the owner's approvals number: what the brain learned and suggests. Nothing without a number,
 * with the evening summary turned off, or with nothing to say; once a day at most.
 */
export async function sendLearningDigest(
  tx: Tx,
  ctx: ServiceContext,
): Promise<{ sent: boolean; reason?: string }> {
  const s = await getAgentSettings(tx);
  if (!s.approvalPhoneE164) return { sent: false, reason: 'no_phone' };
  if (!s.eveningSummary) return { sent: false, reason: 'off' };
  const state = await learningState(tx);
  if (!learningText(state, 'he')) return { sent: false, reason: 'nothing' };
  const today = await todayIL(tx);
  const out = await enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: '',
      phoneE164: s.approvalPhoneE164,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: (locale) => ({ text: learningText(state, locale) as string }),
    idempotencyKey: `agent.learning:${today}`,
  });
  return out.created ? { sent: true } : { sent: false, reason: 'already' };
}
