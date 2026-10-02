import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import { FREEZE_REASONS, MANUAL_PAYMENT_METHODS, PREFERRED_METHODS } from '@rswim/contracts';
import type { Tx } from '@rswim/db';
import { householdMoney, seatsOfStudents } from '@rswim/domain-billing';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, EmptyState } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { explainer, money, periodLabel } from '@/lib/billing';
import { dmy, enumLabel, enumOptions, todayIL } from '@/lib/options';
import {
  addMandateAction,
  adjustmentAction,
  cancelFreezeAction,
  cancelLinkAction,
  cancelMandateAction,
  recordPaymentAction,
  refundAction,
  requestCancellationAction,
  requestFreezeAction,
  requestLinkAction,
  reverseEntryAction,
  saveBillingDetailsAction,
  withdrawCancellationAction,
} from '../money-actions';

/** Everything the family card loads for its money part. */
export async function loadFamilyMoney(tx: Tx, householdId: string, studentIds: string[]) {
  const [m, seats, staff] = await Promise.all([
    householdMoney(tx, householdId),
    seatsOfStudents(tx, studentIds),
    listStaff(tx),
  ]);
  return { ...m, seats, staff };
}

type FamilyMoneyData = Awaited<ReturnType<typeof loadFamilyMoney>>;

/** The family card's money (brief §6.7): balance, entries, payments, mandates, links, receipts, freezes. */
export async function FamilyMoney({
  householdId,
  students,
  data,
}: {
  householdId: string;
  students: { id: string; firstName: string }[];
  data: FamilyMoneyData;
}) {
  const t = await getTranslations('money.family');
  const tc = await getTranslations('common');
  const label = await enumLabel();
  const fmt = await money();
  const explain = await explainer();
  const studentName = new Map(students.map((s) => [s.id, s.firstName]));
  const studentOptions = students.map((s) => ({ value: s.id, label: s.firstName }));
  const staffOptions = data.staff
    .filter((s) => s.status === 'active')
    .map((s) => ({ value: s.id, label: `${s.firstName} ${s.lastName}` }));
  const bind = <A extends unknown[], R>(fn: (h: string, ...a: A) => R) =>
    fn.bind(null, householdId) as (...a: A) => R;
  const manualMethods = await enumOptions('paymentMethod', MANUAL_PAYMENT_METHODS);
  const freezeReasons = await enumOptions('freezeReason', FREEZE_REASONS);
  const preferredMethods = await enumOptions('preferredMethod', PREFERRED_METHODS);
  const refunded = (paymentId: string) =>
    data.payments
      .filter(
        (p) =>
          p.refundOfPaymentId === paymentId && p.status !== 'failed' && p.status !== 'cancelled',
      )
      .reduce((s, p) => s + p.amountAgorot, 0);

  return (
    <>
      <Card data-testid="family-money">
        <CardTitle
          aside={
            <span
              className={data.balance > 0 ? 'font-semibold text-danger' : 'font-semibold text-ok'}
              data-testid="family-balance"
            >
              {data.balance > 0
                ? t('owes', { amount: fmt(data.balance) })
                : data.balance < 0
                  ? t('credit', { amount: fmt(-data.balance) })
                  : t('settled')}
            </span>
          }
        >
          {t('title')}
        </CardTitle>

        <details className="mt-2" open={data.entries.length > 0 && data.entries.length <= 8}>
          <summary className="min-h-tap cursor-pointer py-2 font-medium">{t('ledger')}</summary>
          {data.entries.length === 0 ? (
            <EmptyState title={t('noEntries')} />
          ) : (
            <ul className="flex flex-col text-sm" data-testid="ledger">
              {data.entries.map((e) => {
                const undone = data.reversed.has(e.id);
                const canReverse =
                  !undone && !e.reversesEntryId && e.type !== 'payment' && e.type !== 'refund';
                return (
                  <li key={e.id} className="border-t border-line py-2">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <span className="font-medium">{label('ledgerEntryType', e.type)}</span>{' '}
                        {[
                          e.studentId ? studentName.get(e.studentId) : null,
                          e.description,
                          e.period ? periodLabel(e.period) : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                        <span className="block text-xs text-ink-muted">
                          {dmy(e.occurredOn)} · {label('ledgerSource', e.source)}
                          {e.explanation ? ` · ${explain(e.explanation)}` : ''}
                          {e.note ? ` · ${e.note}` : ''}
                        </span>
                      </span>
                      <span className={e.amountAgorot < 0 ? 'text-ok' : undefined}>
                        {fmt(e.amountAgorot)}
                        {undone ? <Badge className="ms-1">{t('reversed')}</Badge> : null}
                      </span>
                    </div>
                    {canReverse ? (
                      <details>
                        <summary className="cursor-pointer py-1 text-xs text-ink-muted">
                          {t('reverse')}
                        </summary>
                        <ActionForm action={bind(reverseEntryAction)} className="mt-1">
                          <input type="hidden" name="id" value={e.id} />
                          <Field name="note" label={t('reverseNote')} />
                          <div>
                            <SubmitButton variant="secondary">{t('reverse')}</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </details>

        <details className="mt-2">
          <summary className="min-h-tap cursor-pointer py-2 text-brand-700">{t('payment')}</summary>
          <ActionForm action={bind(recordPaymentAction)} resetOnSuccess testId="manual-payment">
            <input type="hidden" name="householdId" value={householdId} />
            <input type="hidden" name="requestId" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField name="method" label={t('method')} options={manualMethods} />
              <Field name="amountAgorot" label={t('amount')} inputMode="decimal" />
              <Field name="paidOn" type="date" label={t('paidOn')} defaultValue={todayIL()} />
              <SelectField
                name="receivedByStaffId"
                label={t('receivedBy')}
                options={staffOptions}
                includeEmpty=""
              />
              <Field name="note" label={t('note')} />
            </div>
            <div>
              <SubmitButton>{t('record')}</SubmitButton>
            </div>
          </ActionForm>
        </details>

        <details className="mt-2">
          <summary className="min-h-tap cursor-pointer py-2 text-brand-700">{t('adjust')}</summary>
          <ActionForm action={bind(adjustmentAction)} resetOnSuccess>
            <input type="hidden" name="householdId" value={householdId} />
            <input type="hidden" name="requestId" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="kind"
                label={t('kind')}
                options={(['credit', 'charge', 'write_off'] as const).map((k) => ({
                  value: k,
                  label: t(`kinds.${k}`),
                }))}
              />
              <Field name="amountAgorot" label={t('amount')} inputMode="decimal" />
              <Field name="description" label={t('description')} />
              <Field name="period" label={t('periodOptional')} placeholder="2026-09" dir="ltr" />
              <SelectField
                name="studentId"
                label={t('studentOptional')}
                options={studentOptions}
                includeEmpty=""
              />
              <Field name="note" label={t('note')} />
            </div>
            <div>
              <SubmitButton>{t('post')}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </Card>

      <Card data-testid="family-payments">
        <CardTitle>{t('payments')}</CardTitle>
        {data.payments.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('noPayments')}</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {data.payments.map((p) => {
              const left = p.amountAgorot - refunded(p.id);
              return (
                <li key={p.id} className="border-t border-line py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {label('paymentKind', p.kind)} · {label('paymentMethod', p.method)}
                      {p.paidOn ? ` · ${dmy(p.paidOn)}` : ''}
                      {p.failureReason ? ` · ${p.failureReason}` : ''}
                    </span>
                    <span className="flex items-center gap-1">
                      {fmt(p.kind === 'refund' ? -p.amountAgorot : p.amountAgorot)}
                      <Badge
                        tone={
                          p.status === 'succeeded'
                            ? 'ok'
                            : p.status === 'failed'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {label('paymentStatus', p.status)}
                      </Badge>
                    </span>
                  </div>
                  {p.kind === 'payment' && p.status === 'succeeded' && left > 0 ? (
                    <details>
                      <summary className="cursor-pointer py-1 text-xs text-ink-muted">
                        {t('refund')}
                      </summary>
                      <ActionForm action={bind(refundAction)} className="mt-1">
                        <input type="hidden" name="paymentId" value={p.id} />
                        <input type="hidden" name="requestId" value={randomUUID()} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field
                            name="amountAgorot"
                            label={t('amount')}
                            inputMode="decimal"
                            defaultValue={String(left / 100)}
                          />
                          <SelectField
                            name="via"
                            label={t('refundVia')}
                            options={[
                              ...(p.provider
                                ? [{ value: 'provider', label: t('refundProvider') }]
                                : []),
                              ...manualMethods,
                            ]}
                          />
                          <Field name="note" label={t('note')} />
                        </div>
                        <div>
                          <SubmitButton variant="secondary">{t('refundSubmit')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <h3 className="mt-4 font-semibold">{t('mandates')}</h3>
        {data.mandates.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('noMandates')}</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {data.mandates.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
              >
                <span dir="ltr">
                  {m.mandateId}
                  {m.cardLast4 ? ` · ****${m.cardLast4}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  <Badge
                    tone={
                      m.status === 'active' ? 'ok' : m.status === 'failing' ? 'danger' : 'neutral'
                    }
                  >
                    {label('standingOrderStatus', m.status)}
                  </Badge>
                  {m.status !== 'cancelled' ? (
                    <ActionButton
                      action={bind(cancelMandateAction)}
                      fields={{ id: m.id }}
                      variant="ghost"
                    >
                      {t('cancelMandate')}
                    </ActionButton>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-2">
          <summary className="min-h-tap cursor-pointer py-2 text-brand-700">
            {t('addMandate')}
          </summary>
          <ActionForm action={bind(addMandateAction)} resetOnSuccess>
            <input type="hidden" name="householdId" value={householdId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="mandateId" label={t('mandateId')} dir="ltr" />
              <Field name="cardLast4" label={t('last4')} inputMode="numeric" dir="ltr" />
              <Field name="dayOfMonth" label={t('day')} inputMode="numeric" />
              <Field name="amountAgorot" label={t('mandateAmount')} inputMode="decimal" />
            </div>
            <div>
              <SubmitButton>{t('addMandate')}</SubmitButton>
            </div>
          </ActionForm>
        </details>

        <h3 className="mt-4 font-semibold">{t('links')}</h3>
        {data.links.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('noLinks')}</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {data.links.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
              >
                <span>
                  {l.description} · {fmt(l.amountAgorot)}
                  {l.url ? (
                    <a href={l.url} className="ms-2 text-brand-700 underline" dir="ltr">
                      {l.url}
                    </a>
                  ) : l.status === 'open' ? (
                    <span className="ms-2 text-ink-muted">{t('linkPending')}</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={l.status === 'paid' ? 'ok' : 'neutral'}>
                    {label('paymentLinkStatus', l.status)}
                  </Badge>
                  {l.status === 'open' ? (
                    <ActionButton
                      action={bind(cancelLinkAction)}
                      fields={{ id: l.id }}
                      variant="ghost"
                    >
                      {t('cancelLink')}
                    </ActionButton>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-2">
          <summary className="min-h-tap cursor-pointer py-2 text-brand-700">
            {t('requestLink')}
          </summary>
          <ActionForm action={bind(requestLinkAction)} resetOnSuccess>
            <input type="hidden" name="householdId" value={householdId} />
            <input type="hidden" name="requestId" value={randomUUID()} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                name="amountAgorot"
                label={t('amount')}
                inputMode="decimal"
                defaultValue={data.balance > 0 ? String(data.balance / 100) : ''}
              />
              <Field name="description" label={t('linkDescription')} />
              <Field name="termsText" label={t('linkTerms')} />
            </div>
            <div>
              <SubmitButton>{t('requestLink')}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </Card>

      <Card data-testid="family-documents">
        <CardTitle>{t('documents')}</CardTitle>
        {data.documents.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('noDocuments')}</p>
        ) : (
          <ul className="flex flex-col text-sm">
            {data.documents.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-2"
              >
                <span>
                  {d.status === 'issued'
                    ? t('document', { number: d.number ?? '' })
                    : d.status === 'failed'
                      ? t('documentFailed', { reason: explain(d.error) })
                      : t('documentPending')}
                  {d.period ? ` · ${periodLabel(d.period)}` : ''}
                </span>
                <span className="flex items-center gap-2">
                  {fmt(d.totalAgorot)}
                  {d.pdfUrl ? (
                    <a href={d.pdfUrl} className="text-brand-700 underline">
                      PDF
                    </a>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="mt-2">
          <summary className="min-h-tap cursor-pointer py-2 text-brand-700">{t('details')}</summary>
          <ActionForm action={bind(saveBillingDetailsAction)} testId="billing-details">
            <input type="hidden" name="householdId" value={householdId} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                name="payerName"
                label={t('payerName')}
                defaultValue={data.details?.payerName ?? ''}
              />
              <Field
                name="payerEmail"
                type="email"
                label={t('payerEmail')}
                defaultValue={data.details?.payerEmail ?? ''}
                dir="ltr"
              />
              <Field
                name="payerNationalId"
                label={t('payerId')}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                hint={
                  data.details?.payerIdLast4
                    ? `${t('payerIdOnFile', { last4: data.details.payerIdLast4 })}. ${t('payerIdHint')}`
                    : t('payerIdHint')
                }
              />
              <SelectField
                name="reimbursementProfileId"
                label={t('profile')}
                options={data.profiles
                  .filter((p) => p.active)
                  .map((p) => ({ value: p.id, label: p.name }))}
                includeEmpty={t('noProfile')}
                defaultValue={data.details?.reimbursementProfileId ?? ''}
              />
              <SelectField
                name="preferredMethod"
                label={t('preferred')}
                options={preferredMethods}
                defaultValue={data.details?.preferredMethod ?? 'standing_order'}
              />
              <Field name="notes" label={t('notes')} defaultValue={data.details?.notes ?? ''} />
            </div>
            <div>
              <SubmitButton>{tc('save')}</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </Card>

      <Card data-testid="family-seats">
        <CardTitle>{t('seats')}</CardTitle>
        {data.seats.places.length === 0 ? (
          <p className="text-sm text-ink-muted">{t('noSeats')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {data.seats.places.map((p) => {
              const freezes = data.seats.freezes.filter((f) => f.enrollmentId === p.enrollmentId);
              const cancellation = data.seats.cancellations.find(
                (c) => c.enrollmentId === p.enrollmentId && c.status === 'active',
              );
              return (
                <li key={p.enrollmentId} className="rounded-xl border border-line p-3">
                  <p className="font-medium">
                    {studentName.get(p.studentId) ?? ''} · {p.groupName}
                  </p>
                  {freezes.map((f) => (
                    <div
                      key={f.id}
                      className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm"
                    >
                      <span>
                        {t('freeze')}:{' '}
                        {t('freezeInfo', {
                          from: dmy(f.fromDate),
                          to: dmy(f.toDate),
                          status: label('freezeStatus', f.status),
                        })}
                      </span>
                      {f.status === 'requested' || f.status === 'approved' ? (
                        <ActionButton
                          action={bind(cancelFreezeAction)}
                          fields={{ id: f.id }}
                          variant="ghost"
                        >
                          {t('cancelFreeze')}
                        </ActionButton>
                      ) : null}
                    </div>
                  ))}
                  {cancellation ? (
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        {explain(cancellation.explanation)}.{' '}
                        {t('cancelInfo', {
                          last: periodLabel(cancellation.lastChargedPeriod),
                          ends: dmy(cancellation.endsOn),
                        })}
                      </span>
                      <ActionButton
                        action={bind(withdrawCancellationAction)}
                        fields={{ id: cancellation.id }}
                        variant="ghost"
                      >
                        {t('withdraw')}
                      </ActionButton>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-4">
                    <details>
                      <summary className="min-h-tap cursor-pointer py-2 text-sm text-brand-700">
                        {t('freeze')}
                      </summary>
                      <ActionForm action={bind(requestFreezeAction)} resetOnSuccess>
                        <input type="hidden" name="enrollmentId" value={p.enrollmentId} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Field name="fromDate" type="date" label={t('from')} />
                          <Field name="toDate" type="date" label={t('to')} />
                          <SelectField name="reason" label={t('reason')} options={freezeReasons} />
                          <Field name="note" label={t('note')} />
                        </div>
                        <div>
                          <SubmitButton>{t('requestFreeze')}</SubmitButton>
                        </div>
                      </ActionForm>
                    </details>
                    {!cancellation ? (
                      <details>
                        <summary className="min-h-tap cursor-pointer py-2 text-sm text-brand-700">
                          {t('cancel')}
                        </summary>
                        <ActionForm action={bind(requestCancellationAction)}>
                          <input type="hidden" name="enrollmentId" value={p.enrollmentId} />
                          <Field
                            name="requestedAt"
                            type="datetime-local"
                            label={t('requestedAt')}
                          />
                          <Field name="note" label={t('note')} />
                          <div>
                            <SubmitButton variant="secondary">{t('requestCancel')}</SubmitButton>
                          </div>
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
