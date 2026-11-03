import { describe, expect, it } from 'vitest';
import { AGENT_PROFILE_LEVELS } from '@rswim/contracts';
import {
  agentGate,
  capLevel,
  effectiveLevels,
  levelsWithinCeiling,
  matchingProfile,
  undoable,
  type AgentSettingsView,
  type GateFacts,
} from '../src/agent-policies';

const settings = (s: Partial<AgentSettingsView> = {}): AgentSettingsView => ({
  profile: 'careful',
  levels: {},
  maxAutoPerDay: 30,
  maxAutoPaymentAgorot: 30000,
  paused: false,
  ...s,
});

const facts = (f: Partial<GateFacts> = {}): GateFacts => ({
  level: 'auto',
  paused: false,
  ranAloneToday: 0,
  maxAutoPerDay: 30,
  amountAgorot: null,
  maxAutoPaymentAgorot: 30000,
  ...f,
});

describe('levels', () => {
  it('takes the lower of two levels', () => {
    expect(capLevel('auto', 'approve')).toBe('approve');
    expect(capLevel('off', 'auto')).toBe('off');
  });

  it('uses the profile, then what the owner set, never above a kind ceiling', () => {
    const careful = effectiveLevels(settings());
    expect(careful.report_absence).toBe('auto');
    expect(careful.move_student).toBe('approve');
    expect(careful.open_makeup_slots).toBe('suggest');
    const set = effectiveLevels(settings({ levels: { move_student: 'auto', freeze: 'off' } }));
    expect(set.move_student).toBe('auto');
    expect(set.freeze).toBe('off');
    // Autopilot cannot send free text or cancel lessons on its own.
    const pilot = effectiveLevels(settings({ profile: 'autopilot' }));
    expect(pilot.payment_link).toBe('auto');
    expect(pilot.message_family).toBe('approve');
    expect(pilot.cancel_lessons).toBe('approve');
  });

  it('knows when the table still matches its profile', () => {
    expect(matchingProfile(settings())).toBe('careful');
    expect(
      matchingProfile(settings({ profile: 'balanced', levels: AGENT_PROFILE_LEVELS.balanced })),
    ).toBe('balanced');
    expect(matchingProfile(settings({ levels: { freeze: 'off' } }))).toBeNull();
  });

  it('refuses a level above a ceiling', () => {
    expect(levelsWithinCeiling({ move_student: 'auto', message_family: 'approve' })).toEqual({
      ok: true,
    });
    expect(levelsWithinCeiling({ cancel_lessons: 'auto' })).toEqual({
      ok: false,
      kind: 'cancel_lessons',
    });
  });
});

describe('agentGate', () => {
  it('refuses a kind that is off', () => {
    expect(agentGate(facts({ level: 'off' }))).toEqual({
      route: 'refuse',
      code: 'agent.errors.off',
    });
  });

  it('waits for the owner below auto', () => {
    expect(agentGate(facts({ level: 'suggest' }))).toEqual({ route: 'wait', reason: 'level' });
    expect(agentGate(facts({ level: 'approve' }))).toEqual({ route: 'wait', reason: 'level' });
  });

  it('runs on auto unless paused, over the daily cap or over the amount cap', () => {
    expect(agentGate(facts())).toEqual({ route: 'run' });
    expect(agentGate(facts({ paused: true }))).toEqual({ route: 'wait', reason: 'paused' });
    expect(agentGate(facts({ ranAloneToday: 30 }))).toEqual({
      route: 'wait',
      reason: 'daily_cap',
    });
    expect(agentGate(facts({ amountAgorot: 30001 }))).toEqual({
      route: 'wait',
      reason: 'amount_cap',
    });
    expect(agentGate(facts({ amountAgorot: 30000 }))).toEqual({ route: 'run' });
  });
});

describe('undoable', () => {
  it('can take back moves, slots and payment links, not messages', () => {
    expect(undoable('move_student')).toBe(true);
    expect(undoable('payment_link')).toBe(true);
    expect(undoable('message_family')).toBe(false);
  });
});
