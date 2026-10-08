import { getTranslations } from 'next-intl/server';
import { DIGEST_SECTIONS } from '@rswim/contracts';
import { listDigests, type DigestItem } from '@rswim/domain-reports';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { insightText } from '@/lib/insights';
import { dmy } from '@/lib/options';
import { ReportTabs } from '../shared';
import { buildDigestAction } from './actions';

/** The owner's weekly digest (brief §6.15): built every Sunday at 07:00, kept here week by week. */
export default async function DigestPage() {
  const t = await getTranslations('reports');
  const insight = await insightText();
  const digests = await withSession((tx) => listDigests(tx));
  const text = (i: DigestItem) => insight(i.code, i.params);

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('digest.subtitle')} />
      <ReportTabs active="digest" />
      <div className="mb-4">
        <ActionButton action={buildDigestAction} variant="secondary" data-testid="build-digest">
          {t('digest.build')}
        </ActionButton>
      </div>
      <div className="flex flex-col gap-4">
        {digests.length === 0 ? (
          <Card>
            <EmptyState title={t('digest.empty')} />
          </Card>
        ) : null}
        {digests.map((d) => (
          <Card key={d.id} data-testid="digest">
            <CardTitle>{t('digest.week', { date: dmy(d.weekOf) })}</CardTitle>
            {DIGEST_SECTIONS.map((s) => {
              const items = d.items.filter((i) => i.section === s);
              return items.length ? (
                <section key={s} className="mt-2" data-testid={`digest-${s}`}>
                  <h3 className="text-sm font-semibold text-ink-muted">
                    {t(`digest.sections.${s}`)}
                  </h3>
                  <ul className="ms-4 list-disc text-sm">
                    {items.map((i, n) => (
                      <li key={n}>{text(i)}</li>
                    ))}
                  </ul>
                </section>
              ) : null;
            })}
          </Card>
        ))}
      </div>
    </>
  );
}
