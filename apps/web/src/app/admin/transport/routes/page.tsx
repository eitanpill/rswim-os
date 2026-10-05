import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listGroups } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { listRoutes, listSchools } from '@rswim/domain-transport';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { createRouteAction } from '../actions';
import { RouteFields } from '../route-form';
import { TransportTabs } from '../tabs';

/** Routes from schools to after-school groups, and a form for a new one. */
export default async function RoutesPage() {
  const t = await getTranslations('transport.routes');
  const tw = await getTranslations('common.weekday');
  const data = await withSession(async (tx) => ({
    routes: await listRoutes(tx),
    schools: await listSchools(tx),
    groups: await listGroups(tx),
    staff: await listStaff(tx),
  }));
  const options = {
    schools: data.schools.filter((s) => s.active).map((s) => ({ value: s.id, label: s.name })),
    groups: data.groups.map((g) => ({ value: g.id, label: g.name })),
    escorts: data.staff
      .filter((s) => s.status === 'active')
      .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` })),
  };

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('hint')} />
      <TransportTabs active="routes" />
      <div className="flex flex-col gap-4">
        {data.routes.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.routes.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/admin/transport/routes/${r.id}`}
                  className="block"
                  data-testid="route"
                >
                  <Card className="hover:border-brand-500">
                    <CardTitle aside={r.active ? null : <Badge tone="warn">{t('inactive')}</Badge>}>
                      {r.name}
                    </CardTitle>
                    <p className="text-sm text-ink-muted">
                      {t('line', {
                        school: r.schoolName,
                        group: r.groupName,
                        days: r.weekdays.map((d) => tw(String(d))).join(', '),
                        leaves: r.leavesSchoolAt.slice(0, 5),
                      })}
                    </p>
                    <p className="text-sm">
                      {t('riders', { n: r.riders })}
                      {r.escortName ? ` · ${r.escortName}` : ''}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Card>
          <CardTitle>{t('add')}</CardTitle>
          {options.schools.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('needSchool')}</p>
          ) : (
            <ActionForm action={createRouteAction} testId="route-form">
              <RouteFields {...options} />
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
