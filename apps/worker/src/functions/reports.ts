/**
 * The owner's weekly digest (brief §6.15): every Sunday at 07:00 each tenant's digest for the week is built from the
 * reports and stored for /admin/reports/digest. A tenant whose digest policy is off is skipped.
 */
import { schema } from '@rswim/db';
import { asPlatform, withOrg } from '@rswim/db/service';
import {
  buildWeeklyDigest,
  insightsWithoutNotes,
  refreshInsights,
  saveInsightNote,
  sundayOf,
} from '@rswim/domain-reports';
import { getDb, inngest } from '../client';
import { insightWriter } from '../providers';

const todayIL = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date());

export const reportsWeeklyDigest = inngest.createFunction(
  {
    id: 'reports-weekly-digest',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 0 7 * * 0' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const weekOf = sundayOf(todayIL());
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map(
          (r) => r.id,
        ),
      ),
    );
    let built = 0;
    for (const orgId of orgIds) {
      const ok = await step.run(`digest-${orgId}`, () =>
        withOrg(getDb(), orgId, async (tx) =>
          Boolean(await buildWeeklyDigest(tx, { orgId, userId: null }, weekOf)),
        ),
      );
      if (ok) built++;
    }
    return { weekOf, built };
  },
);

/**
 * The owner's insights feed, every morning at 06:30: each tenant's insights are worked out and stored (advisory only),
 * then, when the worker has ANTHROPIC_API_KEY and the policy allows it, Claude writes a short Hebrew explanation and
 * next step for the insights that have none. Without Claude the feed shows its built-in wording.
 */
export const reportsDailyInsights = inngest.createFunction(
  {
    id: 'reports-daily-insights',
    triggers: [{ cron: 'TZ=Asia/Jerusalem 30 6 * * *' }, { event: 'reports/insights.refresh' }],
    concurrency: { limit: 1 },
  },
  async ({ step }) => {
    const today = todayIL();
    const orgIds = await step.run('find-orgs', () =>
      asPlatform(getDb(), async (tx) =>
        (await tx.select({ id: schema.organizations.id }).from(schema.organizations)).map(
          (r) => r.id,
        ),
      ),
    );
    const writer = insightWriter();
    let notes = 0;
    for (const orgId of orgIds) {
      const refreshed = await step.run(`insights-${orgId}`, () =>
        withOrg(getDb(), orgId, (tx) => refreshInsights(tx, { orgId, userId: null }, today)),
      );
      if (!refreshed?.aiNotes || !writer) continue;
      notes += await step.run(`notes-${orgId}`, async () => {
        const pending = await withOrg(getDb(), orgId, (tx) => insightsWithoutNotes(tx));
        if (pending.length === 0) return 0;
        // The model is called outside any transaction; a note is kept only if its insight did not change meanwhile.
        const written = await writer.write({
          today,
          insights: pending.map((i) => ({
            id: i.id,
            kind: i.kind,
            severity: i.severity,
            params: i.params,
            detail: i.detail,
          })),
        });
        let saved = 0;
        await withOrg(getDb(), orgId, async (tx) => {
          for (const n of written) {
            const i = pending.find((p) => p.id === n.id);
            if (!i) continue;
            const note = {
              explanation: n.explanation,
              recommendation: n.recommendation,
              model: writer.name,
            };
            if (await saveInsightNote(tx, { id: i.id, params: i.params, note })) saved++;
          }
        });
        return saved;
      });
    }
    return { today, orgs: orgIds.length, notes };
  },
);
