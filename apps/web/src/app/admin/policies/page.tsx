import { getTranslations } from 'next-intl/server';
import {
  DEFAULT_ORG_RULES,
  getRule,
  policyFields,
  type PolicyField,
  type PolicyRules,
  type ScopeType,
} from '@rswim/contracts';
import {
  listPolicyVersions,
  listPrograms,
  resolvePolicyFor,
  type PolicyScope,
  type ResolvedPolicy,
} from '@rswim/domain-settings';
import { listVenues } from '@rswim/domain-venues';
import { buttonVariants, Card, CardTitle, EmptyState, PageHeader } from '@rswim/ui';
import { ActionForm, Field, inputClass, SubmitButton } from '@/components/form';
import { withSession } from '@/lib/db';
import { dmy, todayIL } from '@/lib/options';
import { createPolicyVersionAction } from './actions';
import { PolicyFieldInput } from './policy-field';
import { SECTION_ORDER } from './sections';

type Search = { venue?: string; program?: string };

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const q = await searchParams;
  const t = await getTranslations('policies');
  const tp = await getTranslations('policy');
  const today = todayIL();
  const venueId = q.venue || null;
  const programId = q.program || null;
  const scopeType: ScopeType =
    venueId && programId ? 'venue_program' : venueId ? 'venue' : programId ? 'program' : 'org';
  const scope: PolicyScope = { scopeType, venueId, programId };
  const isOrg = scopeType === 'org';

  const { venues, programs, versions, parent } = await withSession(async (tx) => {
    const [venues, programs, versions] = await Promise.all([
      listVenues(tx),
      listPrograms(tx),
      listPolicyVersions(tx, scope),
    ]);
    // What this scope would inherit if it set nothing: shown next to each field.
    const parent = isOrg
      ? null
      : await resolvePolicyFor(tx, { date: today, venueId, programId }, scope);
    return { venues, programs, versions, parent };
  });

  const current = versions.find(
    (v) => v.effectiveFrom <= today && (!v.effectiveTo || v.effectiveTo > today),
  );
  const latest = versions[0];
  const base: PolicyRules =
    (latest?.rules as PolicyRules | undefined) ?? (isOrg ? DEFAULT_ORG_RULES : {});
  const sourceOf = (resolved: ResolvedPolicy, path: string) => {
    const src = resolved.sources.find((s) => s.id === resolved.origin[path]);
    return src ? t(`scope.${src.scopeType}`) : t('nowhere');
  };

  const fields = policyFields();
  const sections = SECTION_ORDER.map((s) => ({
    key: s,
    fields: fields.filter((f) => f.path.startsWith(`${s}.`)),
  })).filter((s) => s.fields.length > 0);
  const scopeName = [
    venues.find((v) => v.id === venueId)?.name,
    programs.find((p) => p.id === programId)?.nameHe,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />
      <div className="flex flex-col gap-4">
        <Card>
          <CardTitle>{t('scopeTitle')}</CardTitle>
          <form method="get" className="grid gap-3 sm:grid-cols-3" data-testid="policy-scope">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('venue')}
              <select name="venue" defaultValue={venueId ?? ''} className={inputClass}>
                <option value="">{t('allVenues')}</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {t('program')}
              <select name="program" defaultValue={programId ?? ''} className={inputClass}>
                <option value="">{t('allPrograms')}</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nameHe}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                {t('show')}
              </button>
            </div>
          </form>
          <p className="mt-3 text-sm text-ink-muted">
            {isOrg
              ? t('orgHint')
              : t('scopeHint', { scope: t(`scope.${scopeType}`), name: scopeName })}
          </p>
        </Card>

        <Card>
          <CardTitle>{t('versions')}</CardTitle>
          {versions.length === 0 ? (
            <EmptyState title={isOrg ? t('noVersionsOrg') : t('noVersions')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {versions.map((v) => (
                <li key={v.id} className="rounded-xl border border-line p-3">
                  <p className="font-medium">
                    {t('versionFrom', { date: dmy(v.effectiveFrom) })}
                    {v.id === current?.id
                      ? ` · ${t('inEffect')}`
                      : v.effectiveFrom > today
                        ? ` · ${t('future')}`
                        : ''}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {t('changes', { count: countLeaves(v.rules as PolicyRules) })}
                    {v.notes ? ` · ${v.notes}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle>{t('newVersion')}</CardTitle>
          <p className="mb-3 text-sm text-ink-muted">
            {isOrg ? t('newVersionOrgHint') : t('newVersionScopeHint')}
          </p>
          <ActionForm action={createPolicyVersionAction.bind(null, scope)} testId="policy-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                name="effectiveFrom"
                label={t('effectiveFrom')}
                type="date"
                defaultValue={today}
              />
              <Field name="notes" label={t('notes')} />
            </div>
            {sections.map((s) => (
              <details
                key={s.key}
                className="rounded-xl border border-line p-3"
                open={s.key === 'absence' || s.key === 'makeup'}
              >
                <summary className="min-h-tap cursor-pointer font-semibold">
                  {tp(`sections.${s.key}`)}
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                  {s.fields.map((f) => (
                    <PolicyFieldInput
                      key={f.path}
                      field={f}
                      label={tp(`fields.${f.path}`)}
                      value={getRule(base, f.path)}
                      isOrg={isOrg}
                      inherited={
                        parent
                          ? t('inherited', {
                              value: describe(f, getRule(parent.rules, f.path), tp, t),
                              source: sourceOf(parent, f.path),
                            })
                          : undefined
                      }
                      options={
                        f.type === 'enum' || f.type === 'multi'
                          ? f.options.map((o) => ({ value: o, label: tp(`options.${o}`) }))
                          : []
                      }
                      labels={{
                        inherit: t('inherit'),
                        yes: t('yes'),
                        no: t('no'),
                        override: t('override'),
                        unit: f.type === 'int' && f.unit ? tp(`units.${f.unit}`) : '',
                      }}
                    />
                  ))}
                </div>
              </details>
            ))}
            <div>
              <SubmitButton>{t('save')}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}

function countLeaves(rules: PolicyRules): number {
  const walk = (o: unknown): number =>
    o && typeof o === 'object' && !Array.isArray(o)
      ? Object.values(o).reduce<number>((n, v) => n + walk(v), 0)
      : 1;
  return walk(rules);
}

type T = (key: string, values?: Record<string, string | number>) => string;

function describe(f: PolicyField, value: unknown, tp: T, t: T): string {
  if (value === undefined) return t('notSet');
  if (f.type === 'boolean') return value ? t('yes') : t('no');
  if (f.type === 'enum') return tp(`options.${String(value)}`);
  if (f.type === 'multi') {
    const list = value as string[];
    return list.length ? list.map((o) => tp(`options.${o}`)).join(', ') : t('none');
  }
  const n = f.unit === 'agorot' || f.unit === 'bp' ? Number(value) / 100 : Number(value);
  return f.unit ? `${n} ${tp(`units.${f.unit}`)}` : String(n);
}
