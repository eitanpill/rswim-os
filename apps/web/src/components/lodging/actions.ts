'use server';

import {
  addRooms,
  bookStay,
  HousekeepingInput,
  LodgingSettingsInput,
  moveStay,
  RoomInput,
  RoomUpdate,
  saveLodgingSettings,
  setHousekeeping,
  StayInput,
  StayMove,
  updateRoom,
} from '@rswim/domain-lodging';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';

/** Lodging lives under both surfaces: a swim school's office and a freediving club. */
const PATHS = ['/admin/lodging', '/dive/lodging'].flatMap((p) => [p, `${p}/board`, `${p}/rooms`]);
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
