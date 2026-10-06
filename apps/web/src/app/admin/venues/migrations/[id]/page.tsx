import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MIGRATION_LEAD_CHOICES } from '@rswim/contracts';
import { bookingsInSessions } from '@rswim/domain-attendance';
import { previewMigrationMessages } from '@rswim/domain-comms';
import {
  previewMigration,
  type MigrationPreviewGroup,
  type PriceChange,
  type RuleIssue,
} from '@rswim/domain-scheduling';
import { listStaff } from '@rswim/domain-staff';
import { Badge, Card, CardTitle, PageHeader } from '@rswim/ui';
import { ActionButton, ActionForm, Field, SelectField, SubmitButton } from '@/components/form';
import { explainer, money } from '@/lib/billing';
import { withSession } from '@/lib/db';
import { dmy, enumLabel, enumOptions } from '@/lib/options';
import {
  deleteItemAction,
  deleteMigrationAction,
  executeMigrationAction,
  relocateAllAction,
  revertMigrationAction,
  saveItemAction,
} from '../actions';

const TONE = { draft: 'neutral', executed: 'ok', reverted: 'warn' } as const;

/**
 * The Venue Migration Wizard: map every group of the closing venue (move it as it is, or fold it into a group
 * elsewhere), check the preview (rules, prices, each family's message), execute, and revert inside the window.
 */
export default async function MigrationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations('migrations');
  const tw = await getTranslations('common.weekday');
  const label = await enumLabel();
  const explain = await explainer();
  const fmt = await money();
  const data = await withSession(async (tx, ctx) => {
    let preview;
    try {
      preview = await previewMigration(tx, id, {
        bookingsInSessions: (ids) => bookingsInSessions(tx, ids),
      });
    } catch {
      return null;
    }
    return {
      preview,
      messages: await previewMigrationMessages(
        tx,
        ctx,
        preview.groups.flatMap((g) => g.notices),
      ),
      staff: (await listStaff(tx)).filter((s) => s.status === 'active'),
    };
  });
  if (!data) notFound();
  const { preview: p } = data;
  const staffOptions = data.staff.map((x) => ({
    value: x.id,
    label: `${x.firstName} ${x.lastName}`,
  }));
  const m = p.migration;
  const draft = m.status === 'draft';
  const leadOptions = await enumOptions('migrationLead', MIGRATION_LEAD_CHOICES);
  const why = (r: RuleIssue) =>
    explain(r.code.endsWith('.otherDay') ? { ...r, params: { day: tw(String(r.params.day)) } } : r);
  const priceText = (c: PriceChange) =>
    c.kind === 'unknown'
      ? t('price.unknown')
      : c.kind === 'same'
        ? t('price.same', { amount: fmt(c.before) })
        : t(`price.${c.kind}`, { before: fmt(c.before), after: fmt(c.after) });
  const slot = (weekday: number, time: string) => `${tw(String(weekday))} ${time}`;
  const names = new Map(
    p.groups.flatMap((g) =>
      g.children.map((c) => [c.studentId, `${c.firstName} ${c.lastName}`] as const),
    ),
  );

  return (
    <>
      <PageHeader
        title={t('wizardTitle', { venue: m.venueName })}
        subtitle={t('wizardLine', { date: dmy(m.effectiveOn), groups: p.groups.length })}
        actions={
          <Badge tone={TONE[m.status as keyof typeof TONE]}>
            {label('migrationStatus', m.status)}
          </Badge>
        }
      />
      <div className="flex flex-col gap-4">
        {m.reason ? <p className="text-sm text-ink-muted">{m.reason}</p> : null}

        {m.status === 'executed' ? (
          <Card>
            <CardTitle>{t('done.title')}</CardTitle>
            <p className="text-sm" data-testid="migration-done">
              {t('done.line', {
                children: p.groups.reduce((n, g) => n + g.children.length, 0),
                groups: p.groups.length,
              })}
            </p>
            {p.revertable && m.revertUntil ? (
              <div className="mt-3 flex flex-col gap-2">
                <p className="text-sm text-ink-muted">
                  {t('done.revertUntil', {
                    at: m.revertUntil.toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' }),
                  })}
                </p>
                <div>
                  <ActionButton
                    action={revertMigrationAction}
                    fields={{ id: m.id }}
                    variant="secondary"
                    confirm={t('done.revertConfirm')}
                    data-testid="revert-migration"
                  >
                    {t('done.revert')}
                  </ActionButton>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-ink-muted">{t('done.final')}</p>
            )}
            <Link
              href="/admin/messages"
              className="mt-3 inline-block text-sm text-brand-700 underline"
            >
              {t('done.messages')}
            </Link>
          </Card>
        ) : null}
        {m.status === 'reverted' ? (
          <Card>
            <p className="text-sm" data-testid="migration-reverted">
              {t('reverted')}
            </p>
          </Card>
        ) : null}

        {draft ? (
          <Card>
            <CardTitle>{t('quick.title')}</CardTitle>
            <ActionForm action={relocateAllAction} testId="relocate-all">
              <input type="hidden" name="migrationId" value={m.id} />
              <SelectField
                name="targetVenueId"
                label={t('quick.venue')}
                hint={t('quick.hint')}
                options={p.targets.map((v) => ({ value: v.id, label: v.name }))}
              />
              <div>
                <SubmitButton variant="secondary">{t('quick.button')}</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}

        {p.groups.map((g) => (
          <GroupCard key={g.source.id} g={g} />
        ))}

        <Card>
          <CardTitle>{t('messages.title', { n: data.messages.length })}</CardTitle>
          {data.messages.length === 0 ? (
            <p className="text-sm text-ink-muted">{t('messages.none')}</p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="migration-messages">
              {data.messages.map((x) => (
                <li
                  key={x.studentId}
                  className="rounded-xl bg-brand-50 p-3 text-sm dark:bg-surface"
                  data-testid="migration-message"
                >
                  <p className="mb-1 text-xs text-ink-muted">
                    {t('messages.to', {
                      child: names.get(x.studentId) ?? '',
                      guardian: x.guardianName ?? t('messages.noGuardian'),
                    })}
                  </p>
                  {x.text ?? t('messages.missing', { vars: x.missing.join(', ') })}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {draft ? (
          <Card>
            <CardTitle>{t('execute.title')}</CardTitle>
            {p.ready ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm">{t('execute.ready', { hours: p.revertHours })}</p>
                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    action={executeMigrationAction}
                    fields={{ id: m.id }}
                    confirm={t('execute.confirm')}
                    data-testid="execute-migration"
                  >
                    {t('execute.button')}
                  </ActionButton>
                </div>
              </div>
            ) : (
              <p className="text-sm text-warn" data-testid="migration-blockers">
                {p.groups.length === 0
                  ? t('execute.noGroups')
                  : t('execute.blocked', { n: p.blockers })}
              </p>
            )}
            <div className="mt-3">
              <ActionButton
                action={deleteMigrationAction}
                fields={{ id: m.id }}
                variant="ghost"
                confirm={t('execute.deleteConfirm')}
              >
                {t('execute.delete')}
              </ActionButton>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );

  function GroupCard({ g }: { g: MigrationPreviewGroup }) {
    const s = g.source;
    const target = g.item?.target;
    return (
      <Card data-testid="migration-group" data-group={s.name}>
        <CardTitle
          aside={
            <Badge tone={g.issues.length ? 'danger' : g.item ? 'ok' : 'neutral'}>
              {g.item ? label('migrationMode', g.item.mode) : t('group.unmapped')}
            </Badge>
          }
        >
          {s.name}
        </CardTitle>
        <p className="text-sm text-ink-muted">
          {t('group.source', {
            slot: slot(s.weekday, s.startsAt),
            lead: s.lead ?? '—',
            children: s.seated,
          })}
        </p>
        {target ? (
          <p className="mt-2 text-sm" data-testid="migration-target">
            {g.item?.mode === 'relocate'
              ? t('group.relocateTo', {
                  venue: target.venueName,
                  pool: target.poolName ?? '',
                  lanes: target.laneLabels.join(', '),
                  slot: slot(target.weekday, target.startsAt),
                  lead: g.item.lead ?? t('group.noLead'),
                })
              : t('group.mergeInto', {
                  group: target.groupName,
                  venue: target.venueName,
                  slot: slot(target.weekday, target.startsAt),
                  lead: g.item?.lead ?? t('group.noLead'),
                })}
          </p>
        ) : null}
        {g.item ? (
          <p className="text-sm" data-testid="migration-price">
            {priceText(g.price)}
          </p>
        ) : null}
        {g.issues.length || g.warnings.length ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm" data-testid="migration-issues">
            {g.issues.map((x, i) => (
              <li key={`i${i}`} className="text-danger">
                {why(x)}
              </li>
            ))}
            {g.warnings.map((x, i) => (
              <li key={`w${i}`} className="text-warn">
                {why(x)}
              </li>
            ))}
          </ul>
        ) : null}
        {g.children.some((c) => c.issues.length) ? (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {g.children
              .filter((c) => c.issues.length)
              .map((c) => (
                <li key={c.studentId} className="text-danger">
                  {c.firstName} {c.lastName}: {c.issues.map(why).join(' · ')}
                </li>
              ))}
          </ul>
        ) : null}

        {draft ? (
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            {/* Keyed by the saved mapping: the fields are uncontrolled, so a new mapping (say, "all to one venue") remounts them. */}
            <ActionForm
              key={JSON.stringify([g.item?.mode, target, g.item?.leadChoice])}
              action={saveItemAction}
              testId="relocate-form"
            >
              <input type="hidden" name="migrationId" value={m.id} />
              <input type="hidden" name="sourceTemplateId" value={s.id} />
              <input type="hidden" name="mode" value="relocate" />
              <p className="text-sm font-medium">{t('group.relocate')}</p>
              <SelectField
                name="target"
                label={t('group.targetPool')}
                options={p.targets.flatMap((v) =>
                  v.pools.map((pool) => ({
                    value: `${v.id}:${pool.id}`,
                    label: `${v.name} · ${pool.name}`,
                  })),
                )}
                defaultValue={
                  g.item?.mode === 'relocate' && target
                    ? `${target.venueId}:${p.targets.find((v) => v.id === target.venueId)?.pools.find((x) => x.name === target.poolName)?.id ?? ''}`
                    : undefined
                }
              />
              <Field
                name="targetStartsAt"
                type="time"
                label={t('group.startsAt')}
                defaultValue={g.item?.mode === 'relocate' ? target?.startsAt : s.startsAt}
              />
              <SelectField
                name="leadChoice"
                label={t('group.lead')}
                options={leadOptions}
                defaultValue={g.item?.mode === 'relocate' ? g.item.leadChoice : 'keep'}
              />
              <SelectField
                name="newLeadStaffId"
                label={t('group.newLead')}
                hint={t('group.newLeadHint')}
                includeEmpty="—"
                options={staffOptions}
              />
              <div>
                <SubmitButton variant="secondary">{t('group.save')}</SubmitButton>
              </div>
            </ActionForm>
            <ActionForm action={saveItemAction} testId="merge-form">
              <input type="hidden" name="migrationId" value={m.id} />
              <input type="hidden" name="sourceTemplateId" value={s.id} />
              <input type="hidden" name="mode" value="merge" />
              <p className="text-sm font-medium">{t('group.merge')}</p>
              {g.suggestions.length === 0 ? (
                <p className="text-sm text-ink-muted">{t('group.noSuggestions')}</p>
              ) : (
                <>
                  <SelectField
                    name="targetTemplateId"
                    label={t('group.suggestions')}
                    options={g.suggestions.map((x) => ({
                      value: x.id,
                      label: t('group.suggestion', {
                        group: x.name,
                        venue: x.venueName,
                        slot: slot(x.weekday, x.startsAt),
                        seated: x.seated,
                        capacity: x.capacity,
                      }),
                    }))}
                  />
                  <ul className="flex flex-col gap-1 text-xs text-ink-muted">
                    {g.suggestions.map((x) => (
                      <li key={x.id}>
                        <span className="font-medium">{x.name}:</span>{' '}
                        {x.reasons.map(why).join(' · ')}
                      </li>
                    ))}
                  </ul>
                  <div>
                    <SubmitButton variant="secondary">{t('group.save')}</SubmitButton>
                  </div>
                </>
              )}
            </ActionForm>
            {g.item ? (
              <div>
                <ActionButton
                  action={deleteItemAction}
                  fields={{ migrationId: m.id, sourceTemplateId: s.id }}
                  variant="ghost"
                >
                  {t('group.clear')}
                </ActionButton>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
    );
  }
}
