/**
 * After-school transport (brief §6.10): routes from a school to the pool and back, each day's run, and what the escort
 * taps on the way. Run events are in order; rider events are per child.
 */
import { z } from 'zod';

/** planned → underway → done; a run can be cancelled before it leaves. */
export const RUN_STATUSES = ['planned', 'underway', 'done', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** The run's stages, in the order they happen. Each happens once per run. */
export const RUN_STAGES = [
  'left_school',
  'arrived_pool',
  'in_water',
  'out_of_water',
  'left_pool',
  'run_done',
] as const;
export const RunStage = z.enum(RUN_STAGES);
export type RunStage = z.infer<typeof RunStage>;

/** What happens to one child on a run: on board at the school, not at the pickup, dropped off at their point. */
export const RIDER_MARKS = ['boarded', 'missing', 'dropped_off'] as const;
export const RiderMark = z.enum(RIDER_MARKS);
export type RiderMark = z.infer<typeof RiderMark>;

export const RUN_EVENT_KINDS = [...RUN_STAGES, ...RIDER_MARKS] as const;
export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

/** The stages families hear about, each its own automation (and template) the owner can switch off. */
export const NOTIFIED_STAGES = {
  left_school: 'transport.left_school',
  arrived_pool: 'transport.arrived_pool',
  left_pool: 'transport.left_pool',
} as const satisfies Partial<Record<RunStage, string>>;
