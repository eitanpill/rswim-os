import { getTranslations } from 'next-intl/server';
import { PROGRAM_KINDS } from '@rswim/contracts';
import { listPrograms } from '@rswim/domain-settings';
import { Badge, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import {
  ActionButton,
  ActionForm,
  CheckboxField,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
  type Action,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { enumLabel, enumOptions } from '@/lib/options';
import {
  addLevelAction,
  createProgramAction,
  deleteLevelAction,
  moveLevelAction,
  updateProgramAction,
} from './actions';

type Program = Awaited<ReturnType<typeof listPrograms>>[number];

export default async function ProgramsPage() {
  const t = await getTranslations('programs');
  const label = await enumLabel();
  const programs = await withSession((tx) => listPrograms(tx));
  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        {programs.length === 0 ? (
          <Card>
            <EmptyState title={t('empty')} />
          </Card>
        ) : null}
        {programs.map((p) => (
          <Card key={p.id} data-testid={`program-${p.code}`}>
            <CardTitle aside={p.active ? null : <Badge tone="warn">{t('inactive')}</Badge>}>
              {p.nameHe}
            </CardTitle>
            <p className="mb-3 text-sm text-ink-muted">
              {label('programKind', p.kind)} ·{' '}
              {t('facts', { duration: p.defaultDurationMin, capacity: p.defaultCapacity })}
            </p>
            <Levels program={p} />
            <details className="mt-3">
              <summary className="min-h-tap cursor-pointer text-brand-700">{t('edit')}</summary>
              <div className="mt-2">
                <ProgramForm action={updateProgramAction.bind(null, p.id)} program={p} />
              </div>
            </details>
          </Card>
        ))}
        <Card>
          <CardTitle>{t('new')}</CardTitle>
          <ProgramForm action={createProgramAction} />
        </Card>
      </div>
    </>
  );
}

async function Levels({ program }: { program: Program }) {
  const t = await getTranslations('programs.levels');
  const tc = await getTranslations('common');
  return (
    <section>
      <h3 className="mb-2 font-semibold">{t('title')}</h3>
      {program.levels.length === 0 ? <p className="text-sm text-ink-muted">{t('empty')}</p> : null}
      <ol className="flex flex-col gap-2">
        {program.levels.map((l, i) => (
          <li
            key={l.id}
            className="flex items-start justify-between gap-2 rounded-xl border border-line p-3"
          >
            <div>
              <p className="font-medium">
                {i + 1}. {l.nameHe}
              </p>
              {(l.skills as { he: string }[]).length ? (
                <p className="text-sm text-ink-muted">
                  {(l.skills as { he: string }[]).map((s) => s.he).join(' · ')}
                </p>
              ) : null}
            </div>
            <div className="flex gap-1">
              {i > 0 ? (
                <ActionButton
                  action={moveLevelAction}
                  fields={{ id: l.id, direction: 'up' }}
                  variant="ghost"
                  aria-label={t('up')}
                >
                  ↑
                </ActionButton>
              ) : null}
              {i < program.levels.length - 1 ? (
                <ActionButton
                  action={moveLevelAction}
                  fields={{ id: l.id, direction: 'down' }}
                  variant="ghost"
                  aria-label={t('down')}
                >
                  ↓
                </ActionButton>
              ) : null}
              <ActionButton
                action={deleteLevelAction}
                fields={{ id: l.id }}
                variant="ghost"
                confirm={t('confirmDelete')}
              >
                {tc('delete')}
              </ActionButton>
            </div>
          </li>
        ))}
      </ol>
      <details className="mt-2">
        <summary className="min-h-tap cursor-pointer text-brand-700">{t('add')}</summary>
        <ActionForm action={addLevelAction.bind(null, program.id)} resetOnSuccess className="mt-2">
          <div className="grid grid-cols-2 gap-3">
            <Field name="nameHe" label={t('nameHe')} />
            <Field name="code" label={t('code')} hint={t('codeHint')} dir="ltr" />
          </div>
          <Field name="nameEn" label={t('nameEn')} dir="ltr" />
          <TextareaField name="skills" label={t('skills')} hint={t('skillsHint')} rows={4} />
          <div>
            <SubmitButton>{t('add')}</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </section>
  );
}

async function ProgramForm({ action, program }: { action: Action; program?: Program }) {
  const t = await getTranslations('programs.form');
  const tc = await getTranslations('common');
  return (
    <ActionForm action={action} resetOnSuccess={!program}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="nameHe" label={t('nameHe')} defaultValue={program?.nameHe} />
        <Field name="nameEn" label={t('nameEn')} defaultValue={program?.nameEn ?? ''} dir="ltr" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          name="kind"
          label={t('kind')}
          options={await enumOptions('programKind', PROGRAM_KINDS)}
          defaultValue={program?.kind}
        />
        <Field
          name="code"
          label={t('code')}
          hint={t('codeHint')}
          defaultValue={program?.code}
          dir="ltr"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field
          name="defaultDurationMin"
          label={t('duration')}
          type="number"
          inputMode="numeric"
          defaultValue={program?.defaultDurationMin ?? 45}
        />
        <Field
          name="defaultCapacity"
          label={t('capacity')}
          type="number"
          inputMode="numeric"
          defaultValue={program?.defaultCapacity ?? 6}
        />
        <Field
          name="minAgeMonths"
          label={t('minAge')}
          type="number"
          inputMode="numeric"
          defaultValue={program?.minAgeMonths ?? ''}
        />
        <Field
          name="maxAgeMonths"
          label={t('maxAge')}
          type="number"
          inputMode="numeric"
          defaultValue={program?.maxAgeMonths ?? ''}
        />
      </div>
      <CheckboxField
        name="parentInWater"
        label={t('parentInWater')}
        defaultChecked={program?.parentInWater ?? false}
      />
      <CheckboxField name="active" label={t('active')} defaultChecked={program?.active ?? true} />
      <div>
        <SubmitButton>{program ? tc('save') : t('create')}</SubmitButton>
      </div>
    </ActionForm>
  );
}
