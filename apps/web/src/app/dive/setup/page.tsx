import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { DIVE_AGENCIES, DIVE_LEVELS, DIVE_PROGRAM_KINDS, DIVE_SITE_KINDS } from '@rswim/contracts';
import { clubSetup, todayIL } from '@rswim/domain-dive';
import {
  ActionForm,
  CheckboxField,
  Field,
  ResultValue,
  SelectField,
  SubmitButton,
} from '@/components/form';
import { withSession } from '@/lib/db';
import {
  addSessionsAction,
  inviteTeamAction,
  saveProgramAction,
  saveSiteAction,
} from '../setup-actions';
import { requireDivePage } from '../_ui/access';
import { shekels } from '../_ui/format';
import { di } from '../_ui/icons';
import { Chip, Empty, Hero, Panel } from '../_ui/kit';

const price = (agorot: number) => (agorot / 100).toFixed(agorot % 100 ? 2 : 0);

/**
 * Setting the club up (owner and manager): the first steps a new club takes, its dive sites, its programs and
 * prices (the starter kit's, to edit), sessions on the calendar, and a link for each new team member.
 */
export default async function SetupPage() {
  const { role } = await requireDivePage('setup');
  const t = await getTranslations('dive.setup');
  const tLevel = await getTranslations('dive.levelShort');
  const tStaff = await getTranslations('staff');
  const locale = await getLocale();
  const { setup, today } = await withSession(async (tx) => {
    const [setup, today] = await Promise.all([clubSetup(tx), todayIL(tx)]);
    return { setup, today };
  });
  // A new session most often starts tomorrow morning; today's morning may already be gone.
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const openSites = setup.sites.filter((s) => s.active);
  const activePrograms = setup.programs.filter((p) => p.active);
  const done = setup.steps.filter((s) => s.done).length;
  const siteKinds = DIVE_SITE_KINDS.map((k) => ({ value: k, label: t(`siteKind.${k}`) }));
  const programKinds = DIVE_PROGRAM_KINDS.map((k) => ({ value: k, label: t(`programKind.${k}`) }));
  const agencies = DIVE_AGENCIES.map((a) => ({ value: a, label: t(`agency.${a}`) }));
  const levels = DIVE_LEVELS.map((l) => ({ value: String(l), label: tLevel(String(l)) }));
  const num = { type: 'number', inputMode: 'numeric' as const, required: true };

  return (
    <div className="flex flex-col gap-5" data-testid="setup-page">
      <Hero
        kicker={t('kicker')}
        title={t('title')}
        sub={t('progress', { done, total: setup.steps.length })}
        aside={
          <Link
            href={role === 'owner' ? '/dive/owner' : '/dive/manager'}
            className="text-sm font-medium text-[var(--dive-sea)]"
          >
            {t('back')}
          </Link>
        }
      />

      <Panel title={t('steps.title')} icon={di.check} testId="setup-steps">
        <ol className="flex flex-col gap-2">
          {setup.steps.map((s, i) => (
            <li
              key={s.key}
              className="flex items-start gap-3 text-sm"
              data-testid={`setup-step-${s.key}`}
              data-done={s.done}
            >
              <span
                className={
                  s.done
                    ? 'flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--dive-sea)] text-white [&_svg]:size-4'
                    : 'flex size-6 shrink-0 items-center justify-center rounded-full border border-line text-xs text-ink-muted'
                }
              >
                {s.done ? di.check : i + 1}
              </span>
              <span>
                <span className="font-medium">{t(`steps.${s.key}.title`)}</span>
                <span className="block text-ink-muted">{t(`steps.${s.key}.hint`)}</span>
              </span>
            </li>
          ))}
        </ol>
        {!setup.steps.find((s) => s.key === 'forms')?.done ? (
          <Link
            href="/dive/forms"
            className="mt-3 inline-block text-sm font-medium text-[var(--dive-sea)] hover:underline"
            data-testid="setup-to-forms"
          >
            {t('steps.forms.link')}
          </Link>
        ) : null}
      </Panel>

      <Panel title={t('sites.title')} icon={di.anchor} testId="setup-sites">
        {setup.sites.length ? (
          <ul className="mb-4 flex flex-col divide-y divide-line">
            {setup.sites.map((s) => (
              <li key={s.id} className="py-2" data-testid="setup-site">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium">{s.name}</span>
                    <Chip>{t(`siteKind.${s.kind}`)}</Chip>
                    <span className="text-ink-muted">{t('sites.depth', { m: s.maxDepthM })}</span>
                    {!s.active ? <Chip tone="muted">{t('closed')}</Chip> : null}
                  </summary>
                  <ActionForm
                    action={saveSiteAction}
                    className="mt-3 flex flex-col gap-3"
                    keepValues
                  >
                    <input type="hidden" name="id" value={s.id} />
                    <SiteFields
                      t={t}
                      kinds={siteKinds}
                      values={{
                        name: s.name,
                        kind: s.kind,
                        maxDepthM: s.maxDepthM,
                        meetingPoint: s.meetingPoint ?? '',
                        hasLine: s.hasLine,
                      }}
                    />
                    <CheckboxField
                      name="active"
                      label={t('sites.open')}
                      defaultChecked={s.active}
                    />
                    <div>
                      <SubmitButton variant="secondary">{t('save')}</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>{t('sites.none')}</Empty>
        )}
        <ActionForm
          action={saveSiteAction}
          testId="site-form"
          className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-3"
        >
          <p className="text-sm font-semibold">{t('sites.add')}</p>
          <SiteFields t={t} kinds={siteKinds} />
          <input type="hidden" name="active" value="on" />
          <div>
            <SubmitButton data-testid="site-add">{t('sites.addSubmit')}</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel title={t('programs.title')} icon={di.calendar} testId="setup-programs">
        <p className="mb-3 text-sm text-ink-muted">{t('programs.hint')}</p>
        <ul className="mb-4 flex flex-col divide-y divide-line">
          {setup.programs.map((p) => (
            <li key={p.id} className="py-2" data-testid={`setup-program-${p.code}`}>
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.nameHe}</span>
                  <span className="tabular-nums" data-testid="program-price">
                    {shekels(p.priceAgorot, locale)}
                  </span>
                  <span className="text-ink-muted">{tLevel(String(p.minLevel))}</span>
                  {!p.active ? <Chip tone="muted">{t('off')}</Chip> : null}
                </summary>
                <ActionForm
                  action={saveProgramAction}
                  className="mt-3 flex flex-col gap-3"
                  testId={`program-form-${p.code}`}
                  keepValues
                >
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="agency" value={p.agency} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      name="nameHe"
                      label={t('programs.name')}
                      defaultValue={p.nameHe}
                      required
                    />
                    <SelectField
                      name="kind"
                      label={t('programs.kind')}
                      options={programKinds}
                      defaultValue={p.kind}
                    />
                    <Field
                      name="price"
                      label={t('programs.price')}
                      defaultValue={price(p.priceAgorot)}
                      inputMode="decimal"
                      required
                    />
                    <Field
                      name="durationMin"
                      label={t('programs.duration')}
                      defaultValue={String(p.durationMin)}
                      {...num}
                    />
                    <SelectField
                      name="minLevel"
                      label={t('programs.minLevel')}
                      options={levels}
                      defaultValue={String(p.minLevel)}
                    />
                  </div>
                  <CheckboxField
                    name="active"
                    label={t('programs.active')}
                    defaultChecked={p.active}
                  />
                  <div>
                    <SubmitButton variant="secondary" data-testid="program-save">
                      {t('save')}
                    </SubmitButton>
                  </div>
                </ActionForm>
              </details>
            </li>
          ))}
        </ul>
        <ActionForm
          action={saveProgramAction}
          testId="program-add-form"
          className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-3"
        >
          <p className="text-sm font-semibold">{t('programs.add')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="nameHe" label={t('programs.name')} required />
            <SelectField name="kind" label={t('programs.kind')} options={programKinds} />
            <SelectField
              name="agency"
              label={t('programs.agency')}
              options={agencies}
              defaultValue="club"
            />
            <Field name="price" label={t('programs.price')} inputMode="decimal" required />
            <Field name="durationMin" label={t('programs.duration')} defaultValue="120" {...num} />
            <SelectField name="minLevel" label={t('programs.minLevel')} options={levels} />
          </div>
          <input type="hidden" name="active" value="on" />
          <div>
            <SubmitButton>{t('programs.addSubmit')}</SubmitButton>
          </div>
        </ActionForm>
      </Panel>

      <Panel title={t('sessions.title')} icon={di.calendar} testId="setup-sessions">
        <p className="mb-3 text-sm text-ink-muted">
          {t('sessions.upcoming', { count: setup.upcomingSessions })}
        </p>
        {openSites.length && activePrograms.length ? (
          <ActionForm
            action={addSessionsAction}
            testId="sessions-form"
            className="flex flex-col gap-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="programId"
                label={t('sessions.program')}
                options={activePrograms.map((p) => ({ value: p.id, label: p.nameHe }))}
              />
              <SelectField
                name="siteId"
                label={t('sessions.site')}
                options={openSites.map((s) => ({ value: s.id, label: s.name }))}
              />
              <Field
                name="date"
                label={t('sessions.date')}
                type="date"
                min={today}
                defaultValue={tomorrow}
                required
              />
              <Field
                name="time"
                label={t('sessions.time')}
                type="time"
                defaultValue="08:00"
                required
              />
              <Field name="capacity" label={t('sessions.capacity')} defaultValue="6" {...num} />
              <SelectField
                name="leadStaffId"
                label={t('sessions.lead')}
                includeEmpty={t('sessions.noLead')}
                options={setup.instructors.map((i) => ({ value: i.id, label: i.name }))}
              />
              <Field
                name="weeks"
                label={t('sessions.weeks')}
                hint={t('sessions.weeksHint')}
                type="number"
                inputMode="numeric"
                defaultValue="1"
              />
            </div>
            <div>
              <SubmitButton data-testid="sessions-add">{t('sessions.submit')}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <Empty>{t('sessions.needSite')}</Empty>
        )}
      </Panel>

      {role === 'owner' ? (
        <Panel title={t('team.title')} icon={di.divers} testId="setup-team">
          <p className="mb-3 text-sm text-ink-muted">{t('team.hint')}</p>
          <ActionForm
            action={inviteTeamAction}
            testId="team-invite-form"
            className="flex flex-col gap-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                name="role"
                label={tStaff('invite.role')}
                options={[
                  { value: 'instructor', label: t('team.instructor') },
                  { value: 'admin', label: t('team.manager') },
                ]}
              />
              <Field name="phoneE164" label={t('team.phone')} type="tel" dir="ltr" />
              <Field name="email" label={t('team.email')} type="email" dir="ltr" />
            </div>
            <ResultValue field="link" label={tStaff('invite.link')} copy={tStaff('invite.copy')} />
            <div>
              <SubmitButton>{tStaff('invite.create')}</SubmitButton>
            </div>
          </ActionForm>
        </Panel>
      ) : null}
    </div>
  );
}

function SiteFields({
  t,
  kinds,
  values,
}: {
  t: Awaited<ReturnType<typeof getTranslations<'dive.setup'>>>;
  kinds: { value: string; label: string }[];
  values?: {
    name: string;
    kind: string;
    maxDepthM: number;
    meetingPoint: string;
    hasLine: boolean;
  };
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field name="name" label={t('sites.name')} defaultValue={values?.name} required />
        <SelectField
          name="kind"
          label={t('sites.kind')}
          options={kinds}
          defaultValue={values?.kind}
        />
        <Field
          name="maxDepthM"
          label={t('sites.maxDepth')}
          type="number"
          inputMode="numeric"
          defaultValue={values ? String(values.maxDepthM) : '20'}
          required
        />
        <Field
          name="meetingPoint"
          label={t('sites.meetingPoint')}
          defaultValue={values?.meetingPoint}
        />
      </div>
      <CheckboxField
        name="hasLine"
        label={t('sites.hasLine')}
        defaultChecked={values?.hasLine ?? true}
      />
    </>
  );
}
