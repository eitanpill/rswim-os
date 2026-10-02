import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  CLOSURE_SOURCES,
  CONTRACT_KINDS,
  GENDER_RESTRICTIONS,
  RENT_MODELS,
} from '@rswim/contracts';
import { getVenue, weekGrid, type VenueDetail } from '@rswim/domain-venues';
import { agorot } from '@rswim/money';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  CheckboxGroup,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL, weekdayOptions } from '@/lib/options';
import {
  addClosureAction,
  addContractAction,
  createPoolAction,
  deleteClosureAction,
  deleteContractAction,
  deletePoolAction,
  deleteWindowAction,
  saveWindowAction,
  updateVenueAction,
} from '../actions';
import { VenueForm } from '../venue-form';

const hhmm = (t: string) => t.slice(0, 5);
type Pool = VenueDetail['pools'][number];
type Window = VenueDetail['windows'][number];

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await withSession((tx) => getVenue(tx, id));
  if (!detail) notFound();
  const t = await getTranslations('venues');
  const label = await enumLabel();
  const { venue, pools, windows, closures, contracts } = detail;

  return (
    <>
      <PageHeader
        title={venue.name}
        subtitle={`${label('venueKind', venue.kind)} · ${label('venueStatus', venue.status)}`}
        actions={
          <Link href={`/admin/policies?venue=${venue.id}`} className="text-brand-700 underline">
            {t('policies')}
          </Link>
        }
      />
      <div className="flex flex-col gap-4">
        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer text-lg font-semibold">
              {t('details')}
            </summary>
            <div className="mt-3">
              <VenueForm action={updateVenueAction.bind(null, venue.id)} venue={venue} />
            </div>
          </details>
        </Card>

        {pools.map((pool) => (
          <PoolCard
            key={pool.id}
            venueId={venue.id}
            pool={pool}
            windows={windows.filter((w) => w.poolId === pool.id)}
          />
        ))}

        <Card>
          <CardTitle>{t('pool.add')}</CardTitle>
          <PoolForm venueId={venue.id} />
        </Card>

        <ClosuresCard venueId={venue.id} closures={closures} />
        <ContractsCard venueId={venue.id} contracts={contracts} />
      </div>
    </>
  );
}

async function PoolForm({ venueId }: { venueId: string }) {
  const t = await getTranslations('venues.pool');
  return (
    <ActionForm action={createPoolAction.bind(null, venueId)} resetOnSuccess testId="pool-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('name')} required />
        <Field
          name="laneCount"
          label={t('laneCount')}
          type="number"
          min={1}
          max={20}
          defaultValue="4"
          inputMode="numeric"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field name="tempMinC" label={t('tempMin')} type="number" inputMode="numeric" />
        <Field name="tempMaxC" label={t('tempMax')} type="number" inputMode="numeric" />
        <Field name="depthMinCm" label={t('depthMin')} type="number" inputMode="numeric" />
        <Field name="depthMaxCm" label={t('depthMax')} type="number" inputMode="numeric" />
      </div>
      <CheckboxField name="indoor" label={t('indoor')} defaultChecked />
      <div>
        <SubmitButton>{t('add')}</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function PoolCard({
  venueId,
  pool,
  windows,
}: {
  venueId: string;
  pool: Pool;
  windows: Window[];
}) {
  const t = await getTranslations('venues');
  const tc = await getTranslations('common');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const laneLabel = (laneId: string) => pool.lanes.find((l) => l.id === laneId)?.label ?? '?';
  const grid = weekGrid(windows);
  const facts = [
    t('pool.lanes', { count: pool.lanes.length }),
    pool.indoor ? t('pool.indoor') : t('pool.outdoor'),
    pool.tempMinC !== null
      ? t('pool.temp', { min: pool.tempMinC, max: pool.tempMaxC ?? pool.tempMinC })
      : null,
  ].filter(Boolean);

  return (
    <Card data-testid={`pool-${pool.name}`}>
      <CardTitle
        aside={
          <ActionButton
            action={deletePoolAction.bind(null, venueId)}
            fields={{ id: pool.id }}
            variant="ghost"
            confirm={t('pool.confirmDelete')}
          >
            {tc('delete')}
          </ActionButton>
        }
      >
        {pool.name}
      </CardTitle>
      <p className="mb-3 text-sm text-ink-muted">{facts.join(' · ')}</p>

      <h3 className="mb-2 font-semibold">{t('window.title')}</h3>
      {windows.length === 0 ? (
        <EmptyState title={t('window.empty')} />
      ) : (
        <ol className="mb-3 flex flex-col gap-2" aria-label={t('window.title')}>
          {grid.map((day, weekday) =>
            day.map((w) => (
              <li key={w.id} className="rounded-xl border border-line p-3" data-testid="window-row">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{tw(String(weekday))}</span>
                    <span dir="ltr">
                      {hhmm(w.startsAt)}–{hhmm(w.endsAt)}
                    </span>
                    <Badge tone={w.genderRestriction === 'mixed' ? 'neutral' : 'warn'}>
                      {label('gender', w.genderRestriction)}
                    </Badge>
                    <span className="text-sm text-ink-muted">
                      {t('window.lanes', { lanes: w.laneIds.map(laneLabel).join(', ') })}
                    </span>
                  </div>
                  <ActionButton
                    action={deleteWindowAction.bind(null, venueId)}
                    fields={{ id: w.id }}
                    variant="ghost"
                    confirm={t('window.confirmDelete')}
                  >
                    {tc('delete')}
                  </ActionButton>
                </div>
                <p className="text-xs text-ink-muted">
                  {w.effectiveTo
                    ? t('window.between', { from: dmy(w.effectiveFrom), to: dmy(w.effectiveTo) })
                    : t('window.from', { from: dmy(w.effectiveFrom) })}
                  {w.notes ? ` · ${w.notes}` : ''}
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-brand-700">{tc('edit')}</summary>
                  <div className="mt-2">
                    <WindowForm venueId={venueId} pool={pool} window={w} />
                  </div>
                </details>
              </li>
            )),
          )}
        </ol>
      )}
      <details>
        <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
          {t('window.add')}
        </summary>
        <div className="mt-2">
          <WindowForm venueId={venueId} pool={pool} />
        </div>
      </details>
    </Card>
  );
}

async function WindowForm({
  venueId,
  pool,
  window: w,
}: {
  venueId: string;
  pool: Pool;
  window?: Window;
}) {
  const t = await getTranslations('venues.window');
  const tc = await getTranslations('common');
  return (
    <ActionForm
      action={saveWindowAction.bind(null, venueId)}
      resetOnSuccess={!w}
      testId={w ? `window-edit-${w.id}` : `window-form-${pool.name}`}
    >
      <input type="hidden" name="poolId" value={pool.id} />
      {w ? <input type="hidden" name="id" value={w.id} /> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SelectField
          name="weekday"
          label={t('weekday')}
          options={await weekdayOptions()}
          defaultValue={w ? String(w.weekday) : '1'}
        />
        <SelectField
          name="genderRestriction"
          label={t('gender')}
          options={await enumOptions('gender', GENDER_RESTRICTIONS)}
          defaultValue={w?.genderRestriction ?? 'mixed'}
        />
        <Field
          name="startsAt"
          label={t('startsAt')}
          type="time"
          defaultValue={w ? hhmm(w.startsAt) : '16:00'}
        />
        <Field
          name="endsAt"
          label={t('endsAt')}
          type="time"
          defaultValue={w ? hhmm(w.endsAt) : '19:00'}
        />
      </div>
      <CheckboxGroup
        name="laneIds"
        legend={t('lanesLegend')}
        options={pool.lanes.map((l) => ({ value: l.id, label: t('lane', { label: l.label }) }))}
        defaultValues={w?.laneIds ?? []}
      />
      <div className="grid grid-cols-2 gap-3">
        <Field
          name="effectiveFrom"
          label={t('effectiveFrom')}
          type="date"
          defaultValue={w?.effectiveFrom ?? todayIL()}
        />
        <Field
          name="effectiveTo"
          label={t('effectiveTo')}
          type="date"
          defaultValue={w?.effectiveTo ?? ''}
          hint={t('effectiveToHint')}
        />
      </div>
      <Field name="notes" label={t('notes')} defaultValue={w?.notes ?? ''} />
      <div>
        <SubmitButton>{w ? tc('save') : t('add')}</SubmitButton>
      </div>
    </ActionForm>
  );
}

async function ClosuresCard({
  venueId,
  closures,
}: {
  venueId: string;
  closures: VenueDetail['closures'];
}) {
  const t = await getTranslations('venues.closure');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      {closures.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {closures.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
            >
              <div>
                <p className="font-medium">{c.reason}</p>
                <p className="text-sm text-ink-muted">
                  {c.startsOn === c.endsOn
                    ? dmy(c.startsOn)
                    : `${dmy(c.startsOn)} – ${dmy(c.endsOn)}`}{' '}
                  · {label('closureSource', c.source)}
                </p>
              </div>
              <ActionButton
                action={deleteClosureAction.bind(null, venueId)}
                fields={{ id: c.id }}
                variant="ghost"
              >
                {tc('delete')}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
          {t('add')}
        </summary>
        <ActionForm action={addClosureAction.bind(null, venueId)} resetOnSuccess className="mt-2">
          <div className="grid grid-cols-2 gap-3">
            <Field name="startsOn" label={t('startsOn')} type="date" />
            <Field name="endsOn" label={t('endsOn')} type="date" />
          </div>
          <SelectField
            name="source"
            label={t('source')}
            options={await enumOptions('closureSource', CLOSURE_SOURCES)}
          />
          <Field name="reason" label={t('reason')} />
          <p className="text-xs text-ink-muted">{t('hint')}</p>
          <div>
            <SubmitButton>{t('add')}</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </Card>
  );
}

async function ContractsCard({
  venueId,
  contracts,
}: {
  venueId: string;
  contracts: VenueDetail['contracts'];
}) {
  const t = await getTranslations('venues.contract');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  return (
    <Card>
      <CardTitle>{t('title')}</CardTitle>
      {contracts.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <ul className="mb-3 flex flex-col gap-2">
          {contracts.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-line p-3"
            >
              <div>
                <p className="font-medium">
                  {label('contractKind', c.kind)} · {label('rentModel', c.rentModel)} ·{' '}
                  <Money agorot={agorot(c.amountAgorot)} />
                </p>
                <p className="text-sm text-ink-muted">
                  {[c.startsOn, c.endsOn].filter(Boolean).map(dmy).join(' – ')}
                  {c.renewalOn ? ` · ${t('renewal', { date: dmy(c.renewalOn) })}` : ''}
                </p>
              </div>
              <ActionButton
                action={deleteContractAction.bind(null, venueId)}
                fields={{ id: c.id }}
                variant="ghost"
              >
                {tc('delete')}
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="min-h-tap cursor-pointer font-medium text-brand-700">
          {t('add')}
        </summary>
        <ActionForm action={addContractAction.bind(null, venueId)} resetOnSuccess className="mt-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              name="kind"
              label={t('kind')}
              options={await enumOptions('contractKind', CONTRACT_KINDS)}
            />
            <SelectField
              name="rentModel"
              label={t('rentModel')}
              options={await enumOptions('rentModel', RENT_MODELS)}
            />
            <Field name="amountAgorot" label={t('amount')} inputMode="decimal" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field name="startsOn" label={t('startsOn')} type="date" />
            <Field name="endsOn" label={t('endsOn')} type="date" />
            <Field name="renewalOn" label={t('renewalOn')} type="date" />
          </div>
          <TextareaField name="notes" label={t('notes')} />
          <div>
            <SubmitButton>{t('add')}</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </Card>
  );
}
