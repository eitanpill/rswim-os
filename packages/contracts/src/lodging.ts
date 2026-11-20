/**
 * Lodging (an optional module for a swim school or a freediving club with rooms to sleep in, docs/LODGING.md):
 * the room kinds, how a room is sold, its bathroom, the booking's life and the room's housekeeping state.
 */
export const ROOM_KINDS = ['single', 'double', 'family', 'dorm', 'suite', 'other'] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

/** A room is booked whole (a family room) or bed by bed (a shared dorm). */
export const ROOM_SOLD_BY = ['room', 'bed'] as const;
export type RoomSoldBy = (typeof ROOM_SOLD_BY)[number];

/** A toilet or a shower inside the room, or one the guests share down the hall. */
export const ROOM_FACILITIES = ['private', 'shared'] as const;
export type RoomFacility = (typeof ROOM_FACILITIES)[number];

export const HOUSEKEEPING_STATES = ['clean', 'dirty', 'out_of_order'] as const;
export type HousekeepingState = (typeof HOUSEKEEPING_STATES)[number];

/** held: waiting for the guest (or payment); confirmed; checked_in; checked_out; cancelled. */
export const STAY_STATUSES = [
  'held',
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
] as const;
export type StayStatus = (typeof STAY_STATUSES)[number];
/** Statuses that hold a room or a bed on their nights. */
export const STAY_HOLDING: readonly StayStatus[] = [
  'held',
  'confirmed',
  'checked_in',
  'checked_out',
];

export const STAY_SOURCES = ['office', 'bot', 'online'] as const;
export type StaySource = (typeof STAY_SOURCES)[number];

/** How many nights ahead the board shows. */
export const LODGING_BOARD_NIGHTS = 14;
