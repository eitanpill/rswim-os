import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import {
  IMPORT_FIELDS,
  IMPORT_MAX_ROWS,
  IMPORT_UNDO_HOURS,
  type ImportKind,
} from '@rswim/contracts';
import {
  getImport,
  importMandates,
  listImports,
  previewImport,
  type ImportRun,
  type Issue,
} from '@rswim/domain-imports';
import { agorot } from '@rswim/money';
import { Badge, Card, CardTitle, EmptyState, Money, PageHeader } from '@rswim/ui';
import { withSession } from '@/lib/db';
import {
  commitImportAction,
  discardImportAction,
  requestMandatesAction,
  saveMappingAction,
  undoImportAction,
  uploadImportAction,
} from '@/lib/import-actions';
import { ActionButton, ActionForm, CheckboxField, Field, SelectField, SubmitButton } from './form';

type Base = '/admin/import' | '/dive/import';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  draft: 'warn',
  succeeded: 'ok',
  undone: 'neutral',
  failed: 'danger',
};

/** Choosing what to import and from where, and the imports done so far. */
export async function ImportHome({ base, kinds }: { base: Base; kinds: readonly ImportKind[] }) {
  const t = await getTranslations('imports');
  const format = await getFormatter();
  const runs = await withSession((tx) => listImports(tx));
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4" data-testid="import-home">
        <Card>
          <CardTitle>{t('upload.title')}</CardTitle>
          <ActionForm action={uploadImportAction} testId="import-upload">
            <input type="hidden" name="base" value={base} />
            <SelectField
              name="kind"
              label={t('upload.kind')}
              options={kinds.map((k) => ({ value: k, label: t(`kinds.${k}`) }))}
            />
            <Field
              name="file"
              type="file"
              accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              label={t('upload.file')}
              hint={t('upload.fileHint', { max: IMPORT_MAX_ROWS })}
              className="py-2 text-sm"
            />
            <Field
              name="sheetUrl"
              label={t('upload.sheet')}
              hint={t('upload.sheetHint')}
              dir="ltr"
              placeholder="https://docs.google.com/spreadsheets/d/…"
            />
            <p className="text-xs text-ink-muted">{t('upload.privacy')}</p>
            <div>
              <SubmitButton data-testid="import-upload-submit">{t('upload.submit')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('history')}</CardTitle>
          {runs.length === 0 ? (
            <EmptyState title={t('noHistory')} />
          ) : (
            <ul className="divide-y divide-line" data-testid="import-history">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`${base}/${r.id}`}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium" dir="auto">
                        {r.fileName ?? t(`kinds.${r.kind}`)}
                      </span>
                      <span className="text-sm text-ink-muted">
                        {t(`kinds.${r.kind}`)} ·{' '}
                        {format.dateTime(r.startedAt, { dateStyle: 'short', timeStyle: 'short' })}
                        {r.stats.records ? ` · ${t('records', { count: r.stats.records })}` : ''}
                      </span>
                    </span>
                    <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>
                      {t(`status.${r.status}`)}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

/** One import: the columns and the preview while it is a draft, then what it brought in and how to take it back. */
export async function ImportRunView({ base, id }: { base: Base; id: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const run = await withSession((tx) => getImport(tx, id));
  if (!run || !['draft', 'succeeded', 'undone'].includes(run.status)) notFound();
  return run.status === 'draft' ? <Draft base={base} id={id} /> : <Done base={base} run={run} />;
}

async function IssueList({ issues, kind }: { issues: Issue[]; kind: ImportKind }) {
  const t = await getTranslations('imports');
  if (issues.length === 0) return <p className="text-sm text-ok-ink">{t('noIssues')}</p>;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const shown = [...errors, ...warnings].slice(0, 200);
  return (
    <div className="flex flex-col gap-2" data-testid="import-issues">
      <p className="text-sm">
        {errors.length ? (
          <span className="text-danger-ink">{t('errorsCount', { count: errors.length })}</span>
        ) : null}
        {errors.length && warnings.length ? ' · ' : null}
        {warnings.length ? (
          <span className="text-warn-ink">{t('warningsCount', { count: warnings.length })}</span>
        ) : null}
      </p>
      <ul className="max-h-96 overflow-y-auto rounded-xl border border-line text-sm">
        {shown.map((i, n) => (
          <li
            key={`${i.row}-${i.code}-${n}`}
            className="flex gap-2 border-b border-line px-3 py-2 last:border-b-0"
            data-severity={i.severity}
          >
            <span className="shrink-0 font-medium">{t('row', { row: i.row })}</span>
            <span className={i.severity === 'error' ? 'text-danger-ink' : 'text-ink-muted'}>
              {t(`issues.${i.code}`, { kind: t(`kinds.${kind}`) })}
              {i.value ? (
                <>
                  {' '}
                  (<bdi dir="auto">{i.value}</bdi>)
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {issues.length > shown.length ? (
        <p className="text-xs text-ink-muted">
          {t('more', { count: issues.length - shown.length })}
        </p>
      ) : null}
    </div>
  );
}

async function Draft({ base, id }: { base: Base; id: string }) {
  const t = await getTranslations('imports');
  const { run, plan, missing } = await withSession((tx) => previewImport(tx, id));
  const fields = IMPORT_FIELDS[run.kind];
  const options = fields.map((f) => ({ value: f, label: t(`fields.${f}`) }));
  const samples = (col: number) =>
    run.rows
      .map((r) => r[col] ?? '')
      .filter(Boolean)
      .slice(0, 2);
  const stat = (key: string, value: number | string) => (
    <div>
      <dt className="text-sm text-ink-muted">
        {t(`stats.${key}`, { kind: t(`kinds.${run.kind}`) })}
      </dt>
      <dd className="text-xl font-semibold" data-testid={`import-stat-${key}`}>
        {value}
      </dd>
    </div>
  );
  return (
    <>
      <PageHeader
        title={t('draftTitle', { kind: t(`kinds.${run.kind}`) })}
        subtitle={run.fileName ?? undefined}
      />
      <div className="flex flex-col gap-4" data-testid="import-draft">
        <Card>
          <CardTitle>{t('columns.title')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">{t('columns.hint')}</p>
          <ActionForm
            action={saveMappingAction}
            key={JSON.stringify(run.mapping)}
            testId="import-mapping"
          >
            <input type="hidden" name="base" value={base} />
            <input type="hidden" name="importId" value={run.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              {run.headers.map((h, i) => (
                <div key={i} className="rounded-2xl border border-line/70 bg-surface/50 p-3">
                  <SelectField
                    name={`col_${i}`}
                    label={h}
                    hint={samples(i).join(' · ') || t('columns.empty')}
                    includeEmpty={t('columns.skip')}
                    options={options}
                    defaultValue={run.mapping[String(i)] ?? ''}
                    data-testid={`import-col-${i}`}
                  />
                </div>
              ))}
            </div>
            <div>
              <SubmitButton variant="secondary" data-testid="import-mapping-save">
                {t('columns.save')}
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card>
          <CardTitle>{t('preview.title')}</CardTitle>
          {missing.length ? (
            <p
              className="mb-3 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger-ink"
              role="alert"
            >
              {t('preview.missing', {
                fields: missing.map((f) => t(`fields.${f}`)).join(', '),
              })}
            </p>
          ) : null}
          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stat('rows', plan.rows)}
            {stat('ready', plan.ready)}
            {stat('skipped', plan.skipped)}
            {stat('records', plan.records)}
            {run.kind === 'families' ? stat('children', plan.children) : null}
            {run.kind === 'families' && plan.balanceAgorot ? (
              <div>
                <dt className="text-sm text-ink-muted">{t('stats.balance')}</dt>
                <dd className="text-xl font-semibold">
                  <Money agorot={agorot(plan.balanceAgorot)} />
                </dd>
              </div>
            ) : null}
          </dl>
          {run.kind === 'families' && plan.families.length ? (
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-brand-ink">
                {t('preview.sample')}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {plan.families.slice(0, 5).map((f) => (
                  <li key={f.rows[0]} dir="auto">
                    <bdi>{f.displayName}</bdi>
                    {f.parent.phone ? (
                      <>
                        {' '}
                        · <bdi dir="ltr">{f.parent.phone}</bdi>
                      </>
                    ) : null}{' '}
                    ·{' '}
                    {f.children
                      .map((c) => c.firstName + (c.groupName ? ` (${c.groupName})` : ''))
                      .join(', ')}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {plan.people.length ? (
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-brand-ink">
                {t('preview.sample')}
              </summary>
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {plan.people.slice(0, 5).map((p) => (
                  <li key={p.row} dir="auto">
                    <bdi>
                      {p.firstName} {p.lastName}
                    </bdi>
                    {p.phone ? (
                      <>
                        {' '}
                        · <bdi dir="ltr">{p.phone}</bdi>
                      </>
                    ) : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <IssueList issues={plan.issues} kind={run.kind} />
        </Card>

        <Card>
          <CardTitle>{t('commit.title')}</CardTitle>
          <ActionForm action={commitImportAction} testId="import-commit">
            <input type="hidden" name="base" value={base} />
            <input type="hidden" name="importId" value={run.id} />
            {run.kind !== 'staff' ? (
              <CheckboxField name="whatsappOptIn" label={t('commit.optIn')} />
            ) : null}
            <p className="text-sm text-ink-muted">
              {t('commit.hint', { hours: IMPORT_UNDO_HOURS })}
            </p>
            <div>
              <SubmitButton
                disabled={missing.length > 0 || plan.records === 0}
                data-testid="import-commit-submit"
              >
                {t('commit.submit', { count: plan.records, kind: t(`kinds.${run.kind}`) })}
              </SubmitButton>
            </div>
          </ActionForm>
          <div className="mt-3">
            <ActionButton
              action={discardImportAction}
              fields={{ base, importId: run.id }}
              variant="ghost"
              data-testid="import-discard"
            >
              {t('commit.discard')}
            </ActionButton>
          </div>
        </Card>
      </div>
    </>
  );
}

async function Done({ base, run }: { base: Base; run: ImportRun }) {
  const t = await getTranslations('imports');
  const format = await getFormatter();
  const mandates =
    run.kind === 'families' && run.status === 'succeeded'
      ? await withSession((tx) => importMandates(tx, run.id))
      : [];
  const s = run.stats;
  const undoBy = run.committedAt
    ? new Date(run.committedAt.getTime() + IMPORT_UNDO_HOURS * 3_600_000)
    : null;
  const byState = (state: string) => mandates.filter((m) => m.state === state).length;
  return (
    <>
      <PageHeader
        title={t('doneTitle', { kind: t(`kinds.${run.kind}`) })}
        subtitle={run.fileName ?? undefined}
      />
      <div className="flex flex-col gap-4" data-testid="import-done">
        <Card>
          <CardTitle
            aside={
              <Badge tone={STATUS_TONE[run.status] ?? 'neutral'}>{t(`status.${run.status}`)}</Badge>
            }
          >
            {t('result.title')}
          </CardTitle>
          <ul className="flex flex-col gap-1 text-sm" data-testid="import-result">
            <li>{t('result.records', { count: s.records ?? 0, kind: t(`kinds.${run.kind}`) })}</li>
            {run.kind === 'families' ? (
              <li>{t('result.children', { count: s.children ?? 0 })}</li>
            ) : null}
            {s.placed ? <li>{t('result.placed', { count: s.placed })}</li> : null}
            {s.balanceAgorot ? (
              <li>
                {t('result.balance')} <Money agorot={agorot(s.balanceAgorot)} />
              </li>
            ) : null}
            {s.skipped ? (
              <li className="text-danger-ink">{t('result.skipped', { count: s.skipped })}</li>
            ) : null}
            {typeof s.ms === 'number' ? (
              <li className="text-ink-muted">
                {t('result.time', { seconds: (s.ms / 1000).toFixed(1) })}
              </li>
            ) : null}
            {run.status === 'undone' ? (
              <li className="text-ink-muted">
                {t('result.undone', { removed: s.removed ?? 0, kept: s.kept ?? 0 })}
              </li>
            ) : null}
          </ul>
          {run.canUndo && undoBy ? (
            <div className="mt-4 flex flex-col gap-1">
              <ActionButton
                action={undoImportAction}
                fields={{ base, importId: run.id }}
                variant="secondary"
                data-testid="import-undo"
              >
                {t('undo')}
              </ActionButton>
              <p className="text-xs text-ink-muted">
                {t('undoHint', {
                  until: format.dateTime(undoBy, { dateStyle: 'short', timeStyle: 'short' }),
                })}
              </p>
            </div>
          ) : null}
        </Card>

        {run.report.length ? (
          <Card>
            <CardTitle>{t('result.issues')}</CardTitle>
            <IssueList issues={run.report} kind={run.kind} />
          </Card>
        ) : null}

        {mandates.length ? (
          <Card>
            <CardTitle>{t('mandates.title')}</CardTitle>
            <p className="mb-3 text-sm text-ink-muted">{t('mandates.hint')}</p>
            <p className="mb-3 text-sm" data-testid="import-mandates-summary">
              {t('mandates.summary', {
                signed: byState('signed'),
                sent: byState('sent'),
                none: byState('none'),
              })}
            </p>
            {byState('none') ? (
              <ActionButton
                action={requestMandatesAction}
                fields={{ base, importId: run.id }}
                data-testid="import-mandates-send"
              >
                {t('mandates.send', { count: byState('none') })}
              </ActionButton>
            ) : null}
            <ul className="mt-3 divide-y divide-line text-sm" data-testid="import-mandates">
              {mandates.map((m) => (
                <li key={m.householdId} className="flex items-center justify-between gap-2 py-2">
                  <span className="min-w-0 truncate" dir="auto">
                    {m.name}
                    {m.phone ? (
                      <span className="ms-2 text-ink-muted" dir="ltr">
                        {m.phone}
                      </span>
                    ) : null}
                  </span>
                  <Badge
                    tone={m.state === 'signed' ? 'ok' : m.state === 'sent' ? 'warn' : 'neutral'}
                  >
                    {t(`mandates.state.${m.state}`)}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}

        <div>
          <Link href={base} className="text-sm font-medium text-brand-ink">
            {t('back')}
          </Link>
        </div>
      </div>
    </>
  );
}
