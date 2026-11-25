/**
 * The outbound queue and log (brief §6.12). Queuing a message renders its template and decides at once whether it is
 * blocked (opted out, no phone, a missing variable, a switched-off template) or when it may go out; every outcome is a
 * row in `messages`. The worker's dispatcher sends due rows, deciding the send window again at send time, so a message
 * that waited into Shabbat is held rather than sent. The provider is never called for a message without a row.
 */
import type { TemplateKey } from '@rswim/contracts';
import { and, asc, desc, eq, inArray, lte, schema, sql, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { resolvePolicyFor } from '@rswim/domain-settings';
import { PushTokenGone, type MessagingProvider, type PushProvider } from '@rswim/integrations';
import {
  commsRulesFrom,
  enqueueDecision,
  outboundShape,
  renderTemplate,
  sendDecision,
  windowOpen,
  type CommsRules,
} from '../policies';
import { ensureCommsDefaults, templateFor } from './templates';

const { messages, organizations } = schema;

/** Who a message goes to: a guardian, or (with null ids) a staff member or the owner, by phone. */
export interface Addressee {
  id: string | null;
  householdId: string | null;
  firstName: string;
  phoneE164: string | null;
  whatsappOptIn: boolean;
  locale: string;
}

export type Vars = Record<string, string | number | null | undefined>;

export interface EnqueueInput {
  guardian: Addressee;
  templateKey: TemplateKey;
  /** Variables beyond the guardian's and school's names, or a function of the guardian's language. */
  vars: Vars | ((locale: 'he' | 'en') => Vars);
  idempotencyKey: string;
  source?: { eventId: string; eventType: string };
  broadcastId?: string;
  inboundMessageId?: string;
  /** Not before this time (an automation's delay, a scheduled broadcast). */
  notBefore?: Date;
}

export async function israelToday(tx: Tx): Promise<string> {
  const r = await tx.execute<{ d: string }>(sql`select app.today()::text as d`);
  return (r.rows[0] as { d: string }).d;
}

/** The org-level comms rules in force today. */
export async function commsRules(tx: Tx): Promise<CommsRules> {
  const resolved = await resolvePolicyFor(tx, { date: await israelToday(tx) });
  return commsRulesFrom(resolved.rules);
}

export async function schoolName(tx: Tx, orgId: string): Promise<string> {
  const [o] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return o?.name ?? '';
}

/**
 * Queues one message to one guardian, or logs why it cannot go. The same idempotency key queues once.
 * Returns the row's id and status (the existing row's when it was queued before).
 */
export async function enqueueMessage(
  tx: Tx,
  ctx: ServiceContext,
  input: EnqueueInput,
  cache: { rules?: CommsRules; school?: string } = {},
): Promise<{ id: string; status: string; created: boolean }> {
  const locale = input.guardian.locale === 'en' ? 'en' : 'he';
  let template = await templateFor(tx, input.templateKey, locale);
  if (!template) {
    await ensureCommsDefaults(tx, ctx.orgId);
    template = await templateFor(tx, input.templateKey, locale);
  }
  cache.rules ??= await commsRules(tx);
  cache.school ??= await schoolName(tx, ctx.orgId);
  const vars = {
    guardian_name: input.guardian.firstName,
    school_name: cache.school,
    ...(typeof input.vars === 'function' ? input.vars(locale) : input.vars),
  };
  const render = renderTemplate(template?.body ?? '', vars);
  const decision = enqueueDecision({
    optedIn: input.guardian.whatsappOptIn,
    phoneE164: input.guardian.phoneE164,
    templateActive: template?.active ?? false,
    render,
  });
  const notBefore = input.notBefore ?? new Date();
  const timing = decision.status === 'queued' ? sendDecision(notBefore, cache.rules) : null;
  const held = timing?.action === 'hold' ? timing : null;
  const [row] = await tx
    .insert(messages)
    .values({
      organizationId: ctx.orgId,
      guardianId: input.guardian.id,
      householdId: input.guardian.householdId,
      toPhoneE164: input.guardian.phoneE164,
      templateKey: input.templateKey,
      locale: template?.locale ?? locale,
      body: decision.text,
      status: decision.status === 'blocked' ? 'blocked' : held ? 'held' : 'queued',
      notBefore: held ? held.until : notBefore,
      holdReason: held?.reason ?? null,
      blockReason: decision.status === 'blocked' ? decision.reason : null,
      explanation: held ? held.explanation : decision.explanation,
      sourceEventId: input.source?.eventId ?? null,
      sourceEventType: input.source?.eventType ?? null,
      broadcastId: input.broadcastId ?? null,
      inboundMessageId: input.inboundMessageId ?? null,
      idempotencyKey: input.idempotencyKey,
      // Kept for an approved Meta template outside the 24-hour window (W5).
      vars,
      createdBy: ctx.userId,
    })
    .onConflictDoNothing()
    .returning({ id: messages.id, status: messages.status });
  if (row) return { ...row, created: true };
  const [existing] = await tx
    .select({ id: messages.id, status: messages.status })
    .from(messages)
    .where(
      and(
        eq(messages.organizationId, ctx.orgId),
        eq(messages.idempotencyKey, input.idempotencyKey),
      ),
    );
  return { ...(existing as { id: string; status: string }), created: false };
}

export interface DispatchResult {
  sent: number;
  held: number;
  failed: number;
  retrying: number;
  /** Outside WhatsApp's 24-hour window with no approved template (W5). */
  blocked: number;
  /** Reached the family's phone as a push notification from the store app, instead of WhatsApp (store stage 6). */
  pushed: number;
}

/**
 * Push first (store stage 6): a guardian whose people have the store app on a phone gets the message there, as a
 * notification titled with the school's name, and WhatsApp is not used. Returns the platform's id when at least one
 * phone took it; null sends it by WhatsApp. A token the platform calls dead is forgotten.
 */
async function pushToGuardian(
  tx: Tx,
  push: PushProvider,
  guardianId: string,
  message: { title: string; body: string },
): Promise<string | null> {
  const r = await tx.execute<{ id: string; platform: 'ios' | 'android'; token: string }>(
    sql`select d.id, d.platform, d.token from ${schema.pushDevices} d
        join ${schema.memberships} m on m.organization_id = d.organization_id and m.user_id = d.user_id
        where m.guardian_id = ${guardianId} and m.status = 'active'
        order by d.last_seen_at desc limit 5`,
  );
  let id: string | null = null;
  for (const d of r.rows) {
    if (!push.supports(d.platform)) continue;
    try {
      const sent = await push.send({ platform: d.platform, token: d.token }, message);
      id ??= sent.id;
    } catch (e) {
      if (e instanceof PushTokenGone)
        await tx.delete(schema.pushDevices).where(eq(schema.pushDevices.id, d.id));
    }
  }
  return id;
}

const MAX_ATTEMPTS = 3;

/**
 * Sends the organization's due messages, at most `comms.rate_per_minute` per run (the worker runs it every minute).
 * The send window is decided again now: inside quiet hours or a rest window every due message is held until it ends.
 * With a push provider, a family's message goes to the store app on their phone first and by WhatsApp only when no
 * phone took it.
 */
export async function dispatchDue(
  tx: Tx,
  ctx: ServiceContext,
  provider: MessagingProvider,
  now: Date = new Date(),
  push: PushProvider | null = null,
): Promise<DispatchResult> {
  const rules = await commsRules(tx);
  const out: DispatchResult = { sent: 0, held: 0, failed: 0, retrying: 0, blocked: 0, pushed: 0 };
  const due = await tx
    .select()
    .from(messages)
    .where(and(inArray(messages.status, ['queued', 'held']), lte(messages.notBefore, now)))
    .orderBy(asc(messages.notBefore), asc(messages.createdAt))
    .limit(rules.ratePerMinute)
    .for('update', { skipLocked: true });
  if (due.length === 0) return out;

  const window = sendDecision(now, rules);
  if (window.action === 'hold') {
    await tx
      .update(messages)
      .set({
        status: 'held',
        notBefore: window.until,
        holdReason: window.reason,
        explanation: window.explanation,
      })
      .where(
        inArray(
          messages.id,
          due.map((m) => m.id),
        ),
      );
    out.held = due.length;
    return out;
  }

  // Meta's Cloud API keeps to WhatsApp's 24-hour window: when each person last wrote to the business.
  const lastIn = new Map<string, Date>();
  if (provider.window) {
    const phones = [...new Set(due.map((m) => m.toPhoneE164).filter((p): p is string => !!p))];
    if (phones.length) {
      const r = await tx.execute<{ phone: string; at: Date }>(
        sql`select from_phone_e164 phone, max(received_at) at from ${schema.inboundMessages}
            where from_phone_e164 in (${sql.join(
              phones.map((p) => sql`${p}`),
              sql`, `,
            )}) group by from_phone_e164`,
      );
      for (const row of r.rows) lastIn.set(row.phone, new Date(row.at));
    }
  }

  let title: string | null = null;
  for (const m of due) {
    try {
      if (push && m.guardianId && m.body) {
        title ??= await schoolName(tx, ctx.orgId);
        const pushed = await pushToGuardian(tx, push, m.guardianId, { title, body: m.body });
        if (pushed) {
          await tx
            .update(messages)
            .set({
              status: 'sent',
              channel: 'push',
              sentAt: now,
              providerMessageId: pushed,
              attempts: m.attempts + 1,
              holdReason: null,
              error: null,
            })
            .where(eq(messages.id, m.id));
          out.pushed++;
          continue;
        }
      }
      const template = m.locale
        ? await templateFor(tx, m.templateKey as TemplateKey, m.locale)
        : null;
      const locale = m.locale === 'en' ? 'en' : 'he';
      const shape = outboundShape({
        window: provider.window === true,
        open: windowOpen(lastIn.get(m.toPhoneE164 as string) ?? null, now),
        locale,
        meta: template
          ? { name: template.metaName, params: template.metaParams, status: template.metaStatus }
          : null,
        vars: (m.vars as Record<string, unknown> | null) ?? null,
      });
      if (shape.kind === 'blocked') {
        await tx
          .update(messages)
          .set({
            status: 'blocked',
            blockReason: shape.reason,
            explanation: shape.explanation,
            holdReason: null,
          })
          .where(eq(messages.id, m.id));
        out.blocked++;
        continue;
      }
      const sent = await provider.send(
        { organizationId: ctx.orgId, idempotencyKey: m.idempotencyKey },
        {
          toPhoneE164: m.toPhoneE164 as string,
          text: m.body as string,
          locale,
          ...(shape.kind === 'template'
            ? { template: { id: shape.name, variables: {}, values: shape.values } }
            : !provider.window && template?.ghlTemplateId
              ? { template: { id: template.ghlTemplateId, variables: {} } }
              : {}),
        },
      );
      await tx
        .update(messages)
        .set({
          status: 'sent',
          sentAt: now,
          providerMessageId: sent.providerMessageId,
          attempts: m.attempts + 1,
          holdReason: null,
          error: null,
        })
        .where(eq(messages.id, m.id));
      out.sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const error = e instanceof Error ? e.message.slice(0, 500) : 'send failed';
      const final = attempts >= MAX_ATTEMPTS;
      await tx
        .update(messages)
        .set({
          status: final ? 'failed' : 'queued',
          attempts,
          error,
          notBefore: final ? m.notBefore : new Date(now.getTime() + 5 * 60_000 * attempts),
        })
        .where(eq(messages.id, m.id));
      if (final) out.failed++;
      else out.retrying++;
    }
  }
  return out;
}

/** Organizations with messages due (the dispatcher's cross-tenant scan runs this as the platform). */
export async function orgsWithDueMessages(tx: Tx, now: Date = new Date()): Promise<string[]> {
  const r = await tx
    .selectDistinct({ id: messages.organizationId })
    .from(messages)
    .where(and(inArray(messages.status, ['queued', 'held']), lte(messages.notBefore, now)));
  return r.map((x) => x.id);
}

/** The log, newest first, optionally one status. */
export async function listMessages(
  tx: Tx,
  q: { status?: string; householdId?: string; limit?: number } = {},
) {
  return tx
    .select()
    .from(messages)
    .where(
      and(
        q.status ? eq(messages.status, q.status) : undefined,
        q.householdId ? eq(messages.householdId, q.householdId) : undefined,
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(q.limit ?? 200);
}

/** Counts by status for the log's tabs. */
export async function messageCounts(tx: Tx): Promise<Record<string, number>> {
  const r = await tx.execute<{ status: string; n: number }>(
    sql`select status, count(*)::int as n from messages group by status`,
  );
  return Object.fromEntries(r.rows.map((x) => [x.status, x.n]));
}
