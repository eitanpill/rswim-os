/**
 * Going live with a business's own WhatsApp number (WhatsApp track W10). The owner asks from the connection page;
 * the worker talks to Meta (side effects never run in a request): it checks the number, has Meta send the business's
 * messages to our webhook, sends our messages to Meta's review as templates and follows their status.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { PhoneE164, requiredText } from '@rswim/contracts';
import { and, asc, eq, isNotNull, schema, type Tx } from '@rswim/db';
import { DomainError, emit, type ServiceContext } from '@rswim/domain-core';
import type { WhatsAppAdmin } from '@rswim/integrations';
import { metaReviewOpen, metaTemplateDraft, type MetaDraftProblem } from '../policies';
import { enqueueMessage, schoolName } from './outbound';
import { ensureCommsDefaults } from './templates';

const { whatsappConnections, messageTemplates } = schema;

export const WHATSAPP_CHECK_REQUESTED = 'comms.whatsapp_check_requested';
export const WHATSAPP_TEMPLATES_REQUESTED = 'comms.whatsapp_templates_requested';

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);

/** The owner's connected number, or a refusal: only the owner's update reaches the row (RLS). */
async function ownConnection(tx: Tx, set: Partial<typeof whatsappConnections.$inferInsert>) {
  const [row] = await tx
    .update(whatsappConnections)
    .set({ status: 'connected', ...set })
    .where(eq(whatsappConnections.status, 'connected'))
    .returning({ id: whatsappConnections.id });
  if (!row) throw new DomainError('whatsapp.errors.notConnected');
  return row.id;
}

/** "Check the connection": the worker asks Meta about the number and subscribes our webhook. */
export async function requestWhatsAppCheck(tx: Tx, ctx: ServiceContext) {
  const connectionId = await ownConnection(tx, { checkError: null });
  await emit(tx, {
    organizationId: ctx.orgId,
    type: WHATSAPP_CHECK_REQUESTED,
    payload: { connectionId },
    idempotencyKey: `${WHATSAPP_CHECK_REQUESTED}:${connectionId}:${randomUUID()}`,
  });
}

export interface ConnectionFacts {
  connectionId: string;
  verifyToken: string;
}

/**
 * The check itself, in the worker: what Meta says about the number (its verified name and quality), then Meta is told
 * to send this business account's messages to the connection's own webhook address. What fails is kept on the
 * connection in Meta's words, for the owner.
 */
export async function runWhatsAppCheck(
  tx: Tx,
  conn: ConnectionFacts,
  admin: WhatsAppAdmin,
  publicUrl: string,
): Promise<'ok' | 'failed'> {
  const now = new Date();
  try {
    const info = await admin.number();
    await admin.subscribe(
      `${publicUrl.replace(/\/$/, '')}/api/webhooks/whatsapp/${conn.connectionId}`,
      conn.verifyToken,
    );
    await tx
      .update(whatsappConnections)
      .set({
        verifiedName: info.verifiedName,
        quality: info.quality,
        ...(info.displayPhone ? { displayPhone: info.displayPhone } : {}),
        checkedAt: now,
        subscribedAt: now,
        checkError: null,
      })
      .where(eq(whatsappConnections.id, conn.connectionId));
    return 'ok';
  } catch (e) {
    await tx
      .update(whatsappConnections)
      .set({ checkedAt: now, subscribedAt: null, checkError: errorText(e) })
      .where(eq(whatsappConnections.id, conn.connectionId));
    return 'failed';
  }
}

/** "Send the messages to Meta's review": the worker submits every message that is not there yet. */
export async function requestMetaTemplates(tx: Tx, ctx: ServiceContext) {
  const connectionId = await ownConnection(tx, {});
  await ensureCommsDefaults(tx, ctx.orgId);
  await emit(tx, {
    organizationId: ctx.orgId,
    type: WHATSAPP_TEMPLATES_REQUESTED,
    payload: { connectionId },
    idempotencyKey: `${WHATSAPP_TEMPLATES_REQUESTED}:${connectionId}:${randomUUID()}`,
  });
}

export interface TemplateSubmitResult {
  submitted: number;
  /** Already at Meta under the same name (sent before, or by another run). */
  adopted: number;
  failed: number;
  /** Named by hand, switched off, or a text Meta would refuse as it is. */
  skipped: number;
}

/**
 * Sends each active message to Meta's review as a utility template, once per text: a message whose text changed
 * since it was sent gets a new template (a new name). A template the owner named by hand is left alone. A message
 * Meta would refuse as written (only a placeholder, or starting or ending with one) is not sent; the page says which.
 */
export async function submitMetaTemplates(
  tx: Tx,
  ctx: ServiceContext,
  admin: WhatsAppAdmin,
): Promise<TemplateSubmitResult> {
  await ensureCommsDefaults(tx, ctx.orgId);
  const school = await schoolName(tx, ctx.orgId);
  const list = await tx
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.active, true))
    .orderBy(asc(messageTemplates.key), asc(messageTemplates.locale));
  const out: TemplateSubmitResult = { submitted: 0, adopted: 0, failed: 0, skipped: 0 };
  let existing: Awaited<ReturnType<WhatsAppAdmin['templates']>> = [];
  try {
    existing = await admin.templates();
  } catch {
    // Not being able to list is not a reason to stop: each creation below reports its own failure.
  }
  for (const tpl of list) {
    const locale = tpl.locale === 'en' ? 'en' : 'he';
    const draft = metaTemplateDraft({ key: tpl.key, locale, body: tpl.body, school });
    const byHand = tpl.metaName !== null && tpl.metaTemplateId === null && tpl.metaStatus === null;
    if (!draft.ok || byHand || tpl.metaName === draft.name) {
      out.skipped++;
      continue;
    }
    const known = existing.find((t) => t.name === draft.name && t.language === locale);
    try {
      const state = known ?? (await admin.createTemplate({ ...draft, language: locale }));
      await tx
        .update(messageTemplates)
        .set({
          metaName: draft.name,
          metaParams: draft.params,
          metaTemplateId: state.id,
          metaStatus: state.status,
          metaError: null,
          metaSubmittedAt: new Date(),
        })
        .where(eq(messageTemplates.id, tpl.id));
      if (known) out.adopted++;
      else out.submitted++;
    } catch (e) {
      await tx
        .update(messageTemplates)
        .set({ metaError: errorText(e) })
        .where(eq(messageTemplates.id, tpl.id));
      out.failed++;
    }
  }
  return out;
}

/** Brings Meta's decisions home: each template we sent gets its current status. Returns how many changed. */
export async function syncMetaTemplates(tx: Tx, admin: WhatsAppAdmin): Promise<number> {
  const mine = await tx
    .select({
      id: messageTemplates.id,
      locale: messageTemplates.locale,
      metaName: messageTemplates.metaName,
      metaStatus: messageTemplates.metaStatus,
    })
    .from(messageTemplates)
    .where(and(isNotNull(messageTemplates.metaName), isNotNull(messageTemplates.metaStatus)));
  if (mine.length === 0) return 0;
  const states = await admin.templates();
  let changed = 0;
  for (const tpl of mine) {
    const state = states.find((s) => s.name === tpl.metaName && s.language === tpl.locale);
    if (!state || state.status === tpl.metaStatus) continue;
    await tx
      .update(messageTemplates)
      .set({ metaStatus: state.status, metaTemplateId: state.id })
      .where(eq(messageTemplates.id, tpl.id));
    changed++;
  }
  return changed;
}

/** Whether any template of this business still waits for Meta (the worker's periodic check asks only then). */
export async function metaReviewPending(tx: Tx): Promise<boolean> {
  const list = await tx
    .select({ metaStatus: messageTemplates.metaStatus })
    .from(messageTemplates)
    .where(isNotNull(messageTemplates.metaStatus));
  return list.some((t) => metaReviewOpen(t.metaStatus));
}

export interface MetaTemplateRow {
  key: string;
  locale: string;
  /** Where the message stands: at Meta with a status, named by hand, not sent yet, or not sendable as written. */
  state: 'approved' | 'waiting' | 'rejected' | 'by_hand' | 'not_sent' | MetaDraftProblem;
  metaStatus: string | null;
  metaError: string | null;
}

/** Every active message and where it stands with Meta, for the connection page. */
export async function metaTemplateOverview(
  tx: Tx,
  ctx: ServiceContext,
): Promise<MetaTemplateRow[]> {
  const school = await schoolName(tx, ctx.orgId);
  const list = await tx
    .select()
    .from(messageTemplates)
    .where(eq(messageTemplates.active, true))
    .orderBy(asc(messageTemplates.key), asc(messageTemplates.locale));
  return list.map((tpl) => {
    const draft = metaTemplateDraft({
      key: tpl.key,
      locale: tpl.locale === 'en' ? 'en' : 'he',
      body: tpl.body,
      school,
    });
    const state: MetaTemplateRow['state'] =
      tpl.metaName !== null && tpl.metaStatus === null
        ? 'by_hand'
        : !draft.ok
          ? draft.reason
          : tpl.metaName !== draft.name
            ? 'not_sent'
            : tpl.metaStatus === 'APPROVED'
              ? 'approved'
              : metaReviewOpen(tpl.metaStatus)
                ? 'waiting'
                : 'rejected';
    return {
      key: tpl.key,
      locale: tpl.locale,
      state,
      metaStatus: tpl.metaStatus,
      metaError: tpl.metaError,
    };
  });
}

export const WhatsAppTestInput = z.object({ phone: PhoneE164, text: requiredText(500) });

/**
 * A test message from the business's number. It is free text, so it arrives only when that phone wrote to the number
 * in the last 24 hours; otherwise the message log shows it blocked, which is the right answer too.
 */
export async function sendWhatsAppTest(
  tx: Tx,
  ctx: ServiceContext,
  raw: z.input<typeof WhatsAppTestInput>,
) {
  const input = WhatsAppTestInput.parse(raw);
  await ownConnection(tx, {});
  return enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: '',
      phoneE164: input.phone,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: { text: input.text },
    idempotencyKey: `whatsapp-test:${randomUUID()}`,
  });
}
