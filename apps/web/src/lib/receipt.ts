import 'server-only';
import { getLocale, getTranslations } from 'next-intl/server';
import { fiscalDocument } from '@rswim/domain-billing';
import type { Tx } from '@rswim/db';
import { money, periodLabel } from './billing';
import { dmy } from './options';

export interface ReceiptView {
  id: string;
  title: string;
  provider: string;
  pdfUrl: string | null;
  date: string;
  period: string;
  client: { name: string; nationalId?: string };
  lines: { description: string; quantity: number; amount: string }[];
  method: string;
  notes: string;
  total: string;
}

interface StoredRequest {
  client?: { name?: string; nationalId?: string };
  lines?: { description: string; quantity: number; amount: number }[];
  paymentMethod?: string;
  notes?: string;
}

/** An issued invoice-receipt as the family reads it, from exactly what was sent to the invoicing provider. */
export async function receiptView(tx: Tx, id: string): Promise<ReceiptView | null> {
  const doc = await fiscalDocument(tx, id);
  if (!doc || doc.status !== 'issued') return null;
  const t = await getTranslations();
  const fmt = await money();
  const req = doc.request as StoredRequest;
  const issued = doc.issuedAt ?? doc.createdAt;
  return {
    id: doc.id,
    title: t('parent.receipt.title', {
      kind: t(`enums.fiscalDocumentKind.${doc.kind}`),
      number: doc.number ?? '',
    }),
    provider: doc.provider,
    pdfUrl: doc.pdfUrl,
    date: dmy(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(issued)),
    period: periodLabel(doc.period),
    client: { name: req.client?.name ?? '', nationalId: req.client?.nationalId },
    lines: (req.lines ?? []).map((l) => ({
      description: l.description,
      quantity: l.quantity,
      amount: fmt(l.amount),
    })),
    method: req.paymentMethod ?? '',
    notes: req.notes ?? '',
    total: fmt(doc.totalAgorot),
  };
}

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );

/** A self-contained, printable copy of the receipt (the download when the provider has no real PDF). */
export async function receiptHtml(r: ReceiptView, school: string): Promise<string> {
  const t = await getTranslations('parent.receipt');
  const locale = await getLocale();
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const rows = r.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.description)}</td><td>${l.quantity}</td><td class="n">${esc(l.amount)}</td></tr>`,
    )
    .join('');
  return `<!doctype html>
<html lang="${locale}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title)}</title>
<style>
body{font-family:Heebo,Arial,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}
h1{font-size:22px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:16px 0}
td,th{border-bottom:1px solid #ddd;padding:8px;text-align:start}td.n,th.n{text-align:end}
.muted{color:#555;font-size:14px}.total{font-size:18px;font-weight:700}
</style></head><body>
<p class="muted">${esc(school)}</p>
<h1>${esc(r.title)}</h1>
<p>${esc(t('date'))}: ${esc(r.date)}${r.period ? ` · ${esc(r.period)}` : ''}</p>
<p>${esc(t('client'))}: ${esc(r.client.name)}${r.client.nationalId ? ` · ${esc(r.client.nationalId)}` : ''}</p>
<table><thead><tr><th>${esc(t('item'))}</th><th></th><th class="n">${esc(t('amount'))}</th></tr></thead><tbody>${rows}</tbody></table>
<p>${esc(t('method'))}: ${esc(r.method)}</p>
${r.notes ? `<p>${esc(t('notes'))}: ${esc(r.notes)}</p>` : ''}
<p class="total">${esc(t('total'))}: ${esc(r.total)}</p>
<p class="muted">${esc(t('copy'))}</p>
</body></html>`;
}
