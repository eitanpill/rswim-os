import { getFormatter, getTranslations } from 'next-intl/server';
import { ghlSettings, listImportRuns } from '@rswim/domain-crm';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { GhlConnectionView } from '@/components/ghl/connection';
import { requireSurface } from '@/lib/auth/session';
import { withSession } from '@/lib/db';
import { requestImportAction } from './actions';

const STAT_KEYS = [
  'create',
  'link',
  'already_linked',
  'duplicate_in_ghl',
  'conflict',
  'skipped',
] as const;

/**
 * A swim school's GHL sub-account: the owner connects it here (location id + Private Integration token), sees what it
 * holds, and brings its contacts in.
 */
export default async function GhlPage() {
  const session = await requireSurface('admin');
  const t = await getTranslations('crm');
  const format = await getFormatter();
  const { settings, runs } = await withSession(async (tx, ctx) => ({
    settings: await ghlSettings(tx, ctx.orgId),
    runs: await listImportRuns(tx),
  }));
  return (
    <>
      <PageHeader icon="🔌" title={t('title')} subtitle={t('subtitle')} />
      <GhlConnectionView
        owner={session.role === 'owner'}
        whatsappHref="/admin/integrations/whatsapp"
      >
        <Card>
          <CardTitle>{t('import')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('importHint')}</p>
          {settings ? (
            <ActionButton action={requestImportAction}>{t('importNow')}</ActionButton>
          ) : (
            <p className="text-sm">{t('connectFirst')}</p>
          )}
        </Card>

        <Card>
          <CardTitle>{t('runs')}</CardTitle>
          {runs.length === 0 ? (
            <EmptyState title={t('noRuns')} />
          ) : (
            <ul className="flex flex-col gap-3" data-testid="import-runs">
              {runs.map((r) => {
                const stats = r.stats as Partial<Record<(typeof STAT_KEYS)[number], number>>;
                const report = r.report as {
                  action: string;
                  ghlId: string;
                  name?: string;
                  reason?: string;
                }[];
                const problems = report.filter(
                  (l) => l.action === 'conflict' || l.action === 'duplicate_in_ghl',
                );
                return (
                  <li key={r.id} className="rounded-2xl border border-line/70 bg-surface/50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">
                        {format.dateTime(r.startedAt, { dateStyle: 'short', timeStyle: 'short' })}
                      </p>
                      <Badge
                        tone={
                          r.status === 'succeeded'
                            ? 'ok'
                            : r.status === 'failed'
                              ? 'danger'
                              : 'warn'
                        }
                      >
                        {t(`status.${r.status}`)}
                      </Badge>
                    </div>
                    {r.status === 'succeeded' ? (
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
                        {STAT_KEYS.map((k) => (
                          <div key={k}>
                            <dt className="text-ink-muted">{t(`stats.${k}`)}</dt>
                            <dd className="text-lg font-semibold">{stats[k] ?? 0}</dd>
                          </div>
                        ))}
                      </dl>
                    ) : null}
                    {r.error ? <p className="mt-2 text-sm text-danger-ink">{r.error}</p> : null}
                    {problems.length ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-sm text-brand-ink">
                          {t('problems', { count: problems.length })}
                        </summary>
                        <ul className="mt-1 text-sm">
                          {problems.map((p) => (
                            <li key={`${p.ghlId}-${p.action}`} dir="auto">
                              {t(`stats.${p.action}`)}: <span dir="ltr">{p.ghlId}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </GhlConnectionView>
    </>
  );
}
