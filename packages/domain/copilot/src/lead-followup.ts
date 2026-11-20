/**
 * Following up new customers (WhatsApp track W4). Once a day the brain looks at the leads: a family whose trial was
 * yesterday (or in the last week) hears an offer to continue, or a new date when the child did not come; someone who
 * went quiet after the bot answered gets one nudge. Each goes through the brain's gate as `lead_followup`, so it is
 * sent at once or waits for the owner by her level. Rules only, no model; only where the bot for new customers is on.
 */
import type { LeadStage, Vertical } from '@rswim/contracts';
import { eq, schema, sql, type Tx } from '@rswim/db';
import { commsRules, enqueueMessage } from '@rswim/domain-comms';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import { hasFeature } from '@rswim/domain-platform';
import { followUpFor, followUpText, type FollowUpReason } from './lead-bot-policies';
import { proposalSummary, type ProposalParams } from './policies';
import { takeAction } from './services';

const { leads } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

interface Candidate {
  id: string;
  name: string | null;
  phone: string;
  stage: LeadStage;
  quiet_days: number | null;
  we_wrote_last: boolean;
  office_recently: boolean;
  trial_status: string | null;
  trial_days_ago: number | null;
  child: string | null;
  offer_until: string | null;
  done: FollowUpReason[] | null;
}

export async function runLeadFollowUps(
  tx: Tx,
  ctx: ServiceContext,
): Promise<{ id: string; reason: FollowUpReason; status: string }[]> {
  if (!(await commsRules(tx)).leadBotEnabled || !(await hasFeature(tx, 'parent_bot'))) return [];
  const [org] = await rows<{ vertical: Vertical }>(
    tx,
    sql`select vertical from organizations where id = ${ctx.orgId}`,
  );
  const vertical = org?.vertical ?? 'swim';
  const candidates = await rows<Candidate>(
    tx,
    sql`with last_in as (
          select lead_id, max(received_at) at from inbound_messages where lead_id is not null group by lead_id
        )
        select l.id, l.name, l.phone_e164 phone, l.stage,
               (app.today() - (li.at at time zone 'Asia/Jerusalem')::date)::int quiet_days,
               exists (select 1 from messages m where m.to_phone_e164 = l.phone_e164
                       and m.created_at > coalesce(li.at, '-infinity')) we_wrote_last,
               exists (select 1 from messages m where m.to_phone_e164 = l.phone_e164
                       and m.created_by is not null and m.created_at > now() - interval '3 days') office_recently,
               tr.status trial_status, (app.today() - tr.date)::int trial_days_ago, tr.child,
               tr.offer_valid_until::text offer_until,
               (select array_agg(a.params->>'reason') from copilot_actions a
                where a.kind = 'lead_followup' and a.params->>'leadId' = l.id::text) done
        from leads l
        left join last_in li on li.lead_id = l.id
        left join lateral (
          select t.status, t.date, t.offer_valid_until, s.first_name child from trials t
          join students s on s.id = t.student_id
          where s.household_id = l.household_id order by t.date desc limit 1
        ) tr on true
        where l.phone_e164 is not null
          and (l.stage = 'trial_booked'
               or (l.stage in ('new', 'talking') and li.at > now() - interval '15 days'))`,
  );
  const out: { id: string; reason: FollowUpReason; status: string }[] = [];
  for (const c of candidates) {
    const reason = followUpFor({
      stage: c.stage,
      quietDays: c.quiet_days,
      weWroteLast: c.we_wrote_last,
      officeRecently: c.office_recently,
      trial:
        c.trial_status === null ? null : { status: c.trial_status, daysAgo: c.trial_days_ago ?? 0 },
      done: c.done ?? [],
    });
    if (!reason) continue;
    const text = followUpText(reason, {
      name: c.name,
      child: c.child,
      offerUntil: c.offer_until,
      vertical,
    });
    const taken = await takeAction(tx, ctx, {
      source: 'morning_check',
      requestId: null,
      kind: 'lead_followup',
      params: { leadId: c.id, reason, text },
      summary: proposalSummary({ kind: 'lead_followup', who: c.name ?? c.phone, text }),
      amountAgorot: null,
    });
    out.push({ id: taken.id, reason, status: taken.status });
  }
  return out;
}

/** Runs an approved follow-up: one WhatsApp to the lead's number, once per lead and reason. */
export async function sendLeadFollowUp(
  tx: Tx,
  ctx: ServiceContext,
  p: ProposalParams['lead_followup'],
): Promise<{ messageId: string }> {
  const [lead] = await tx
    .select({ name: leads.name, phone: leads.phoneE164, householdId: leads.householdId })
    .from(leads)
    .where(eq(leads.id, p.leadId));
  if (!lead?.phone) throw new DomainError('common.errors.notFound');
  // Sent as the brain, not as the owner who approved it: the bot keeps answering the reply (it stays out of
  // conversations the office writes in).
  const m = await enqueueMessage(
    tx,
    { ...ctx, userId: null },
    {
      guardian: {
        id: null,
        householdId: lead.householdId,
        firstName: lead.name ?? '',
        phoneE164: lead.phone,
        whatsappOptIn: true,
        locale: 'he',
      },
      templateKey: 'free_text',
      vars: { text: p.text },
      idempotencyKey: `lead_followup:${p.leadId}:${p.reason}`,
    },
  );
  return { messageId: m.id };
}
