import { getTranslations } from 'next-intl/server';
import type { DiverHome } from '@rswim/domain-dive';
import { DepthProfile } from './charts';
import { dateShort, mmss } from './format';
import { di } from './icons';
import { Avatar, Chip, Empty, Meter, Panel } from './kit';

/** A diver's story, shared by their own page and the staff file: who they are, how deep, what they learned. */

export async function DiverBanner({
  home,
  greeting,
  children,
}: {
  home: DiverHome;
  greeting?: string;
  children?: React.ReactNode;
}) {
  const t = await getTranslations('dive');
  const d = home.diver;
  const name = `${d.firstName} ${d.lastName}`;
  const ring = Math.min(1, (d.pbCwtM ?? 0) / Math.max(home.allowed.maxM, 1));
  return (
    <section
      className="bg-ocean relative overflow-hidden rounded-3xl p-5 text-white md:p-6"
      data-testid="diver-banner"
    >
      <div className="flex flex-wrap items-center gap-5">
        <div className="relative size-28 shrink-0" title={t('diver.pbOfAllowed')}>
          <svg viewBox="0 0 100 100" className="size-28 -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="white"
              strokeOpacity="0.15"
              strokeWidth="8"
            />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              stroke="var(--dive-shallow)"
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${ring * 276.5} 276.5`}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold tabular-nums">{d.pbCwtM ?? '—'}</span>
            <span className="text-[10px] tracking-wider text-white/70 uppercase">
              {t('diver.pbCwt')}
            </span>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          {greeting ? <p className="text-sm text-white/75">{greeting}</p> : null}
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight md:text-3xl">
            {!greeting ? <Avatar name={name} size={36} /> : null}
            {name}
          </h1>
          <p className="mt-1 text-sm text-white/80">
            {t(`level.${d.certLevel}`)}
            {d.certName ? ` · ${d.certName}` : ''}
            {d.city ? ` · ${d.city}` : ''}
          </p>
          <p
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1 text-sm backdrop-blur-sm"
            data-testid="allowed-depth"
          >
            <span className="[&_svg]:size-4">{di.arrow}</span>
            {t('diver.allowedToday', {
              m: home.allowed.maxM,
              why: t(`limitedBy.${home.allowed.limitedBy}`),
            })}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
          {[
            { k: t('diver.stat.dives'), v: home.stats.dives },
            {
              k: t('diver.stat.deepest'),
              v: home.stats.deepest !== null ? `${home.stats.deepest}m` : '—',
            },
            { k: 'STA', v: d.pbStaSec !== null ? mmss(d.pbStaSec) : '—' },
            { k: 'DYN', v: d.pbDynM !== null ? `${d.pbDynM}m` : '—' },
          ].map((s) => (
            <div key={s.k} className="min-w-[4.5rem] rounded-xl bg-white/10 px-3 py-2">
              <dt className="text-[11px] text-white/65">{s.k}</dt>
              <dd className="text-lg font-bold tabular-nums">{s.v}</dd>
            </div>
          ))}
        </dl>
      </div>
      {children}
    </section>
  );
}

export async function DepthPanel({ home }: { home: DiverHome }) {
  const t = await getTranslations('dive');
  const pts = home.depthHistory.slice(-24).map((p) => ({
    on: p.on,
    depthM: p.depthM,
    label: `${dateShort(p.on)} · ${p.depthM}m`,
  }));
  return (
    <Panel title={t('diver.depthTitle')} icon={di.arrow} testId="depth-chart">
      {pts.length === 0 ? (
        <Empty>{t('diver.noDepth')}</Empty>
      ) : (
        <DepthProfile
          points={pts}
          pb={home.diver.pbCwtM}
          allowed={home.allowed.maxM}
          labels={{
            pb: t('diver.pbLine', { m: home.diver.pbCwtM ?? 0 }),
            allowed: t('diver.allowedLine', { m: home.allowed.maxM }),
            surface: t('common.surface'),
          }}
        />
      )}
    </Panel>
  );
}

export async function CoursesPanel({ home }: { home: DiverHome }) {
  const t = await getTranslations('dive');
  return (
    <Panel title={t('diver.courses')} icon={di.spark} testId="courses">
      {home.enrollments.length === 0 ? (
        <Empty>{t('diver.noCourses')}</Empty>
      ) : (
        <ol className="relative flex flex-col gap-4 border-s-2 border-line ps-5">
          {home.enrollments.map((e) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -start-[1.69rem] top-1 size-3 rounded-full ring-4 ring-[var(--surface-raised)]"
                style={{
                  background: e.status === 'completed' ? 'var(--dive-go)' : 'var(--dive-sea)',
                }}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{e.program}</p>
                {e.status === 'completed' ? (
                  <Chip tone="go">
                    {t('diver.certified', { date: e.completedOn ? dateShort(e.completedOn) : '' })}
                  </Chip>
                ) : (
                  <Chip tone="info" icon={false}>
                    {t(`enrollmentStatus.${e.status}`)}
                  </Chip>
                )}
              </div>
              {e.certNumber ? <p className="text-xs text-ink-muted">#{e.certNumber}</p> : null}
              {e.status === 'active' ? (
                <div className="mt-2">
                  <Meter value={e.done.length} max={e.skills.length} tone="go" label={e.program} />
                  <ul className="mt-2 flex flex-wrap gap-1">
                    {e.skills.map((k) => (
                      <li key={k}>
                        <Chip
                          tone={e.done.includes(k) ? 'go' : 'muted'}
                          icon={e.done.includes(k) ? undefined : false}
                        >
                          {t(`skill.${k}`)}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

export async function LogbookPanel({ home }: { home: DiverHome }) {
  const t = await getTranslations('dive');
  return (
    <Panel title={t('diver.logbook')} icon={di.wave} flush testId="logbook">
      {home.logbook.length === 0 ? (
        <Empty>{t('diver.noLogs')}</Empty>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-2 text-start font-medium">{t('diver.log.date')}</th>
              <th className="py-2 text-start font-medium">{t('diver.log.discipline')}</th>
              <th className="py-2 text-end font-medium">{t('diver.log.result')}</th>
              <th className="px-4 py-2 text-end font-medium">{t('diver.log.outcome')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {home.logbook.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-2 tabular-nums">
                  {dateShort(l.on)}
                  {l.site ? <span className="block text-xs text-ink-muted">{l.site}</span> : null}
                </td>
                <td className="py-2" lang="en">
                  {l.discipline}
                </td>
                <td className="py-2 text-end font-semibold tabular-nums">
                  {l.depthM !== null
                    ? `${l.depthM}m`
                    : l.distanceM !== null
                      ? `${l.distanceM}m`
                      : l.durationSec !== null
                        ? mmss(l.durationSec)
                        : '—'}
                </td>
                <td className="px-4 py-2 text-end">
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
