import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { diverFile } from '@rswim/domain-dive';
import { withSession } from '@/lib/db';
import { requireDivePage } from '../../_ui/access';
import { CoursesPanel, DepthPanel, DiverBanner, LogbookPanel } from '../../_ui/diver';
import { dateShort, shekels } from '../../_ui/format';
import { di } from '../../_ui/icons';
import { Chip, Empty, Panel } from '../../_ui/kit';
import { ReadinessChips } from '../../_ui/widgets';

/** A diver's whole story for the staff: profile, paperwork, depth progress, courses, money, gear and safety. */
export default async function DiverFilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireDivePage('divers');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const t = await getTranslations('dive');
  const locale = await getLocale();
  const f = await withSession((tx) => diverFile(tx, id));
  if (!f) notFound();
  const d = f.diver;
  return (
    <div className="flex flex-col gap-5" data-testid="diver-file">
      <a href="/dive/divers" className="text-sm text-[var(--dive-sea)] hover:underline">
        {t('file.back')}
      </a>
      <DiverBanner home={f}>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/15 pt-3 text-sm">
          <span className="rounded-full bg-white/95 p-0.5">
            <ReadinessChips items={f.readinessItems} />
          </span>
          {d.tags.map((x) => (
            <span key={x} className="rounded-full bg-white/12 px-2 py-0.5 text-xs">
              {t(`flag.${x}`)}
            </span>
          ))}
        </div>
      </DiverBanner>

      <div className="grid gap-4 md:grid-cols-3">
        <Panel title={t('file.contact')} icon={di.phone}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-ink-muted">{t('file.phone')}</dt>
            <dd dir="ltr" className="text-end">
              {d.phone ?? '—'}
            </dd>
            <dt className="text-ink-muted">{t('file.email')}</dt>
            <dd dir="ltr" className="truncate text-end">
              {d.email ?? '—'}
            </dd>
            <dt className="text-ink-muted">{t('file.origin')}</dt>
            <dd className="text-end">
              {t(`origin.${d.origin}`)}
              {d.country ? ` · ${d.country}` : ''}
            </dd>
            <dt className="text-ink-muted">{t('file.emergency')}</dt>
            <dd className="text-end">
              {d.emergencyName ? `${d.emergencyName} ` : '—'}
              <span dir="ltr">{d.emergencyPhone ?? ''}</span>
            </dd>
            <dt className="text-ink-muted">{t('file.source')}</dt>
            <dd className="text-end">{d.source ? t(`leadSource.${d.source}`) : '—'}</dd>
            <dt className="text-ink-muted">{t('file.joined')}</dt>
            <dd className="text-end tabular-nums">{dateShort(d.joinedOn)}</dd>
          </dl>
          {d.notes ? (
            <p className="mt-3 rounded-lg bg-[color-mix(in_oklch,var(--ink)_4%,transparent)] p-2 text-sm">
              {d.notes}
            </p>
          ) : null}
        </Panel>
        <Panel title={t('file.money')} icon={di.coin} flush>
          <div className="px-4 pb-2">
            <p className="text-xs text-ink-muted">{t('file.lifetime')}</p>
            <p className="text-2xl font-bold tabular-nums">{shekels(f.lifetimeValue, locale)}</p>
          </div>
          {f.sales.length === 0 ? (
            <Empty>{t('file.noSales')}</Empty>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto border-t border-line">
              {f.sales.slice(0, 12).map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{s.description}</span>
                    <span className="block text-xs text-ink-muted">
                      {dateShort(s.soldAt)} · {t(`payMethod.${s.method}`)}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{shekels(s.amount, locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title={t('file.safety')} icon={di.shield} flush>
          {f.incidents.length === 0 ? (
            <Empty>{t('file.cleanRecord')}</Empty>
          ) : (
            <ul className="divide-y divide-line">
              {f.incidents.map((i) => (
                <li key={i.id} className="px-4 py-2 text-sm">
                  <Chip tone={i.severity === 'high' ? 'nogo' : 'caution'}>
                    {t(`incidentKind.${i.kind}`)}
                  </Chip>
                  <span className="ms-2 text-xs text-ink-muted">{dateShort(i.occurredAt)}</span>
                  <p className="mt-1">{i.description}</p>
                </li>
              ))}
            </ul>
          )}
          {f.rentals.length > 0 ? (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-1 text-xs font-semibold text-ink-muted">{t('file.rentals')}</p>
              <div className="flex flex-wrap gap-1">
                {f.rentals.map((r) => (
                  <Chip key={r.id} tone={r.returnedAt ? 'muted' : 'caution'} icon={false}>
                    {t(`gearKind.${r.kind}`)} {r.code}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DepthPanel home={f} />
        <CoursesPanel home={f} />
      </div>
      <LogbookPanel home={f} />
    </div>
  );
}
