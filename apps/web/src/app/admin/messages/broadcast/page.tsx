import { getTranslations } from 'next-intl/server';
import { listBroadcasts, previewAudience } from '@rswim/domain-comms';
import { listPrograms } from '@rswim/domain-settings';
import { listGroups } from '@rswim/domain-scheduling';
import { listVenues } from '@rswim/domain-venues';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  CheckboxGroup,
  Field,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel } from '@/lib/options';
import { broadcastAction, cancelBroadcastAction } from '../actions';
import { MessagesTabs, when } from '../tabs';

/** One message to a segment of families: a venue, a group, a program, families who owe; now or at a set time. */
export default async function BroadcastPage() {
  const t = await getTranslations('comms.broadcast');
  const label = await enumLabel();
  const data = await withSession(async (tx) => ({
    all: await previewAudience(tx, {}),
    venues: await listVenues(tx),
    groups: await listGroups(tx),
    programs: await listPrograms(tx),
    history: await listBroadcasts(tx),
  }));
  return (
    <>
      <PageHeader title={t('title')} />
      <MessagesTabs active="broadcast" />
      <Card className="mb-4">
        <CardTitle>{t('title')}</CardTitle>
        <p className="mb-2 text-sm text-ink-muted">{t('hint')}</p>
        <p className="mb-3 text-sm" data-testid="audience">
          {t('preview', data.all)}
        </p>
        <ActionForm action={broadcastAction} testId="broadcast-form">
          <Field name="title" label={t('name')} required />
          <TextareaField name="body" label={t('body')} rows={4} required />
          <CheckboxGroup
            name="venueIds"
            legend={t('venues')}
            options={data.venues.map((v) => ({ value: v.id, label: v.name }))}
          />
          <CheckboxGroup
            name="programIds"
            legend={t('programs')}
            options={data.programs.map((p) => ({ value: p.id, label: p.nameHe }))}
          />
          <CheckboxGroup
            name="groupIds"
            legend={t('groups')}
            options={data.groups.map((g) => ({ value: g.id, label: g.name }))}
          />
          <CheckboxField name="owing" label={t('owing')} />
          <Field
            name="scheduledFor"
            type="datetime-local"
            label={t('scheduledFor')}
            hint={t('scheduledHint')}
          />
          <SubmitButton>{t('send')}</SubmitButton>
        </ActionForm>
      </Card>
      <Card>
        <CardTitle>{t('history')}</CardTitle>
        {data.history.length === 0 ? (
          <EmptyState title={t('empty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {data.history.map((b) => {
              const c = b.counts as { households?: number; queued?: number; blocked?: number };
              return (
                <li key={b.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="flex-1 font-medium">{b.title}</span>
                  <Badge>{label('broadcastStatus', b.status)}</Badge>
                  <span className="text-sm text-ink-muted">
                    {when(b.sentAt ?? b.scheduledFor ?? b.createdAt)}
                  </span>
                  {b.status === 'sent' ? (
                    <span className="text-sm text-ink-muted">
                      {t('sent', {
                        households: c.households ?? 0,
                        queued: c.queued ?? 0,
                        blocked: c.blocked ?? 0,
                      })}
                    </span>
                  ) : null}
                  {b.status === 'scheduled' ? (
                    <ActionButton
                      action={cancelBroadcastAction}
                      fields={{ id: b.id }}
                      variant="ghost"
                    >
                      {t('cancel')}
                    </ActionButton>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
