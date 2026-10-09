import { getLocale, getTranslations } from 'next-intl/server';
import { DIVE_DISCIPLINES, DIVE_OUTCOMES } from '@rswim/contracts';
import { instructorDay, myStaffId } from '@rswim/domain-dive';
import { cn } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import {
  linePlanAction,
  logDiveAction,
  sessionStatusAction,
  skillAction,
  targetAction,
} from '../actions';
import { requireDivePage } from '../_ui/access';
import { LineDiagram } from '../_ui/charts';
import { dateShort, dayLabel, hhmm, localDay, mmss } from '../_ui/format';
import { di } from '../_ui/icons';
import { Avatar, Chip, Empty, Hero, Meter, Panel } from '../_ui/kit';
import { ReadinessChips, SeaCard, SessionRow } from '../_ui/widgets';

const small = 'min-h-8 px-2.5 text-xs';
const RED_FLAGS = new Set(['recent_incident', 'last_dive_issue']);

/**
 * The instructor's day in the water, made for a wet phone on the beach: the sea, each session's divers with how deep
 * each may go today and why, the lines and buddies, a fast dive log, and course skills to tick.
 */
export default async function WaterDay() {
  const { session } = await requireDivePage('instructor');
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const day = await withSession(async (tx) => instructorDay(tx, await myStaffId(tx)));
  const first = (session.displayName ?? '').split(' ')[0] ?? '';

  return (
    <div className="flex flex-col gap-5" data-testid="water-day">
      <Hero
        kicker={`${t('instructor.kicker')} · ${dayLabel(day.today, locale)}`}
        title={t('instructor.title', { name: first })}
        sub={
          day.staffId
            ? t('instructor.sub', { count: day.sessions.length })
            : t('instructor.allSessions')
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {day.sessions.length === 0 ? (
            <Panel>
              <Empty>{t('instructor.noSessions')}</Empty>
            </Panel>
          ) : null}
          {day.sessions.map((s) => {
            const isToday = localDay(s.startsAt) === day.today;
            const names = new Map(s.lineup.map((d) => [d.diverId, d.name.split(' ')[0] ?? d.name]));
            const saved = s.lineup.some((d) => d.lineLabel);
            const lines = saved
              ? [...new Set(s.lineup.map((d) => d.lineLabel).filter((l): l is string => !!l))]
                  .sort()
                  .map((line) => ({
                    line,
                    divers: s.lineup
                      .filter((d) => d.lineLabel === line)
                      .map((d) => ({
                        name: d.name.split(' ')[0] ?? d.name,
                        targetM: d.targetDepthM ?? d.allowedM,
                      })),
                  }))
              : s.suggested.map((l) => ({
                  line: l.line,
                  divers: l.divers.map((d) => ({
                    name: names.get(d.id) ?? '?',
                    targetM: d.targetM,
                  })),
                }));
            return (
              <Panel key={s.id} testId="water-session" flush>
                <div className="px-4">
                  <SessionRow s={s}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!isToday ? <Chip tone="info">{t('common.tomorrow')}</Chip> : null}
                      {s.status !== 'go' && s.status !== 'cancelled' ? (
                        <ActionButton
                          action={sessionStatusAction}
                          fields={{ sessionId: s.id, status: 'go' }}
                          className={small}
                        >
                          {t('instructor.go')}
                        </ActionButton>
                      ) : null}
                      {s.status !== 'hold' && s.status !== 'cancelled' && s.status !== 'done' ? (
                        <ActionButton
                          action={sessionStatusAction}
                          fields={{ sessionId: s.id, status: 'hold' }}
                          variant="secondary"
                          className={small}
                        >
                          {t('instructor.hold')}
                        </ActionButton>
                      ) : null}
                      {s.siteKind !== 'pool' && s.lineup.length > 0 ? (
                        <ActionButton
                          action={linePlanAction}
                          fields={{ sessionId: s.id }}
                          variant="secondary"
                          className={small}
                        >
                          {saved ? t('instructor.replan') : t('instructor.plan')}
                        </ActionButton>
                      ) : null}
                      <span className="ms-auto text-xs text-ink-muted">
                        {t('instructor.logged', { count: s.logged })}
                      </span>
                    </div>
                  </SessionRow>
                </div>
                {s.siteKind !== 'pool' && lines.length > 0 ? (
                  <div className="border-t border-line px-4 py-3">
                    <p className="mb-1 text-xs font-semibold text-ink-muted">
                      {saved ? t('instructor.linesSaved') : t('instructor.linesSuggested')}
                    </p>
                    <LineDiagram
                      lines={lines}
                      labels={{
                        line: (l) => t('instructor.line', { line: l }),
                        surface: t('common.surface'),
                      }}
                    />
                  </div>
                ) : null}
                {s.lineup.length === 0 ? (
                  <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">
                    {t('office.nobody')}
                  </p>
                ) : (
                  <ul className="divide-y divide-line border-t border-line">
                    {s.lineup.map((d) => (
                      <li
                        key={d.bookingId}
                        className={cn('px-4 py-3', d.status === 'no_show' && 'opacity-50')}
                        data-testid="lineup-diver"
                      >
                        <div className="flex flex-wrap items-start gap-3">
                          <Avatar name={d.name} size={36} />
                          <div className="min-w-[10rem] flex-1">
                            <a
                              href={`/dive/divers/${d.diverId}`}
                              className="font-medium hover:underline"
                            >
                              {d.name}
                            </a>
                            <p className="text-xs text-ink-muted">
                              {t(`level.${d.certLevel}`)}
                              {d.pbCwtM !== null ? ` · PB ${d.pbCwtM}m` : ''}
                              {d.pbStaSec !== null ? ` · STA ${mmss(d.pbStaSec)}` : ''}
                              {d.lineLabel
                                ? ` · ${t('instructor.line', { line: d.lineLabel })}`
                                : ''}
                              {d.buddyName
                                ? ` · ${t('instructor.buddy', { name: d.buddyName })}`
                                : ''}
                            </p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {d.flags.map((f) => (
                                <Chip
                                  key={f}
                                  tone={RED_FLAGS.has(f) ? 'nogo' : 'info'}
                                  icon={RED_FLAGS.has(f) ? undefined : false}
                                >
                                  {t(`flag.${f}`)}
                                </Chip>
                              ))}
                              <ReadinessChips
                                items={d.items.filter((i) => i.key !== 'payment')}
                                compact
                              />
                            </div>
                            {d.lastDive ? (
                              <p className="mt-1 text-[11px] text-ink-muted">
                                {t('instructor.lastDive', {
                                  date: dateShort(d.lastDive.on),
                                  depth: d.lastDive.depthM ?? '—',
                                  outcome: t(`outcome.${d.lastDive.outcome}`),
                                })}
                              </p>
                            ) : null}
                          </div>
                          {s.siteKind !== 'pool' ? (
                            <div
                              className="w-36 shrink-0 text-end"
                              title={t(`limitedBy.${d.limitedBy}`)}
                            >
                              <p className="text-[11px] text-ink-muted">
                                {t('instructor.allowed')}
                              </p>
                              <p className="text-xl font-bold tabular-nums">{d.allowedM}m</p>
                              <p className="text-[11px] text-ink-muted">
                                {t(`limitedBy.${d.limitedBy}`)}
                              </p>
                              <ActionForm
                                action={targetAction}
                                className="mt-1 flex-row items-end justify-end gap-1"
                              >
                                <input type="hidden" name="bookingId" value={d.bookingId} />
                                <input
                                  name="targetDepthM"
                                  type="number"
                                  min={1}
                                  max={d.allowedM}
                                  defaultValue={d.targetDepthM ?? ''}
                                  placeholder={t('instructor.target')}
                                  aria-label={t('instructor.target')}
                                  className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-sm"
                                />
                                <SubmitButton variant="secondary" className={small}>
                                  {t('instructor.set')}
                                </SubmitButton>
                              </ActionForm>
                            </div>
                          ) : null}
                        </div>
                        {d.status !== 'no_show' ? (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-sm font-medium text-[var(--dive-sea)]">
                              {t('instructor.log')}
                            </summary>
                            <ActionForm action={logDiveAction} resetOnSuccess className="mt-2">
                              <input type="hidden" name="diverId" value={d.diverId} />
                              <input type="hidden" name="sessionId" value={s.id} />
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                                <SelectField
                                  name="discipline"
                                  label={t('instructor.discipline')}
                                  defaultValue={s.siteKind === 'pool' ? 'DYN' : 'CWT'}
                                  options={DIVE_DISCIPLINES.map((x) => ({ value: x, label: x }))}
                                />
                                <Field
                                  name="depthM"
                                  label={t('instructor.depth')}
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  max={150}
                                />
                                <Field
                                  name="distanceM"
                                  label={t('instructor.distance')}
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  max={300}
                                />
                                <Field
                                  name="durationSec"
                                  label={t('instructor.seconds')}
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  max={900}
                                />
                                <SelectField
                                  name="outcome"
                                  label={t('instructor.outcome')}
                                  options={DIVE_OUTCOMES.map((x) => ({
                                    value: x,
                                    label: t(`outcome.${x}`),
                                  }))}
                                />
                              </div>
                              <Field name="notes" label={t('instructor.notes')} />
                              <p className="text-xs text-ink-muted">{t('instructor.logNote')}</p>
                              <div>
                                <SubmitButton>{t('instructor.saveLog')}</SubmitButton>
                              </div>
                            </ActionForm>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            );
          })}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <SeaCard sea={day.sea} compact />
          <Panel title={t('instructor.students')} icon={di.spark} testId="students">
            {day.students.length === 0 ? (
              <Empty>{t('instructor.noStudents')}</Empty>
            ) : (
              <ul className="flex min-w-0 flex-col gap-4">
                {day.students.map((st) => (
                  <li key={st.enrollmentId}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">{st.name}</p>
                      <span className="text-xs text-ink-muted tabular-nums">
                        {st.done.length}/{st.skills.length}
                      </span>
                    </div>
                    <p className="mb-1.5 text-xs text-ink-muted">{st.program}</p>
                    <Meter
                      value={st.done.length}
                      max={st.skills.length}
                      tone="go"
                      label={st.program}
                    />
                    <div className="mt-2 flex flex-wrap gap-1">
                      {st.skills.map((k) => {
                        const done = st.done.includes(k);
                        return (
                          <ActionButton
                            key={k}
                            action={skillAction}
                            fields={{ enrollmentId: st.enrollmentId, skill: k }}
                            variant={done ? 'primary' : 'secondary'}
                            className={cn(
                              'min-h-7 rounded-full px-2.5 text-xs',
                              done && 'bg-[var(--dive-go)] hover:bg-[var(--dive-go)]',
                            )}
                            aria-pressed={done}
                          >
                            {done ? '✓ ' : ''}
                            {t(`skill.${k}`)}
                          </ActionButton>
                        );
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('instructor.recent')} icon={di.wave} flush>
            {day.recentLogs.length === 0 ? (
              <Empty>{t('instructor.noLogs')}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {day.recentLogs.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {hhmm(l.at)} · {l.discipline}
                      </span>
                    </span>
                    <span className="text-end">
                      <span className="block font-semibold tabular-nums">
                        {l.depthM !== null
                          ? `${l.depthM}m`
                          : l.distanceM !== null
                            ? `${l.distanceM}m`
                            : l.durationSec !== null
                              ? mmss(l.durationSec)
                              : '—'}
                      </span>
                      <Chip
                        tone={
                          l.outcome === 'clean'
                            ? 'go'
                            : l.outcome === 'early_turn' || l.outcome === 'ear'
                              ? 'caution'
                              : 'nogo'
                        }
                      >
                        {t(`outcome.${l.outcome}`)}
                      </Chip>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
