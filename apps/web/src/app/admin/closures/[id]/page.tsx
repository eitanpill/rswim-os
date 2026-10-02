import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { ClosureSource } from '@rswim/contracts';
import { closureReport, previewClosure } from '@rswim/domain-attendance';
import { DomainError } from '@rswim/domain-core';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, PageHeader } from '@rswim/ui';
import { ActionButton } from '@/components/form';
import { sessionWhen } from '@/lib/attendance';
import { withSession } from '@/lib/db';
import { dmy, enumLabel } from '@/lib/options';
import { issueText } from '@/lib/scheduling';
import { closeClosureAction, discardClosureAction, openClosureAction } from '../actions';

const COLUMNS = [
  'issued',
  'booked',
  'used',
  'missed',
  'expired',
  'converted',
  'outstanding',
] as const;

/** A closure: the preview while it is a draft, then the uptake report while makeups run and after it closes. */
export default async function ClosurePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ opened?: string }>;
}) {
  const { id } = await params;
  const { opened } = await searchParams;
  const data = await withSession(async (tx) => {
    try {
      const report = await closureReport(tx, id);
      const e = report.event;
      const preview =
        e.status === 'draft'
          ? await previewClosure(tx, {
              venueId: e.venueId,
              startsOn: e.startsOn,
              endsOn: e.endsOn,
              source: e.source as ClosureSource,
            })
          : null;
      return { ...report, preview, venues: await listVenues(tx) };
    } catch (err) {
      if (err instanceof DomainError) return null;
      throw err;
    }
  });
  if (!data) notFound();
  const { event, report, preview, sessionsCancelled } = data;
  const t = await getTranslations('attendance.closures');
  const label = await enumLabel();
  const why = await issueText();
  const venue = event.venueId
    ? (data.venues.find((v) => v.id === event.venueId)?.name ?? '')
    : t('allVenues');

  return (
    <>
      <PageHeader
        title={`${venue} · ${event.reason}`}
        subtitle={`${dmy(event.startsOn)}–${dmy(event.endsOn)} · ${label('closureSource', event.source)}`}
      />
      <div className="flex flex-col gap-4">
        <Link href="/admin/closures" className="text-brand-700">
          {t('back')}
        </Link>
        {opened !== undefined ? (
          <p role="status" className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            {t('opened', { sessions: sessionsCancelled, credits: Number(opened) })}
          </p>
        ) : null}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('terms')}</CardTitle>
            <Badge
              tone={event.status === 'open' ? 'warn' : event.status === 'closed' ? 'ok' : 'neutral'}
            >
              {label('closureEventStatus', event.status)}
            </Badge>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-muted">{t('makeupWindow')}</dt>
              <dd>
                {dmy(event.makeupFrom)}–{dmy(event.makeupDeadline)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t('guarantee')}</dt>
              <dd>{label('makeupGuarantee', event.guarantee)}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">{t('endRule')}</dt>
              <dd>{label('closureEndRule', event.endRule)}</dd>
            </div>
            {preview ? (
              <div>
                <dt className="text-ink-muted">{t('rule')}</dt>
                <dd>{why(preview.treatment.explanation)}</dd>
              </div>
            ) : null}
          </dl>
        </Card>

        {preview ? (
          <>
            <Card data-testid="closure-preview">
              <CardTitle>{t('previewTitle')}</CardTitle>
              <p className="mb-3 font-medium" data-testid="preview-totals">
                {t('totals', {
                  sessions: preview.totals.sessions,
                  children: preview.totals.children,
                  credits: preview.totals.credits,
                  guests: preview.totals.guests,
                })}
              </p>
              <ul className="flex flex-col gap-2">
                {preview.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="rounded-xl border border-line p-3"
                    data-testid="preview-session"
                  >
                    <p className="font-medium">
                      {s.groupName} <span className="text-sm text-ink-muted">{sessionWhen(s)}</span>
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-1">
                      {s.children.map((c) => (
                        <li key={c.studentId}>
                          <Badge tone={c.getsCredit ? 'ok' : 'warn'} title={why(c.why)}>
                            {c.name}
                            {c.getsCredit ? '' : ` · ${why(c.why)}`}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                    {s.guests ? (
                      <p className="mt-1 text-sm text-ink-muted">{t('guests', { n: s.guests })}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
            <div className="flex flex-wrap gap-2">
              <ActionButton action={openClosureAction} fields={{ id }} confirm={t('openConfirm')}>
                {t('open')}
              </ActionButton>
              <ActionButton action={discardClosureAction} fields={{ id }} variant="ghost">
                {t('discard')}
              </ActionButton>
            </div>
          </>
        ) : (
          <>
            <Card data-testid="uptake-report">
              <CardTitle>{t('report')}</CardTitle>
              <p className="mb-2 text-sm text-ink-muted">
                {t('sessionsCancelled', { n: sessionsCancelled })}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-start text-ink-muted">
                      <th className="p-2 text-start">{t('group')}</th>
                      {COLUMNS.map((c) => (
                        <th key={c} className="p-2 text-start">
                          {t(`col.${c}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...report.rows, { ...report.total, groupName: t('total') }].map((r) => (
                      <tr
                        key={r.groupId || 'total'}
                        className="border-t border-line"
                        data-testid="uptake-row"
                      >
                        <td className="p-2 font-medium">{r.groupName}</td>
                        {COLUMNS.map((c) => (
                          <td key={c} className="p-2">
                            {r[c]}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            {event.status === 'open' ? (
              <div>
                <ActionButton
                  action={closeClosureAction}
                  fields={{ id }}
                  variant="secondary"
                  confirm={t('closeConfirm')}
                >
                  {t('close')}
                </ActionButton>
              </div>
            ) : null}
          </>
        )}
      </div>
    </>
  );
}
