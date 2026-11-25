'use server';

import {
  addRate,
  addRooms,
  bookStay,
  HousekeepingInput,
  LodgingSettingsInput,
  moveStay,
  RateInput,
  RateRemove,
  RateToggle,
  removeRate,
  RoomInput,
  RoomUpdate,
  saveLodgingSettings,
  setHousekeeping,
  setRateActive,
  StayInput,
  StayMove,
  updateRoom,
} from '@rswim/domain-lodging';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

/** Lodging lives under both surfaces: a swim school's office and a freediving club. */
const PATHS = ['/admin/lodging', '/dive/lodging'].flatMap((p) => [
  p,
  `${p}/board`,
  `${p}/rooms`,
  `${p}/prices`,
]);
const withStay = (fd: FormData) => {
  const id = String(fd.get('id') ?? '');
  return [...PATHS, `/admin/lodging/stays/${id}`, `/dive/lodging/stays/${id}`];
};

export async function saveLodgingSettingsAction(_: FormState, fd: FormData) {
  return runForm(fd, LodgingSettingsInput, (tx, ctx, v) => saveLodgingSettings(tx, ctx, v), {
    revalidate: PATHS,
  });
}

export async function addRoomsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    RoomInput,
    (tx, ctx, v) => addRooms(tx, ctx, v),
    {
      revalidate: PATHS,
      success: (ids, tr) => tr('lodging.rooms.added', { n: ids.length }),
    },
    shekelFields('priceNight'),
  );
}

export async function updateRoomAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    RoomUpdate,
    (tx, ctx, v) => updateRoom(tx, ctx, v),
    {
      revalidate: PATHS,
    },
    shekelFields('priceNight'),
  );
}

export async function housekeepingAction(_: FormState, fd: FormData) {
  return runForm(fd, HousekeepingInput, (tx, _ctx, v) => setHousekeeping(tx, v), {
    revalidate: PATHS,
  });
}

export async function bookStayAction(_: FormState, fd: FormData) {
  return runForm(fd, StayInput, (tx, ctx, v) => bookStay(tx, ctx, v), {
    revalidate: PATHS,
    success: 'lodging.board.booked',
  });
}

export async function moveStayAction(_: FormState, fd: FormData) {
  return runForm(fd, StayMove, (tx, _ctx, v) => moveStay(tx, v), {
    revalidate: withStay(fd),
    success: 'lodging.moved',
  });
}

export async function addRateAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    RateInput,
    (tx, ctx, v) => addRate(tx, ctx, v),
    { revalidate: PATHS, success: 'lodging.prices.added' },
    // A fixed price when one is typed, otherwise the percent.
    (raw) => {
      const priced = shekelFields('priceNight')(raw);
      return { ...priced, mode: priced.priceNight === undefined ? 'percent' : 'fixed' };
    },
  );
}

export async function rateActiveAction(_: FormState, fd: FormData) {
  return runForm(fd, RateToggle, (tx, _ctx, v) => setRateActive(tx, v), { revalidate: PATHS });
}

export async function removeRateAction(_: FormState, fd: FormData) {
  return runForm(fd, RateRemove, (tx, _ctx, v) => removeRate(tx, v), {
    revalidate: PATHS,
    success: 'lodging.prices.removed',
  });
}
