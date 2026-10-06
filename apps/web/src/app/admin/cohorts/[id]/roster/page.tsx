import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getCohort } from '@rswim/domain-scheduling';
import { PrintButton } from '@/components/print-button';
import { withSession } from '@/lib/db';
import { dmy } from '@/lib/options';

/**
 * A cohort's roster to print or save as PDF from the browser (brief §6.11 "roster PDFs"): the children with their
 * parents' phones and flags, the groups with their lesson dates, and the staff.
 */
export default async function CohortRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('cohorts.print');
  const tw = await getTranslations('common.weekday');
  const c = await withSession((tx) => getCohort(tx, id));
  if (!c) notFound();

  return (
    <article className="mx-auto max-w-3xl bg-surface p-4 text-ink print:p-0" data-testid="roster">
      <header className="mb-4 flex items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">{c.name}</h1>
          <p className="text-sm text-ink-muted">
            {t('dates', { program: c.programName, from: dmy(c.startsOn), to: dmy(c.endsOn) })}
          </p>
        </div>
        <PrintButton label={t('print')} />
      </header>
      <section className="mb-4">
        <h2 className="font-semibold">{t('groups')}</h2>
        <ul className="text-sm">
          {c.groups.map((g) => (
            <li key={g.id}>
              {t('group', {
                name: g.name,
                day: tw(String(g.weekday)),
                time: g.time,
                venue: g.venueName,
                lead: g.leadName ?? '—',
              })}
              <span className="block text-ink-muted" dir="ltr">
                {g.lessonDates.map((d) => dmy(d)).join(' · ')}
              </span>
            </li>
          ))}
        </ul>
        {c.staff.length > 0 ? (
          <p className="mt-1 text-sm">
            {t('staff', { names: c.staff.map((s) => s.name).join(', ') })}
          </p>
        ) : null}
      </section>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-start">
            <th className="py-1 text-start">#</th>
            <th className="py-1 text-start">{t('child')}</th>
            <th className="py-1 text-start">{t('born')}</th>
            <th className="py-1 text-start">{t('parents')}</th>
            <th className="py-1 text-start">{t('notes')}</th>
          </tr>
        </thead>
        <tbody>
          {c.roster.map((r, i) => (
            <tr
              key={r.studentId}
              className="border-b border-line align-top"
              data-testid="roster-row"
            >
              <td className="py-1">{i + 1}</td>
              <td className="py-1 font-medium">{r.name}</td>
              <td className="py-1" dir="ltr">
                {dmy(r.dob)}
              </td>
              <td className="py-1">
                {r.guardians.map((g) => (
                  <span key={`${g.name}${g.phone}`} className="block">
                    {g.name} <span dir="ltr">{g.phone ?? ''}</span>
                  </span>
                ))}
              </td>
              <td className="py-1">
                {[r.waterFear && t('waterFear'), r.hasMedicalNotes && t('medical')]
                  .filter(Boolean)
                  .join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-muted">{t('count', { n: c.roster.length })}</p>
    </article>
  );
}
