import { getTranslations } from 'next-intl/server';
import { databaseSettings, listSchoolDatabases } from '@rswim/domain-platform';
import { Badge, Card, CardTitle } from '@rswim/ui';
import { ActionButton, ActionForm, SelectField, SubmitButton } from '@/components/form';
import { withSignedIn } from '@/lib/db';
import { retrySchoolDatabaseAction, setNewSchoolDatabaseAction } from './actions';

const TONE = {
  requested: 'neutral',
  creating: 'neutral',
  migrating: 'neutral',
  seeding: 'neutral',
  ready: 'ok',
  failed: 'danger',
} as const;

/**
 * Schools' own databases (docs/TENANT-DATABASES.md): whether a new school gets one, and each one's state with a
 * retry for one that failed.
 */
export async function SchoolDatabases() {
  const t = await getTranslations('platform.databases');
  const { settings, list } = await withSignedIn(
    async (tx) => ({ settings: await databaseSettings(tx), list: await listSchoolDatabases(tx) }),
    { platform: true },
  );
  return (
    <Card className="mb-4" data-testid="school-databases">
      <CardTitle>{t('title')}</CardTitle>
      <p className="mb-3 text-sm text-ink-muted">{t('explain')}</p>
      <ActionForm action={setNewSchoolDatabaseAction} className="md:flex-row md:items-end">
        <SelectField
          name="mode"
          label={t('newSchools')}
          defaultValue={settings.newSchoolDatabase}
          options={[
            { value: 'shared', label: t('mode.shared') },
            { value: 'dedicated', label: t('mode.dedicated') },
          ]}
        />
        <div>
          <SubmitButton>{t('save')}</SubmitButton>
        </div>
      </ActionForm>
      {list.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">{t('none')}</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {list.map((d) => (
            <li
              key={d.organizationId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2"
              data-testid={`school-db-${d.slug}`}
            >
              <div>
                <p className="font-medium">{d.name}</p>
                <p className="text-xs text-ink-muted" dir="ltr">
                  {[d.provider, d.projectRef, d.region].filter(Boolean).join(' · ')}
                </p>
                {d.lastError ? (
                  <p className="text-xs text-danger" dir="ltr">
                    {d.lastError}
                  </p>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={TONE[d.status]}>{t(`status.${d.status}`)}</Badge>
                {d.status === 'failed' ? (
                  <ActionButton
                    action={retrySchoolDatabaseAction}
                    fields={{ organizationId: d.organizationId }}
                    variant="secondary"
                  >
                    {t('retry')}
                  </ActionButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
