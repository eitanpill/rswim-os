import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { contractMonthReport } from '@rswim/domain-institutions';
import { PrintButton } from '@/components/print-button';
import { periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';

const MARK = { present: '✓', late: '◐', absent: '✗' } as const;

/**
 * An institution's monthly attendance report (brief §6.11): each child on the roster against each lesson of the
 * month, with cancelled lessons marked. Printed or saved as PDF from the browser, to send with the invoice.
 */
export default async function AttendanceReportPage({
  params,
}: {
  params: Promise<{ contractId: string; period: string }>;
}) {
  const { contractId, period } = await params;
  if (!/^\d{4}-\d{2}$/.test(period)) notFound();
  const t = await getTranslations('institutions.report');
  const r = await withSession((tx) => contractMonthReport(tx, contractId, period));
  if (!r) notFound();
  const mark = (sessionId: string, studentId: string) => {
    const m = r.marks.find((x) => x.sessionId === sessionId && x.studentId === studentId);
    return m ? (MARK[m.status as keyof typeof MARK] ?? '') : '';
  };

  return (
    <article className="bg-surface p-4 text-ink print:p-0" data-testid="report">
      <header className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">
            {t('title', { institution: r.contract.institutionName, month: periodLabel(period) })}
          </h1>
          <p className="text-sm text-ink-muted">{r.contract.name}</p>
        </div>
        <PrintButton label={t('print')} />
      </header>
      {r.lessons.length === 0 ? (
        <p>{t('empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="py-1 pe-3 text-start">{t('child')}</th>
                {r.lessons.map((l) => (
                  <th key={l.id} className="px-1 py-1 text-center font-normal" dir="ltr">
                    {dmy(l.date).slice(0, -5)}
                    {l.status.startsWith('cancelled') ? (
                      <span className="block">{t('cancelled')}</span>
                    ) : null}
                  </th>
                ))}
                <th className="px-1 py-1">{t('present')}</th>
              </tr>
            </thead>
            <tbody>
              {r.roster.map((c) => (
                <tr key={c.studentId} className="border-b border-line" data-testid="report-row">
                  <td className="py-1 pe-3">{c.name}</td>
                  {r.lessons.map((l) => (
                    <td key={l.id} className="px-1 py-1 text-center">
                      {mark(l.id, c.studentId)}
                    </td>
                  ))}
                  <td className="px-1 py-1 text-center">
                    {
                      r.marks.filter((m) => m.studentId === c.studentId && m.status !== 'absent')
                        .length
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-ink-muted">
        {t('legend', { children: r.roster.length, lessons: r.lessons.length })}
      </p>
    </article>
  );
}
