import { getTranslations } from 'next-intl/server';
import { BRAND_HUES, type BrandHueKey } from '@rswim/contracts';
import { listDomains, myBranding } from '@rswim/domain-platform';
import { Badge, Card, CardTitle, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import {
  addDomainAction,
  checkDomainAction,
  removeDomainAction,
  saveBrandingAction,
} from './actions';

const DOMAIN_TONE = { pending: 'neutral', verified: 'ok', failed: 'danger' } as const;

/** The school's name and colour on every screen and on its own domain's sign-in page. */
export default async function BrandingPage() {
  const t = await getTranslations('platform.branding');
  const tEnum = await getTranslations('enums');
  const { brand, domains } = await withSession(async (tx) => ({
    brand: await myBranding(tx),
    domains: await listDomains(tx),
  }));
  const hues = Object.keys(BRAND_HUES) as BrandHueKey[];
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>{t('look')}</CardTitle>
          <ActionForm action={saveBrandingAction} testId="branding-form">
            <Field
              name="displayName"
              label={t('displayName')}
              defaultValue={brand.displayName ?? brand.name ?? ''}
            />
            <fieldset className="flex flex-col gap-1">
              <legend className="mb-1 text-sm font-medium">{t('hue')}</legend>
              <div className="flex flex-wrap gap-2">
                {hues.map((h) => (
                  <label
                    key={h}
                    className="flex min-h-tap items-center gap-2 rounded-xl border border-line px-3 has-[:checked]:border-ink"
                  >
                    <input
                      type="radio"
                      name="hue"
                      value={h}
                      defaultChecked={(brand.hue ?? 'sea') === h}
                      className="size-5"
                    />
                    <span
                      aria-hidden
                      className="size-5 rounded-full"
                      style={{ background: `oklch(54% 0.13 ${BRAND_HUES[h]})` }}
                    />
                    <span>{tEnum(`brandHue.${h}`)}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <SubmitButton>{t('save')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('domains')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('domainsHint')}</p>
          {domains.length === 0 ? <p className="mb-3 text-ink-muted">{t('noDomains')}</p> : null}
          <ul className="mb-3 flex flex-col gap-3">
            {domains.map((d) => (
              <li
                key={d.id}
                className="rounded-xl border border-line p-3"
                data-testid={`domain-${d.host}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <bdi className="font-medium" dir="ltr">
                    {d.host}
                  </bdi>
                  <Badge
                    tone={DOMAIN_TONE[d.status as keyof typeof DOMAIN_TONE] ?? 'neutral'}
                    data-testid="domain-status"
                  >
                    {tEnum(`domainStatus.${d.status}`)}
                  </Badge>
                </div>
                {d.status !== 'verified' ? (
                  <div className="mt-2 text-sm">
                    <p>{t('recordHint')}</p>
                    <p>
                      {t('recordName')}{' '}
                      <code dir="ltr" className="break-all">
                        {d.record}
                      </code>
                    </p>
                    <p>
                      {t('recordValue')}{' '}
                      <code dir="ltr" className="break-all">
                        {d.value}
                      </code>
                    </p>
                  </div>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {d.status !== 'verified' ? (
                    <ActionButton
                      action={checkDomainAction}
                      fields={{ id: d.id }}
                      variant="secondary"
                    >
                      {t('check')}
                    </ActionButton>
                  ) : null}
                  <ActionButton
                    action={removeDomainAction}
                    fields={{ id: d.id }}
                    variant="ghost"
                    confirm={t('removeConfirm')}
                  >
                    {t('remove')}
                  </ActionButton>
                </div>
              </li>
            ))}
          </ul>
          <ActionForm action={addDomainAction} resetOnSuccess testId="domain-form">
            <Field name="host" label={t('host')} dir="ltr" placeholder="swim.example.co.il" />
            <div>
              <SubmitButton variant="secondary">{t('addDomain')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
