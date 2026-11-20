import { describe, expect, it } from 'vitest';
import {
  leadAttention,
  leadStageAfter,
  leadStageAfterMessage,
  monthSteps,
  sourcesReport,
} from '../src/lead-policies';

describe('leadStageAfter', () => {
  it('opens a lead at the stage that happened', () => {
    expect(leadStageAfter(null, 'talking')).toBe('talking');
  });
  it('only moves forward', () => {
    expect(leadStageAfter('trial_booked', 'talking')).toBe('trial_booked');
    expect(leadStageAfter('talking', 'joined')).toBe('joined');
  });
  it('brings a lost lead back', () => {
    expect(leadStageAfter('lost', 'trial_booked')).toBe('trial_booked');
  });
});

describe('leadStageAfterMessage', () => {
  it('a new number is a new lead, a lost one comes back as new, others stay', () => {
    expect(leadStageAfterMessage(null)).toBe('new');
    expect(leadStageAfterMessage('lost')).toBe('new');
    expect(leadStageAfterMessage('talking')).toBe('talking');
    expect(leadStageAfterMessage('joined')).toBe('joined');
  });
});

describe('leadAttention', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  it('nothing for leads that joined or dropped', () => {
    for (const stage of ['joined', 'lost'] as const)
      expect(
        leadAttention(
          { stage, stageChangedAt: hoursAgo(50), nextActionOn: '2026-11-01' },
          now,
          '2026-11-20',
        ),
      ).toBeNull();
  });
  it('a follow-up due today or before', () => {
    expect(
      leadAttention(
        { stage: 'talking', stageChangedAt: now, nextActionOn: '2026-11-20' },
        now,
        '2026-11-20',
      ),
    ).toBe('follow_up');
    expect(
      leadAttention(
        { stage: 'talking', stageChangedAt: now, nextActionOn: '2026-11-21' },
        now,
        '2026-11-20',
      ),
    ).toBeNull();
  });
  it('a new lead waiting longer than the reply time', () => {
    expect(
      leadAttention(
        { stage: 'new', stageChangedAt: hoursAgo(3), nextActionOn: null },
        now,
        '2026-11-20',
      ),
    ).toBe('reply');
    expect(
      leadAttention(
        { stage: 'new', stageChangedAt: hoursAgo(1), nextActionOn: null },
        now,
        '2026-11-20',
      ),
    ).toBeNull();
    expect(
      leadAttention(
        { stage: 'new', stageChangedAt: hoursAgo(1), nextActionOn: null },
        now,
        '2026-11-20',
        0.5,
      ),
    ).toBe('reply');
  });
});

describe('sources report', () => {
  it('sorts by leads, rates joining and totals', () => {
    const r = sourcesReport([
      { source: 'whatsapp', leads: 4, trials: 2, joined: 1 },
      { source: 'instagram', leads: 6, trials: 3, joined: 3 },
      { source: 'google', leads: 4, trials: 1, joined: 1 },
      { source: 'facebook', leads: 4, trials: 1, joined: 2 },
      { source: 'referral', leads: 0, trials: 0, joined: 0 },
    ]);
    expect(r.rows.map((x) => x.source)).toEqual([
      'instagram',
      'facebook',
      'google',
      'whatsapp',
      'referral',
    ]);
    expect(r.rows[0]?.rate).toBe(50);
    expect(r.rows[4]?.rate).toBeNull();
    expect(r.total).toEqual({ source: 'total', leads: 18, trials: 7, joined: 7, rate: 39 });
    expect(sourcesReport([]).total.rate).toBeNull();
  });
  it('steps months across years', () => {
    expect(monthSteps('2026-01')).toEqual({ prev: '2025-12', next: '2026-02' });
    expect(monthSteps('2026-12')).toEqual({ prev: '2026-11', next: '2027-01' });
  });
});
