import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listCohorts } from '@rswim/domain-scheduling';
import { listPrograms } from '@rswim/domain-settings';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, SubmitButton } from '@/components/form';
import { explainer } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { createCohortAction } from './actions';
import { CohortFields } from './cohort-fields';

const COHORT_PROGRAMS = new Set(['intensive_course', 'camp']);
const TONE = { open: 'ok', closed: 'neutral', cancelled: 'danger' } as const;

/**
 * Intensive courses and camp weeks (brief §6.11): fixed cohorts over set dates with their own regulations, seats and,
 * for camps, a staff ratio.
 */
export default async function CohortsPage() {
  const t = await getTranslations('cohorts');
  const label = await enumLabel();
  const explain = await explainer();
  const { cohorts, programs } = await withSession(async (tx) => ({
    cohorts: await listCohorts(tx),
    programs: await listPrograms(tx),
  }));
  const programOptions = programs
    .filter((p) => COHORT_PROGRAMS.has(p.kind))
    .map((p) => ({ value: p.id, label: p.nameHe }));

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <div className="flex flex-col gap-4">
        {cohorts.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : (
          cohorts.map((c) => (
            <Card key={c.id} data-testid="cohort">
              <CardTitle
                aside={<Badge tone={TONE[c.status]}>{label('cohortStatus', c.status)}</Badge>}
              >
                <Link href={`/admin/cohorts/${c.id}`} className="hover:underline">
                  {c.name}
                </Link>
              </CardTitle>
              <p className="text-sm text-ink-muted">
                {t('line', {
                  program: c.programName,
                  from: dmy(c.startsOn),
                  to: dmy(c.endsOn),
                  registered: c.registered,
                  capacity: c.capacity,
                  groups: c.groupIds.length,
                })}
              </p>
              {c.facts.isCamp ? (
                <p
                  className={c.ratio.short ? 'text-sm text-warn' : 'text-sm text-ink-muted'}
                  data-testid="cohort-ratio"
                >
                  {explain(c.ratio.explanation)}
                </p>
              ) : null}
            </Card>
          ))
        )}
        <Card>
          <CardTitle>{t('add')}</CardTitle>
          {programOptions.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('noPrograms')}</p>
          ) : (
            <ActionForm action={createCohortAction} testId="cohort-form">
              <CohortFields programs={programOptions} />
              <div>
                <SubmitButton>{t('create')}</SubmitButton>
              </div>
            </ActionForm>
          )}
        </Card>
      </div>
    </>
  );
}
