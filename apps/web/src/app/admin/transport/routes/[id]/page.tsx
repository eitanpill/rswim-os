import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { searchStudents } from '@rswim/domain-people';
import { listGroups } from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { getRoute, listSchools, ridersOf } from '@rswim/domain-transport';
import { Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import {
  addRiderAction,
  endRiderAction,
  setRouteActiveAction,
  updateRiderPointAction,
  updateRouteAction,
} from '../../actions';
import { RouteFields } from '../../route-form';
import { TransportTabs } from '../../tabs';

/** One route: its details, the children on it with their drop-off points, and adding a child. */
export default async function RoutePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('transport.routes');
  const data = await withSession(async (tx) => {
    const route = await getRoute(tx, id);
    if (!route) return null;
    return {
      route,
      riders: await ridersOf(tx, [id]),
      schools: await listSchools(tx),
      groups: await listGroups(tx),
      staff: await listStaff(tx),
      students: await searchStudents(tx, '', 500),
    };
  });
  if (!data) notFound();
  const { route, riders } = data;
  const riding = new Set(riders.map((r) => r.studentId));

  return (
    <>
      <PageHeader title={route.name} subtitle={`${route.schoolName} → ${route.groupName}`} />
      <TransportTabs active="routes" />
      <div className="flex flex-col gap-4">
        <Card data-testid="route-riders">
          <CardTitle>{t('ridersTitle', { n: riders.length })}</CardTitle>
          {riders.length === 0 ? (
            <EmptyState title={t('noRiders')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {riders.map((r) => (
                <li
                  key={r.id}
                  className="rounded-xl border border-line p-3"
                  data-testid="route-rider"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{r.name}</span>
                    <span className="text-xs text-ink-muted">
                      {t('since', { date: dmy(r.startsOn) })}
                    </span>
                  </div>
                  <ActionForm action={updateRiderPointAction} className="mt-2">
                    <input type="hidden" name="id" value={r.id} />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field
                        name="dropoffPoint"
                        label={t('dropoff')}
                        hint={t('dropoffHint')}
                        defaultValue={r.dropoffPoint ?? ''}
                      />
                      <Field
                        name="dropoffNote"
                        label={t('dropoffNote')}
                        defaultValue={r.dropoffNote ?? ''}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton variant="secondary">{t('savePoint')}</SubmitButton>
                    </div>
                  </ActionForm>
                  <div className="mt-2">
                    <ActionButton
                      action={endRiderAction}
                      fields={{ id: r.id, endsOn: todayIL() }}
                      variant="ghost"
                      confirm={t('endConfirm', { name: r.name })}
                    >
                      {t('end')}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addRiderAction} resetOnSuccess className="mt-3" testId="add-rider">
            <input type="hidden" name="routeId" value={route.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="studentId"
                label={t('student')}
                options={data.students
                  .filter((s) => !riding.has(s.id))
                  .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
              />
              <Field name="startsOn" type="date" label={t('startsOn')} defaultValue={todayIL()} />
              <Field name="dropoffPoint" label={t('dropoff')} hint={t('dropoffHint')} />
              <Field name="dropoffNote" label={t('dropoffNote')} />
            </div>
            <div>
              <SubmitButton>{t('addRider')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('details')}</CardTitle>
          <ActionForm action={updateRouteAction} testId="route-edit">
            <input type="hidden" name="id" value={route.id} />
            <RouteFields
              route={route}
              schools={data.schools.map((s) => ({ value: s.id, label: s.name }))}
              groups={data.groups.map((g) => ({ value: g.id, label: g.name }))}
              escorts={data.staff
                .filter((s) => s.status === 'active')
                .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }))}
            />
            <div>
              <SubmitButton>{t('save')}</SubmitButton>
            </div>
          </ActionForm>
          <div className="mt-3">
            <ActionButton
              action={setRouteActiveAction}
              fields={{ id: route.id, active: route.active ? 'false' : 'true' }}
              variant="ghost"
            >
              {route.active ? t('deactivate') : t('activate')}
            </ActionButton>
          </div>
        </Card>
      </div>
    </>
  );
}
