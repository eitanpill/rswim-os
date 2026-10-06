import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { INSTITUTION_PAYMENT_METHODS } from '@rswim/contracts';
import {
  listContracts,
  listInstitutionInvoices,
  listInstitutions,
} from '@rswim/domain-institutions';
import { listGroups } from '@rswim/domain-scheduling';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { explainer, money, periodLabel } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import {
  attachContractGroupAction,
  cancelInvoiceAction,
  createContractAction,
  detachContractGroupAction,
  draftInvoiceAction,
  issueInvoiceAction,
  recordPaymentAction,
  updateContractAction,
  updateInstitutionAction,
} from '../actions';
import { ContractFields, InstitutionFields } from '../fields';

const STATE_TONE = {
  draft: 'neutral',
  issuing: 'neutral',
  open: 'warn',
  partial: 'warn',
  overdue: 'danger',
  paid: 'ok',
  cancelled: 'neutral',
} as const;

/** One institution: its contracts and groups, the month's invoice from the roster, and payments against invoices. */
export default async function InstitutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('institutions');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const explain = await explainer();
  const fmt = await money();
  const data = await withSession(async (tx) => {
    const inst = (await listInstitutions(tx)).find((i) => i.id === id);
    if (!inst) return null;
    return {
      inst,
      contracts: await listContracts(tx, { institutionId: id }),
      invoices: await listInstitutionInvoices(tx, { institutionId: id }),
      groups: await listGroups(tx),
    };
  });
  if (!data) notFound();
  const { inst, contracts, invoices } = data;
  const thisMonth = todayIL().slice(0, 7);
  const methods = await enumOptions('institutionPaymentMethod', INSTITUTION_PAYMENT_METHODS);
  const hidden = <input type="hidden" name="institutionId" value={inst.id} />;

  return (
    <>
      <PageHeader title={inst.name} subtitle={label('institutionKind', inst.kind)} />
      <div className="flex flex-col gap-4">
        {contracts.map((c) => (
          <Card key={c.id} data-testid="contract">
            <CardTitle>{c.name}</CardTitle>
            <p className="text-sm text-ink-muted">
              {t('contract.line', {
                from: dmy(c.startsOn),
                to: dmy(c.endsOn),
                pricing: label('contractPricing', c.pricing),
                amount: fmt(c.amountAgorot),
                days: c.paymentTermsDays,
              })}
            </p>
            <h3 className="mt-3 text-sm font-semibold">{t('contract.groups')}</h3>
            {c.groups.length === 0 ? (
              <p className="text-sm text-ink-muted">{t('contract.noGroups')}</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {c.groups.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-2">
                    <span>
                      {g.name} · {tw(String(g.weekday))} {g.time} · {g.venueName}
                    </span>
                    <ActionButton
                      action={detachContractGroupAction}
                      fields={{ contractId: c.id, classTemplateId: g.id, institutionId: inst.id }}
                      variant="ghost"
                    >
                      {t('contract.detach')}
                    </ActionButton>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={attachContractGroupAction} className="mt-2" testId="contract-group">
              {hidden}
              <input type="hidden" name="contractId" value={c.id} />
              <SelectField
                name="classTemplateId"
                label={t('contract.attach')}
                options={data.groups
                  .filter((g) => !c.groups.some((x) => x.id === g.id))
                  .map((g) => ({ value: g.id, label: g.name }))}
              />
              <div>
                <SubmitButton variant="secondary">{t('contract.attachButton')}</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={draftInvoiceAction} className="mt-3" testId="draft-invoice">
              {hidden}
              <input type="hidden" name="contractId" value={c.id} />
              <Field
                name="period"
                type="month"
                dir="ltr"
                label={t('invoices.period')}
                defaultValue={thisMonth}
              />
              <div className="flex flex-wrap gap-2">
                <SubmitButton>{t('invoices.draft')}</SubmitButton>
                <Link
                  href={`/admin/institutions/report/${c.id}/${thisMonth}`}
                  className="min-h-tap inline-flex items-center px-2 text-sm text-brand-700 underline"
                  data-testid="attendance-report"
                >
                  {t('invoices.report')}
                </Link>
              </div>
            </ActionForm>
            <details className="mt-2">
              <summary className="min-h-tap cursor-pointer py-3 text-sm text-brand-700">
                {t('contract.edit')}
              </summary>
              <ActionForm action={updateContractAction}>
                {hidden}
                <input type="hidden" name="id" value={c.id} />
                <ContractFields c={c} />
                <div>
                  <SubmitButton variant="secondary">{t('contract.save')}</SubmitButton>
                </div>
              </ActionForm>
            </details>
          </Card>
        ))}

        <Card>
          <CardTitle>{t('invoices.title')}</CardTitle>
          {invoices.length === 0 ? (
            <EmptyState title={t('invoices.empty')} />
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {invoices.map((i) => (
                <li
                  key={i.id}
                  className="flex flex-col gap-2 py-3"
                  data-testid="institution-invoice"
                  data-state={i.balance.state}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {i.contractName} · {periodLabel(i.period)} · {fmt(i.amountAgorot)}
                    </span>
                    <Badge tone={STATE_TONE[i.balance.state]}>
                      {label('institutionInvoiceState', i.balance.state)}
                    </Badge>
                  </div>
                  <p className="text-sm text-ink-muted">{explain(i.explanation)}</p>
                  {i.documentNumber ? (
                    <p className="text-sm">
                      {t('invoices.document', {
                        number: i.documentNumber,
                        due: dmy(i.dueOn),
                        paid: fmt(i.balance.paidAgorot),
                        left: fmt(i.balance.balanceAgorot),
                      })}
                    </p>
                  ) : null}
                  {i.payments.length > 0 ? (
                    <ul className="text-sm text-ink-muted">
                      {i.payments.map((p) => (
                        <li key={p.id}>
                          {t('invoices.payment', {
                            date: dmy(p.paidOn),
                            amount: fmt(p.amountAgorot),
                            method: label('institutionPaymentMethod', p.method),
                            receipt: p.receiptNumber ?? '—',
                          })}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {i.status === 'draft' ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionButton
                        action={issueInvoiceAction}
                        fields={{ id: i.id, institutionId: inst.id }}
                        data-testid="issue-invoice"
                      >
                        {t('invoices.issue')}
                      </ActionButton>
                      <ActionButton
                        action={cancelInvoiceAction}
                        fields={{ id: i.id, institutionId: inst.id }}
                        variant="ghost"
                      >
                        {t('invoices.cancel')}
                      </ActionButton>
                    </div>
                  ) : null}
                  {i.status === 'issued' ? (
                    <ActionForm action={recordPaymentAction} testId="institution-payment">
                      {hidden}
                      <input type="hidden" name="invoiceId" value={i.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          name="amountAgorot"
                          inputMode="decimal"
                          dir="ltr"
                          label={t('invoices.amount')}
                          defaultValue={String(i.balance.balanceAgorot / 100)}
                        />
                        <Field
                          name="paidOn"
                          type="date"
                          dir="ltr"
                          label={t('invoices.paidOn')}
                          defaultValue={todayIL()}
                        />
                        <SelectField name="method" label={t('invoices.method')} options={methods} />
                        <Field name="reference" label={t('invoices.reference')} />
                      </div>
                      <div>
                        <SubmitButton variant="secondary">{t('invoices.record')}</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('contract.add')}</CardTitle>
          <ActionForm action={createContractAction} resetOnSuccess testId="contract-form">
            {hidden}
            <ContractFields />
            <div>
              <SubmitButton>{t('contract.create')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <details>
            <summary className="min-h-tap cursor-pointer py-3 text-sm text-brand-700">
              {t('edit')}
            </summary>
            <ActionForm action={updateInstitutionAction}>
              <input type="hidden" name="id" value={inst.id} />
              <InstitutionFields i={inst} />
              <div>
                <SubmitButton variant="secondary">{t('save')}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        </Card>
      </div>
    </>
  );
}
