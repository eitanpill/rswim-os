import { getLocale, getTranslations } from 'next-intl/server';
import { CURRENTS, DIVE_INCIDENT_KINDS, DIVE_SEVERITIES, WIND_DIRS } from '@rswim/contracts';
import { opsBoard } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import {
  closeIncidentAction,
  conditionsAction,
  reportIncidentAction,
  sessionStatusAction,
} from '../actions';
import { requireDivePage } from '../_ui/access';
import { Legend } from '../_ui/charts';
import { dateShort, dayLabel, hhmm, localDay } from '../_ui/format';
import { di } from '../_ui/icons';
import { CallBadge, Chip, Empty, Hero, Meter, Panel, type Tone } from '../_ui/kit';
import { PersonLine, WindArrow } from '../_ui/widgets';

const small = 'min-h-8 px-2.5 text-xs';

/**
 * The manager's operations room: the week on one board with the sea for each day, the morning sea report that sets
 * the call, the paperwork to chase, staff certificates, gear and the safety log.
 */
export default async function OpsRoom() {
  await requireDivePage('manager');
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const b = await withSession((tx) => opsBoard(tx));
  const seaByDay = new Map(b.outlook.map((c) => [c.observedOn, c]));
  const openIncidents = b.incidents.filter((i) => i.status === 'open');
  const certTone: Record<string, Tone> = {
    ok: 'go',
    warn: 'caution',
    expired: 'nogo',
    missing: 'nogo',
  };

  return (
    <div className="flex flex-col gap-5" data-testid="ops-room">
      <Hero
        kicker={t('manager.kicker')}
        title={t('manager.title')}
        sub={t('manager.sub', {
          sessions: b.sessions.filter((s) => s.status !== 'cancelled').length,
          paperwork: b.paperwork.length,
        })}
      />

      <Panel title={t('manager.week')} icon={di.calendar} testId="week-board" flush>
        <div className="grid auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-4">
          {b.days.map((day) => {
            const sea = seaByDay.get(day);
            const list = b.sessions.filter((s) => localDay(s.startsAt) === day);
            const divers = list.reduce((a, s) => a + (s.status === 'cancelled' ? 0 : s.booked), 0);
            return (
              <div
                key={day}
                className={cn(
                  'flex flex-col gap-2 rounded-xl border border-line p-2.5',
                  day === b.today &&
                    'border-[var(--dive-sea)] bg-[color-mix(in_oklch,var(--dive-sea)_5%,transparent)]',
                )}
              >
                <div className="flex items-center justify-between gap-1">
                  <div>
                    <p className="text-sm font-semibold">
                      {day === b.today ? t('common.today') : dayLabel(day, locale)}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {t('manager.diversCount', { count: divers })}
                    </p>
                  </div>
                  {sea ? (
                    <div
                      className="flex flex-col items-end gap-0.5"
                      title={`${t(`windDir.${sea.windDir}`)} ${sea.windKts} ${t('sea.kts')}`}
                    >
                      <CallBadge call={sea.call} label={t(`callShort.${sea.call}`)} size="sm" />
                      <span className="flex items-center gap-0.5 text-[11px] text-ink-muted">
                        <WindArrow dir={sea.windDir} size={12} />
                        {sea.windKts} {t('sea.kts')}
                      </span>
                    </div>
                  ) : null}
                </div>
                {list.length === 0 ? (
                  <p className="py-3 text-center text-xs text-ink-muted">{t('manager.quiet')}</p>
                ) : null}
                {list.map((s) => (
                  <div
                    key={s.id}
                    className={cn(
                      'rounded-lg border-s-4 bg-surface-raised p-2 shadow-sm ring-1 ring-line',
                      s.status === 'cancelled' && 'opacity-55',
                    )}
                    style={{ borderInlineStartColor: s.color ?? 'var(--dive-sea)' }}
                    data-testid="board-session"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold tabular-nums">{hhmm(s.startsAt)}</span>
                      <span className="text-xs tabular-nums text-ink-muted">
                        {s.booked}/{s.capacity}
                      </span>
                    </div>
                    <p
                      className={cn(
                        'text-sm leading-tight font-medium',
                        s.status === 'cancelled' && 'line-through',
                      )}
                    >
                      {s.title}
                    </p>
                    <p className="text-[11px] text-ink-muted">
                      {s.siteName} · {s.leadName ?? t('common.noLead')}
                    </p>
                    <div className="mt-1.5">
                      <Meter
                        value={s.booked}
                        max={s.capacity}
                        tone={s.booked >= s.capacity ? 'caution' : 'sea'}
                      />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {s.status !== 'scheduled' ? (
                        <Chip
                          tone={
                            s.status === 'go'
                              ? 'go'
                              : s.status === 'hold'
                                ? 'caution'
                                : s.status === 'cancelled'
                                  ? 'nogo'
                                  : 'info'
                          }
                        >
                          {t(`sessionStatus.${s.status}`)}
                        </Chip>
                      ) : null}
                      {!s.ratio.ok ? (
                        <Chip tone="nogo">{t('ratio.short', { needed: s.ratio.needed })}</Chip>
                      ) : null}
                      {sea &&
                      sea.call !== 'go' &&
                      s.siteKind !== 'pool' &&
                      s.status === 'scheduled' ? (
                        <Chip tone={sea.call === 'no_go' ? 'nogo' : 'caution'}>
                          {t('manager.seaRisk')}
                        </Chip>
                      ) : null}
                    </div>
                    {s.status === 'scheduled' || s.status === 'hold' ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.status !== 'hold' ? (
                          <ActionButton
                            action={sessionStatusAction}
                            fields={{ sessionId: s.id, status: 'hold' }}
                            variant="secondary"
                            className={small}
                          >
                            {t('manager.hold')}
                          </ActionButton>
                        ) : (
                          <ActionButton
                            action={sessionStatusAction}
                            fields={{ sessionId: s.id, status: 'scheduled' }}
                            variant="secondary"
                            className={small}
                          >
                            {t('manager.release')}
                          </ActionButton>
                        )}
                        <ActionButton
                          action={sessionStatusAction}
                          fields={{ sessionId: s.id, status: 'cancelled' }}
                          confirm={t('manager.cancelConfirm', { title: s.title })}
                          variant="ghost"
                          className={cn(small, 'text-[var(--dive-nogo)]')}
                        >
                          {t('manager.cancel')}
                        </ActionButton>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t('manager.seaReport')} icon={di.wind} testId="sea-report">
          <p className="mb-3 text-sm text-ink-muted">
            {t('manager.seaRules', {
              caution: b.rules.sea.caution_wind_kts,
              max: b.rules.sea.max_wind_kts,
              waves: b.rules.sea.max_wave_cm,
              vis: b.rules.sea.min_visibility_m,
            })}
          </p>
          <ActionForm action={conditionsAction} resetOnSuccess testId="sea-form">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SelectField
                name="siteId"
                label={t('manager.site')}
                options={b.sites.map((s) => ({ value: s.id, label: s.name }))}
                includeEmpty={t('sea.gulf')}
              />
              <Field
                name="windKts"
                label={t('sea.windKts')}
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                required
              />
              <SelectField
                name="windDir"
                label={t('sea.windDirLabel')}
                options={WIND_DIRS.map((d) => ({ value: d, label: t(`windDir.${d}`) }))}
              />
              <Field
                name="waveCm"
                label={t('sea.wavesCm')}
                type="number"
                inputMode="numeric"
                min={0}
                required
              />
              <Field
                name="visibilityM"
                label={t('sea.visibilityM')}
                type="number"
                inputMode="numeric"
                min={0}
                required
              />
              <Field
                name="waterTempC"
                label={t('sea.waterC')}
                type="number"
                inputMode="numeric"
                min={10}
                max={35}
                required
              />
              <SelectField
                name="current"
                label={t('sea.current')}
                options={CURRENTS.map((c) => ({ value: c, label: t(`current.${c}`) }))}
              />
              <div className="col-span-2">
                <Field name="note" label={t('manager.note')} />
              </div>
            </div>
            <div>
              <SubmitButton>{t('manager.postSea')}</SubmitButton>
            </div>
          </ActionForm>
        </Panel>

        <Panel title={t('manager.paperwork')} icon={di.shield} testId="paperwork" flush>
          {b.paperwork.length === 0 ? (
            <Empty>{t('manager.paperworkClear')}</Empty>
          ) : (
            <ul className="max-h-[26rem] divide-y divide-line overflow-y-auto">
              {b.paperwork.map((p) => (
                <li key={p.diverId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <a href={`/dive/divers/${p.diverId}`} className="min-w-0 hover:underline">
                    <PersonLine
                      name={p.name}
                      sub={`${dayLabel(p.on, locale)} · ${p.sessionTitle}`}
                    />
                  </a>
                  <Chip tone={p.issue === 'waiver' ? 'nogo' : 'caution'}>
                    {t(`readiness.${p.issue}.label`)}
                  </Chip>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title={t('manager.crewCerts')} icon={di.shield} flush testId="staff-certs">
          <ul className="divide-y divide-line">
            {b.staffCerts.map((c, i) => (
              <li
                key={`${c.name}-${c.kind}-${i}`}
                className="flex items-center justify-between gap-2 px-4 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{c.title}</span>
                </span>
                <Chip tone={certTone[c.state] ?? 'muted'}>
                  {c.expiresOn ? dateShort(c.expiresOn) : t('manager.noExpiry')}
                </Chip>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title={t('manager.gear')} icon={di.gear}>
          <Legend
            items={[
              { label: t('gearStatus.available'), color: 'var(--series-1)' },
              { label: t('gearStatus.rented'), color: 'var(--series-2)' },
              { label: t('gearStatus.maintenance'), color: 'var(--series-4)' },
            ]}
          />
          <ul className="mt-3 flex flex-col gap-2">
            {b.gear.map((g) => {
              const total = g.available + g.rented + g.maintenance || 1;
              return (
                <li
                  key={g.kind}
                  className="grid grid-cols-[6.5rem_1fr_2rem] items-center gap-2 text-sm"
                >
                  <span className="truncate text-ink-muted">{t(`gearKind.${g.kind}`)}</span>
                  <span className="flex h-3 gap-0.5 overflow-hidden rounded-full">
                    {(
                      [
                        ['available', g.available, 'var(--series-1)'],
                        ['rented', g.rented, 'var(--series-2)'],
                        ['maintenance', g.maintenance, 'var(--series-4)'],
                      ] as const
                    )
                      .filter(([, n]) => n > 0)
                      .map(([k, n, color]) => (
                        <span
                          key={k}
                          style={{ width: `${(n / total) * 100}%`, background: color }}
                          title={`${t(`gearKind.${g.kind}`)} · ${t(`gearStatus.${k}`)}: ${n}`}
                        />
                      ))}
                  </span>
                  <span className="text-end tabular-nums">{total}</span>
                </li>
              );
            })}
          </ul>
          {b.serviceDue.length > 0 ? (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-xs font-semibold text-ink-muted">
                {t('manager.serviceDue', { count: b.serviceDue.length })}
              </p>
              <div className="flex flex-wrap gap-1">
                {b.serviceDue.map((g) => (
                  <Chip
                    key={g.code}
                    tone="caution"
                    title={`${t(`gearKind.${g.kind}`)} · ${dateShort(g.since)}`}
                  >
                    {g.code}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel title={t('manager.rules')} icon={di.shield} testId="rules">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
            <dt className="text-ink-muted">{t('manager.rule.wind')}</dt>
            <dd className="text-end tabular-nums">
              {b.rules.sea.caution_wind_kts}–{b.rules.sea.max_wind_kts} {t('sea.kts')}
            </dd>
            <dt className="text-ink-muted">{t('manager.rule.ratioCourse')}</dt>
            <dd className="text-end tabular-nums">1:{b.rules.ratio.course}</dd>
            <dt className="text-ink-muted">{t('manager.rule.ratioTraining')}</dt>
            <dd className="text-end tabular-nums">1:{b.rules.ratio.training}</dd>
            <dt className="text-ink-muted">{t('manager.rule.ratioExperience')}</dt>
            <dd className="text-end tabular-nums">1:{b.rules.ratio.experience}</dd>
            <dt className="text-ink-muted">{t('manager.rule.step')}</dt>
            <dd className="text-end tabular-nums">+{b.rules.depth.progression_step_m}m</dd>
            <dt className="text-ink-muted">{t('manager.rule.waiver')}</dt>
            <dd className="text-end tabular-nums">
              {t('manager.rule.months', { count: b.rules.paperwork.waiver_valid_months })}
            </dd>
          </dl>
          <p className="mt-3 text-xs font-semibold text-ink-muted">{t('manager.rule.ceilings')}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {b.rules.depth.level_max_m.map((m, lvl) =>
              lvl === 0 ? null : (
                <Chip key={lvl} tone="info" icon={false}>
                  {t(`levelShort.${lvl}`)} · {m}m
                </Chip>
              ),
            )}
          </div>
          <p className="mt-3 text-xs text-ink-muted">{t('manager.rulesNote')}</p>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Panel title={t('manager.safetyLog')} icon={di.alert} flush testId="safety-log">
          {b.incidents.length === 0 ? (
            <Empty>{t('manager.noIncidents')}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {b.incidents.map((i) => (
                <li key={i.id} className="flex flex-col gap-1.5 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Chip
                      tone={
                        i.severity === 'high'
                          ? 'nogo'
                          : i.severity === 'medium'
                            ? 'caution'
                            : 'info'
                      }
                    >
                      {t(`incidentKind.${i.kind}`)}
                    </Chip>
                    <span className="text-xs text-ink-muted">
                      {dateShort(i.occurredAt)} · {i.diverName ?? '—'}
                      {i.depthM !== null ? ` · ${i.depthM}m` : ''}
                    </span>
                    <Chip
                      tone={i.status === 'open' ? 'caution' : 'muted'}
                      icon={false}
                      className="ms-auto"
                    >
                      {t(`incidentStatus.${i.status}`)}
                    </Chip>
                  </div>
                  <p className="text-sm">{i.description}</p>
                  {i.actionTaken ? (
                    <p className="text-xs text-ink-muted">↳ {i.actionTaken}</p>
                  ) : null}
                  {i.status === 'open' ? (
                    <ActionForm action={closeIncidentAction} className="flex-row items-end gap-2">
                      <input type="hidden" name="incidentId" value={i.id} />
                      <div className="flex-1">
                        <Field name="actionTaken" label={t('manager.actionTaken')} />
                      </div>
                      <SubmitButton variant="secondary">{t('manager.close')}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {openIncidents.length === 0 && b.incidents.length > 0 ? (
            <p className="border-t border-line px-4 py-2 text-xs text-ink-muted">
              {t('manager.allClosed')}
            </p>
          ) : null}
        </Panel>
        <Panel title={t('manager.report')} icon={di.bang}>
          <ActionForm action={reportIncidentAction} resetOnSuccess>
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                name="kind"
                label={t('manager.kind')}
                options={DIVE_INCIDENT_KINDS.map((k) => ({
                  value: k,
                  label: t(`incidentKind.${k}`),
                }))}
              />
              <SelectField
                name="severity"
                label={t('manager.severity')}
                options={DIVE_SEVERITIES.map((k) => ({
                  value: k,
                  label: t(`incidentSeverity.${k}`),
                }))}
              />
            </div>
            <TextareaField name="description" label={t('manager.description')} required />
            <div>
              <SubmitButton variant="secondary">{t('manager.reportSubmit')}</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      </div>
    </div>
  );
}
