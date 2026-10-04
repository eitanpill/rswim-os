/**
 * Phase 5 demo messaging for the demo tenant, through the comms services as the tenant's worker (all fake):
 * - The default templates and automations.
 * - Three WhatsApp messages in the inbox: the parent persona saying יואב won't come today (an absence draft when he
 *   has a lesson today, otherwise one for the office), a payment question from the twins' mother, and a lead from an
 *   unknown number.
 * - One message queued for Friday evening, held until Shabbat ends, and one broadcast scheduled for one venue.
 */
import { createDb, type Tx } from '@rswim/db';
import {
  createBroadcast,
  enqueueMessage,
  ensureCommsDefaults,
  intakeInbound,
} from '@rswim/domain-comms';
import type { ServiceContext } from '@rswim/domain-core';
import type pg from 'pg';

export interface CommsDataSummary {
  templates: number;
  inbound: number;
  held: number;
  broadcasts: number;
}

export async function seedCommsData(
  client: pg.PoolClient,
  orgId: string,
  parentPhone: string,
): Promise<CommsDataSummary> {
  const rows = async <T>(text: string, params: unknown[] = []) =>
    (await client.query(text, params)).rows as T[];
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const summary: CommsDataSummary = { templates: 0, inbound: 0, held: 0, broadcasts: 0 };

  await ensureCommsDefaults(tx, orgId);
  const [count] = await rows<{ n: number }>('select count(*)::int n from message_templates');
  summary.templates = count?.n ?? 0;

  // ─── The inbox ──────────────────────────────────────────────────────────────
  const [twinsMother] = await rows<{ phone_e164: string }>(
    `select g.phone_e164 from guardians g join households h on h.id = g.household_id
     where h.display_name = 'משפחת לוי' and g.first_name = 'רונית' limit 1`,
  );
  const now = Date.now();
  const inbound = [
    { phone: parentPhone, body: 'היי, יואב לא יגיע היום, הוא חולה 🤒', minutesAgo: 12 },
    {
      phone: twinsMother?.phone_e164 ?? null,
      body: 'כמה אני צריכה לשלם החודש על תמר ואיתי?',
      minutesAgo: 40,
    },
    {
      phone: '+972500000123',
      body: 'שלום, אשמח לפרטים על חוג שחייה לבן 6 בגוש עציון',
      minutesAgo: 95,
    },
  ];
  for (const [i, m] of inbound.entries()) {
    await intakeInbound(tx, ctx, {
      provider: 'ghl',
      externalId: `demo-inbound-${i + 1}`,
      phoneE164: m.phone,
      ghlContactId: null,
      body: m.body,
      receivedAt: new Date(now - m.minutesAgo * 60_000),
    });
    summary.inbound++;
  }

  // ─── A message that would land on Shabbat: held until it ends ───────────────
  const [parent] = await rows<{
    id: string;
    household_id: string;
    first_name: string;
    phone_e164: string | null;
    whatsapp_opt_in: boolean;
    locale: string;
  }>(
    `select id, household_id, first_name, phone_e164, whatsapp_opt_in, locale from guardians where phone_e164 = $1`,
    [parentPhone],
  );
  if (parent) {
    const held = await enqueueMessage(tx, ctx, {
      guardian: {
        id: parent.id,
        householdId: parent.household_id,
        firstName: parent.first_name,
        phoneE164: parent.phone_e164,
        whatsappOptIn: parent.whatsapp_opt_in,
        locale: parent.locale,
      },
      templateKey: 'free_text',
      vars: { text: 'תזכורת: מחר אין שיעורים, שבת שלום! (דמו)' },
      idempotencyKey: 'demo:held:friday',
      // Friday 9 Oct 2026, 19:00 in Jerusalem: inside the Shabbat window.
      notBefore: new Date('2026-10-09T16:00:00Z'),
    });
    if (held.status === 'held') summary.held++;
  }

  // ─── A broadcast scheduled for one venue ────────────────────────────────────
  const [venue] = await rows<{ id: string }>(
    `select id from venues where status = 'active' order by name limit 1`,
  );
  if (venue) {
    await createBroadcast(tx, ctx, {
      title: 'עדכון חניה בבריכה (דמו)',
      body: 'שלום, השבוע החניה הקרובה לבריכה סגורה. מומלץ להגיע 10 דקות מוקדם. תודה!',
      venueIds: [venue.id],
      owing: false,
      scheduledFor: '2026-12-13T10:00',
    });
    summary.broadcasts++;
  }

  await client.query('reset role');
  return summary;
}
