import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import { payrollWorkbook, type ExportLabels } from '@rswim/domain-payroll';
import { periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { daysOf } from '@/lib/staffops';

/**
 * The accountant's XLSX for one payroll month (brief §6.8). Runs as the signed-in user: the database lets the owner,
 * an admin with payroll access and the accountant read a run; anyone else gets 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const t = await getTranslations('staffops.export');
  const tp = await getTranslations('staffops.payroll');
  const te = await getTranslations('enums');
  const labels: ExportLabels = {
    payslipSheet: t('payslipSheet'),
    transferSheet: t('transferSheet'),
    columns: {
      staff: t('staff'),
      employment: t('employment'),
      date: t('date'),
      item: t('item'),
      quantity: t('quantity'),
      amount: t('amount'),
      total: t('total'),
      pension: t('pension'),
      sick: t('sick'),
    },
    line: (l) =>
      l.kind === 'travel' ? tp('travel') : l.description || te(`payrollLineKind.${l.kind}`),
    employment: (type) => te(`employmentType.${type}`),
    pension: (p) =>
      p.newlyEligible
        ? t('pensionNew', { from: periodLabel(p.retroFrom) })
        : p.eligible
          ? t('pensionYes')
          : t('pensionNo', { months: p.continuousMonths }),
    sickDays: (halfDays) => t('sickDays', { days: daysOf(halfDays) }),
  };
  const book = await withSession((tx) => payrollWorkbook(tx, id.data, labels));
  if (!book) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(book.buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="payroll-${book.period}.xlsx"`,
      'cache-control': 'private, no-store',
    },
  });
}
