/** The rules form: flat fields into a stored version, and the checks that keep a version consistent. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_DIVE_RULES, DIVE_LEVELS, DIVE_PASS_KINDS } from '@rswim/contracts';
import { RulesInput, rulesFromForm } from '../src/services/rules';

/** The defaults, as the form posts them (strings, shekels, ticked checkboxes as "on"). */
function form(over: Record<string, string | undefined> = {}) {
  const d = DEFAULT_DIVE_RULES;
  const f: Record<string, string | undefined> = {
    effectiveFrom: '2030-01-01',
    sea_max_wind_kts: String(d.sea.max_wind_kts),
    sea_caution_wind_kts: String(d.sea.caution_wind_kts),
    sea_max_wave_cm: String(d.sea.max_wave_cm),
    sea_caution_wave_cm: String(d.sea.caution_wave_cm),
    sea_min_visibility_m: String(d.sea.min_visibility_m),
    sea_strong_current_no_go: 'on',
    ratio_experience: String(d.ratio.experience),
    ratio_course: String(d.ratio.course),
    ratio_training: String(d.ratio.training),
    ratio_workshop: String(d.ratio.workshop),
    ratio_trip: String(d.ratio.trip),
    depth_progression_step_m: String(d.depth.progression_step_m),
    paperwork_medical_valid_months: String(d.paperwork.medical_valid_months),
    paperwork_waiver_valid_months: String(d.paperwork.waiver_valid_months),
    paperwork_medical_warn_days: String(d.paperwork.medical_warn_days),
    paperwork_insurance: d.paperwork.insurance,
    paperwork_insurance_warn_days: String(d.paperwork.insurance_warn_days),
    staff_cert_warn_days: String(d.staff.cert_warn_days),
    gear_rental_grace_min: String(d.gear.rental_grace_min),
    booking_require_payment: 'on',
    booking_payment_hold_minutes: String(d.booking.payment_hold_minutes),
    registration_self_signup: 'on',
  };
  for (const l of DIVE_LEVELS) f[`depth_level_${l}`] = String(d.depth.level_max_m[l]);
  for (const k of DIVE_PASS_KINDS) {
    f[`pass_${k}_price`] = String(d.passes[k].price_agorot / 100);
    f[`pass_${k}_sessions`] = d.passes[k].sessions === null ? '' : String(d.passes[k].sessions);
    f[`pass_${k}_days`] = String(d.passes[k].valid_days);
  }
  return { ...f, ...over };
}

describe('the rules form', () => {
  it('posts the defaults back as exactly the defaults', () => {
    expect(rulesFromForm(RulesInput.parse(form()))).toEqual(DEFAULT_DIVE_RULES);
  });

  it('reads unticked boxes as off, shekels as agorot and an empty pass count as unlimited', () => {
    const r = rulesFromForm(
      RulesInput.parse(
        form({
          sea_strong_current_no_go: undefined,
          booking_require_payment: undefined,
          pass_punch5_price: '799.90',
          pass_punch5_sessions: '',
        }),
      ),
    );
    expect(r.sea.strong_current_no_go).toBe(false);
    expect(r.booking.require_payment).toBe(false);
    expect(r.passes.punch5).toEqual({ price_agorot: 79990, sessions: null, valid_days: 120 });
  });

  it('refuses a caution limit above the closing limit, and a level shallower than the one before', () => {
    const wind = RulesInput.safeParse(form({ sea_caution_wind_kts: '25', sea_max_wind_kts: '20' }));
    expect(wind.success).toBe(false);
    expect(wind.error?.issues[0]).toMatchObject({
      path: ['sea_caution_wind_kts'],
      message: 'dive.rules.errors.cautionAboveMax',
    });
    const levels = RulesInput.safeParse(form({ depth_level_3: '10' }));
    expect(levels.error?.issues.map((i) => i.path[0])).toContain('depth_level_3');
  });

  it('refuses numbers out of range and a missing field', () => {
    expect(RulesInput.safeParse(form({ ratio_course: '0' })).success).toBe(false);
    expect(RulesInput.safeParse(form({ ratio_course: '' })).success).toBe(false);
  });
});
