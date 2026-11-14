import QRCode from 'qrcode';
import { getTranslations } from 'next-intl/server';
import { getListing, listJoinRequests } from '@rswim/domain-platform';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  Field,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { PrintButton } from '@/components/print-button';
import { withSession } from '@/lib/db';
import { requestOrigin } from '@/lib/payments';
import { acceptJoinRequestAction, declineJoinRequestAction, saveListingAction } from './actions';

const TONE = { new: 'warn', accepted: 'ok', declined: 'neutral', withdrawn: 'neutral' } as const;

/**
 * How new families find the school (store launch, stage 4): the requests that came in from the school's link, QR or
 * the app's search; the link and a QR poster to print for the pool; and how the school shows in the search.
 */
export default async function JoinRequestsPage() {
  const t = await getTranslations('schools.admin');
  const { requests, listing, canEdit } = await withSession(async (tx, ctx, session) => ({
    requests: await listJoinRequests(tx),
    listing: await getListing(tx, ctx),
    canEdit: session.role === 'owner' || session.permissions.includes('settings.write'),
  }));
  const link = listing ? `${await requestOrigin()}/join/${listing.slug}` : null;
  const qr = link
    ? await QRCode.toString(link, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
    : null;
  const open = requests.filter((r) => r.status === 'new');
  const done = requests.filter((r) => r.status !== 'new');

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
      </div>
      <div className="flex flex-col gap-4">
        <Card data-testid="join-requests" className="print:hidden">
          <CardTitle aside={open.length ? <Badge tone="warn">{open.length}</Badge> : null}>
            {t('requests')}
          </CardTitle>
          {open.length === 0 ? (
            <EmptyState title={t('none')}>{t('noneHint')}</EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {open.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-col gap-2 rounded-xl bg-surface p-3"
                  data-testid="join-request"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
                      {r.firstName} {r.lastName}
                    </p>
                    <Badge tone={r.kind === 'trial' ? 'neutral' : 'ok'}>
                      {t(`kind.${r.kind}`)}
                    </Badge>
                  </div>
                  <p className="text-sm" dir="ltr">
                    {r.phone}
                    {r.email ? ` · ${r.email}` : ''}
                  </p>
                  {r.children.length ? (
                    <p className="text-sm">
                      {t('children')}:{' '}
                      {r.children
                        .map((c) => (c.dob ? `${c.firstName} (${c.dob.slice(0, 4)})` : c.firstName))
                        .join(', ')}
                    </p>
                  ) : null}
                  {r.note ? <p className="text-sm text-ink-muted">“{r.note}”</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <ActionButton
                      action={acceptJoinRequestAction}
                      fields={{ id: r.id }}
                      data-testid="accept"
                    >
                      {t('accept')}
                    </ActionButton>
                    <ActionButton
                      action={declineJoinRequestAction}
                      fields={{ id: r.id }}
                      variant="secondary"
                      confirm={t('declineConfirm')}
                    >
                      {t('decline')}
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-ink-muted">{t('acceptHint')}</p>
          {done.length ? (
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium">{t('decided')}</summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {done.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span>
                      {r.firstName} {r.lastName}
                    </span>
                    <Badge tone={TONE[r.status]}>{t(`status.${r.status}`)}</Badge>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Card>

        {link && qr ? (
          <Card data-testid="join-link" className="print:border-0 print:shadow-none">
            <div className="print:hidden">
              <CardTitle>{t('linkTitle')}</CardTitle>
              <p className="mb-3 text-sm text-ink-muted">{t('linkBody')}</p>
              <p
                className="mb-3 rounded-xl bg-surface px-3 py-2 font-mono text-sm break-all"
                dir="ltr"
              >
                {link}
              </p>
            </div>
            <div className="mx-auto flex max-w-xs flex-col items-center gap-3 text-center print:max-w-md print:pt-16">
              <p className="hidden text-3xl font-bold print:block">{t('posterTitle')}</p>
              <div
                className="w-56 rounded-xl bg-white p-2 print:w-80 [&_svg]:h-auto [&_svg]:w-full"
                // The SVG is generated here from the school's own link.
                dangerouslySetInnerHTML={{ __html: qr }}
              />
              <p className="hidden text-lg print:block">{t('posterBody')}</p>
            </div>
            <div className="mt-3 flex justify-center">
              <PrintButton label={t('print')} />
            </div>
          </Card>
        ) : null}

        {listing ? (
          <Card className="print:hidden" data-testid="listing">
            <CardTitle>{t('listingTitle')}</CardTitle>
            <p className="mb-3 text-sm text-ink-muted">{t('listingBody')}</p>
            {canEdit ? (
              <ActionForm action={saveListingAction}>
                <CheckboxField name="listed" label={t('listed')} defaultChecked={listing.listed} />
                <Field
                  name="city"
                  label={t('city')}
                  defaultValue={listing.city ?? ''}
                  maxLength={60}
                />
                <TextareaField
                  name="about"
                  label={t('about')}
                  hint={t('aboutHint')}
                  defaultValue={listing.about ?? ''}
                  maxLength={400}
                />
                <div>
                  <SubmitButton>{t('save')}</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-sm">{listing.listed ? t('listedYes') : t('listedNo')}</p>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
