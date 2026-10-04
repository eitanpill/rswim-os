/**
 * The accountant's export (brief §6.8): one XLSX per approved month. Sheet one is the payslip part per instructor
 * (every line, the total, pension status with the retro flag, the sick-leave balance); sheet two is the transfers to
 * pay against invoices. Column titles and words come from the caller (i18n), so the file follows the reader's language.
 */
import ExcelJS from 'exceljs';
import type { Tx } from '@rswim/db';
import { getPayrollRun, sickBalances } from './runs';

export interface ExportLabels {
  payslipSheet: string;
  transferSheet: string;
  columns: {
    staff: string;
    employment: string;
    date: string;
    item: string;
    quantity: string;
    amount: string;
    total: string;
    pension: string;
    sick: string;
  };
  /** Words for a line's kind, unit, employment type and pension status, already translated. */
  line: (l: { kind: string; workKind: string | null; description: string; unit: string }) => string;
  employment: (type: string) => string;
  pension: (p: {
    eligible: boolean;
    newlyEligible: boolean;
    retroFrom: string | null;
    continuousMonths: number;
  }) => string;
  sickDays: (halfDays: number) => string;
}

const shekels = (agorot: number) => Math.round(agorot) / 100;

/** Builds the workbook for a run; returns null when the run does not exist. */
export async function payrollWorkbook(
  tx: Tx,
  runId: string,
  labels: ExportLabels,
): Promise<{ period: string; buffer: Buffer } | null> {
  const data = await getPayrollRun(tx, runId);
  if (!data) return null;
  const sick = await sickBalances(tx);
  const book = new ExcelJS.Workbook();
  book.creator = 'R-SWIM OS';
  const money = '#,##0.00 ₪';

  const payslip = book.addWorksheet(labels.payslipSheet, { views: [{ rightToLeft: true }] });
  payslip.columns = [
    { header: labels.columns.staff, key: 'staff', width: 22 },
    { header: labels.columns.employment, key: 'employment', width: 16 },
    { header: labels.columns.date, key: 'date', width: 12 },
    { header: labels.columns.item, key: 'item', width: 36 },
    { header: labels.columns.quantity, key: 'quantity', width: 10 },
    { header: labels.columns.amount, key: 'amount', width: 14, style: { numFmt: money } },
    { header: labels.columns.pension, key: 'pension', width: 30 },
    { header: labels.columns.sick, key: 'sick', width: 14 },
  ];
  const transfer = book.addWorksheet(labels.transferSheet, { views: [{ rightToLeft: true }] });
  transfer.columns = [
    { header: labels.columns.staff, key: 'staff', width: 22 },
    { header: labels.columns.date, key: 'date', width: 12 },
    { header: labels.columns.item, key: 'item', width: 36 },
    { header: labels.columns.quantity, key: 'quantity', width: 10 },
    { header: labels.columns.amount, key: 'amount', width: 14, style: { numFmt: money } },
  ];
  for (const sheet of [payslip, transfer]) sheet.getRow(1).font = { bold: true };

  for (const s of data.staff) {
    const own = s.lines.filter((l) => l.routing === 'payslip');
    if (own.length > 0) {
      for (const l of own) {
        payslip.addRow({
          staff: s.name,
          employment: labels.employment(s.employmentType),
          date: l.date ?? '',
          item: labels.line(l),
          quantity: Number(l.quantity),
          amount: shekels(l.amountAgorot),
        });
      }
      const total = payslip.addRow({
        staff: s.name,
        item: labels.columns.total,
        amount: shekels(s.payslip),
        pension: labels.pension(s.pension),
        sick: labels.sickDays(sick.get(s.id) ?? 0),
      });
      total.font = { bold: true };
    }
    const paid = s.lines.filter((l) => l.routing === 'transfer');
    if (paid.length > 0) {
      for (const l of paid) {
        transfer.addRow({
          staff: s.name,
          date: l.date ?? '',
          item: labels.line(l),
          quantity: Number(l.quantity),
          amount: shekels(l.amountAgorot),
        });
      }
      const total = transfer.addRow({
        staff: s.name,
        item: labels.columns.total,
        amount: shekels(s.transfer),
      });
      total.font = { bold: true };
    }
  }
  const buffer = Buffer.from(await book.xlsx.writeBuffer());
  return { period: data.run.period, buffer };
}
