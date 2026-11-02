import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { DIVE_INSURANCE_MODES, DIVE_LEVELS, DIVE_PASS_KINDS } from '@rswim/contracts';
import { loadRules, ruleVersions, todayIL } from '@rswim/domain-dive';
import {
  ActionForm,
  CheckboxField,
  Field,
  SelectField,
  SubmitButton,
  TextareaField,
} from '@/components/form';
import { withSession } from '@/lib/db';
import { saveRulesAction } from '../rules-actions';
import { canEditForms, requireDivePage } from '../_ui/access';
import { dateShort } from '../_ui/format';
import { di } from '../_ui/icons';
import { Chip, Empty, Hero, Panel } from '../_ui/kit';

const n = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/**
 * The club's rules (owner and manager): sea limits, divers per instructor, depth progression and ceilings,
 * paperwork, bookings, sign-up and pass prices, saved as a version from a date. The version in effect drives every
 * decision in the system; past versions stay as they were, listed below.
 */
export default async function RulesPage() {
  const { role } = await requireDivePage('manager');
  const t = await getTranslations('dive.rules');
  const tLevel = await getTranslations('dive.levelShort');
  const tPass = await getTranslations('dive.passKind');
  const { current, versions, today } = await withSession(async (tx) => {
    const [current, versions, today] = await Promise.all([
      loadRules(tx),
      ruleVersions(tx),
      todayIL(tx),
    ]);
    return { current, versions, today };
  });
  const r = current.rules;
  const editable = canEditForms(role);
  const inEffect = versions.find((v) => v.id === current.ruleSetId);
  const upcoming = versions.filter((v) => v.effectiveFrom > today);
  const num = { type: 'number', inputMode: 'numeric' as const, required: true };

  return (
    <div className="flex flex-col gap-5" data-testid="rules-page">
      <Hero
        kicker={t('kicker')}
        title={t('title')}
        sub={
          inEffect ? t('inEffectSince', { date: dateShort(inEffect.effectiveFrom) }) : t('defaults')
        }
        aside={
          <Link href="/dive/manager" className="text-sm font-medium text-[var(--dive-sea)]">
            {t('back')}
          </Link>
        }
      />

      {upcoming.length ? (
        <p
          role="status"
          className="rounded-xl border border-[var(--dive-sea)]/40 bg-[var(--dive-sea)]/10 px-3 py-2 text-sm"
          data-testid="rules-upcoming"
        >
          {t('upcoming', { date: dateShort(upcoming[upcoming.length - 1]?.effectiveFrom ?? '') })}
        </p>
      ) : null}

      {!editable ? <p className="text-sm text-ink-muted">{t('readOnly')}</p> : null}

      <ActionForm
        action={saveRulesAction}
        testId="rules-form"
        className="flex flex-col gap-5"
        keepValues
      >
        <fieldset disabled={!editable} className="contents">
          <Panel title={t('sea.title')} icon={di.shield} testId="rules-sea">
            <p className="mb-3 text-sm text-ink-muted">{t('sea.hint')}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field
                name="sea_caution_wind_kts"
                label={t('sea.cautionWind')}
                defaultValue={n(r.sea.caution_wind_kts)}
                {...num}
              />
              <Field
                name="sea_max_wind_kts"
                label={t('sea.maxWind')}
                defaultValue={n(r.sea.max_wind_kts)}
                {...num}
              />
              <Field
                name="sea_min_visibility_m"
                label={t('sea.minVisibility')}
                defaultValue={n(r.sea.min_visibility_m)}
                {...num}
              />
              <Field
                name="sea_caution_wave_cm"
                label={t('sea.cautionWave')}
                defaultValue={n(r.sea.caution_wave_cm)}
                {...num}
              />
              <Field
                name="sea_max_wave_cm"
                label={t('sea.maxWave')}
                defaultValue={n(r.sea.max_wave_cm)}
                {...num}
              />
            </div>
            <CheckboxField
              name="sea_strong_current_no_go"
              label={t('sea.currentNoGo')}
              defaultChecked={r.sea.strong_current_no_go}
            />
          </Panel>

          <Panel title={t('ratio.title')} icon={di.divers} testId="rules-ratio">
            <p className="mb-3 text-sm text-ink-muted">{t('ratio.hint')}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              {(['experience', 'course', 'training', 'workshop', 'trip'] as const).map((k) => (
                <Field
                  key={k}
                  name={`ratio_${k}`}
                  label={t(`ratio.${k}`)}
                  defaultValue={n(r.ratio[k])}
                  {...num}
                />
              ))}
            </div>
          </Panel>

          <Panel title={t('depth.title')} icon={di.water} testId="rules-depth">
            <p className="mb-3 text-sm text-ink-muted">{t('depth.hint')}</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field
                name="depth_progression_step_m"
                label={t('depth.step')}
                defaultValue={n(r.depth.progression_step_m)}
                {...num}
              />
            </div>
            <p className="mb-2 mt-4 text-sm font-semibold">{t('depth.ceilings')}</p>
            <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
              {DIVE_LEVELS.map((l) => (
                <Field
                  key={l}
                  name={`depth_level_${l}`}
                  label={tLevel(String(l))}
                  defaultValue={n(r.depth.level_max_m[l])}
                  {...num}
                />
              ))}
            </div>
          </Panel>

          <Panel title={t('paperwork.title')} icon={di.doc} testId="rules-paperwork">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field
                name="paperwork_medical_valid_months"
                label={t('paperwork.medicalMonths')}
                defaultValue={n(r.paperwork.medical_valid_months)}
                {...num}
              />
              <Field
                name="paperwork_waiver_valid_months"
                label={t('paperwork.waiverMonths')}
                defaultValue={n(r.paperwork.waiver_valid_months)}
                {...num}
              />
              <Field
                name="paperwork_medical_warn_days"
                label={t('paperwork.medicalWarn')}
                defaultValue={n(r.paperwork.medical_warn_days)}
                {...num}
              />
              <SelectField
                name="paperwork_insurance"
                label={t('paperwork.insurance')}
                defaultValue={r.paperwork.insurance}
                options={DIVE_INSURANCE_MODES.map((m) => ({
                  value: m,
                  label: t(`paperwork.insuranceMode.${m}`),
                }))}
              />
              <Field
                name="paperwork_insurance_warn_days"
                label={t('paperwork.insuranceWarn')}
                defaultValue={n(r.paperwork.insurance_warn_days)}
                {...num}
              />
              <Field
                name="staff_cert_warn_days"
                label={t('paperwork.staffCertWarn')}
                defaultValue={n(r.staff.cert_warn_days)}
                {...num}
              />
            </div>
          </Panel>

          <Panel title={t('booking.title')} icon={di.desk} testId="rules-booking">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field
                name="booking_payment_hold_minutes"
                label={t('booking.holdMinutes')}
                defaultValue={n(r.booking.payment_hold_minutes)}
                {...num}
              />
              <Field
                name="gear_rental_grace_min"
                label={t('booking.rentalGrace')}
                defaultValue={n(r.gear.rental_grace_min)}
                {...num}
              />
            </div>
            <CheckboxField
              name="booking_require_payment"
              label={t('booking.requirePayment')}
              defaultChecked={r.booking.require_payment}
            />
            <CheckboxField
              name="registration_self_signup"
              label={t('booking.selfSignup')}
              defaultChecked={r.registration.self_signup}
            />
          </Panel>

          <Panel title={t('passes.title')} icon={di.me} testId="rules-passes">
            <p className="mb-3 text-sm text-ink-muted">{t('passes.hint')}</p>
            <div className="flex flex-col gap-3">
              {DIVE_PASS_KINDS.map((k) => (
                <div key={k} className="grid grid-cols-3 items-end gap-3">
                  <Field
                    name={`pass_${k}_price`}
                    label={`${tPass(k)} · ${t('passes.price')}`}
                    defaultValue={String(r.passes[k].price_agorot / 100)}
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    required
                  />
                  <Field
                    name={`pass_${k}_sessions`}
                    label={t('passes.sessions')}
                    defaultValue={n(r.passes[k].sessions)}
                    placeholder={t('passes.unlimited')}
                    type="number"
                    inputMode="numeric"
                  />
                  <Field
                    name={`pass_${k}_days`}
                    label={t('passes.days')}
                    defaultValue={n(r.passes[k].valid_days)}
                    {...num}
                  />
                </div>
              ))}
            </div>
          </Panel>

          {editable ? (
            <Panel title={t('save.title')} icon={di.shield} testId="rules-save">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <Field
                  name="effectiveFrom"
                  label={t('save.from')}
                  type="date"
                  min={today}
                  defaultValue={today}
                  hint={t('save.fromHint')}
                  required
                />
                <TextareaField name="notes" label={t('save.notes')} rows={2} />
              </div>
              <div className="mt-3">
                <SubmitButton>{t('save.submit')}</SubmitButton>
              </div>
            </Panel>
          ) : null}
        </fieldset>
      </ActionForm>

      <Panel title={t('history.title')} icon={di.doc} flush testId="rules-history">
        {versions.length === 0 ? (
          <Empty>{t('history.none')}</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {versions.map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                data-testid="rules-version"
              >
                <span>
                  <span className="font-medium">
                    {t('history.from', { date: dateShort(v.effectiveFrom) })}
                  </span>
                  {v.notes ? <span className="block text-sm text-ink-muted">{v.notes}</span> : null}
                  <span className="block text-xs text-ink-muted">
                    {t('history.summary', {
                      wind: v.rules.sea.max_wind_kts,
                      course: v.rules.ratio.course,
                      step: v.rules.depth.progression_step_m,
                    })}
                  </span>
                </span>
                {v.id === current.ruleSetId ? (
                  <Chip tone="go" icon={false}>
                    {t('history.current')}
                  </Chip>
                ) : v.effectiveFrom > today ? (
                  <Chip tone="info" icon={false}>
                    {t('history.scheduled')}
                  </Chip>
                ) : (
                  <Chip tone="muted" icon={false}>
                    {t('history.past')}
                  </Chip>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
