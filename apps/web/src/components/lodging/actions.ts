'use server';

import { getTranslations } from 'next-intl/server';
import { formatILS, agorot } from '@rswim/money';
import {
  addRate,
  addRooms,
  BlockInput,
  blockRoom,
  bookStay,
  HousekeepingInput,
  LodgingSettingsInput,
  moveStay,
  PaymentInput,
  PayAtArrivalInput,
  PayRequestInput,
  RateInput,
  RateRemove,
  RateToggle,
  recordPayment,
  removeRate,
  requestPayment,
  RoomInput,
  RoomUpdate,
  saveLodgingSettings,
  setHousekeeping,
  setPayAtArrival,
  setRateActive,
  StayInput,
  StayMove,
  updateRoom,
} from '@rswim/domain-lodging';
import type { FormState } from '@/lib/form-state';
import { runForm, shekelFields } from '@/lib/forms';
import { dmy } from '@/lib/options';
import { requestOrigin } from '@/lib/payments';

/** Lodging lives under both surfaces: a swim school's office and a freediving club. */
const PATHS = ['/admin/lodging', '/dive/lodging'].flatMap((p) => [
  p,
  `${p}/board`,
  `${p}/rooms`,
  `${p}/prices`,
]);
const withStay = (fd: FormData) => {
  const id = String(fd.get('id') ?? fd.get('stayId') ?? '');
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

export async function recordPaymentAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    PaymentInput,
    (tx, ctx, v) => recordPayment(tx, ctx, v),
    {
      revalidate: withStay(fd),
      success: (r, tr) =>
        tr(r.confirmed ? 'lodging.pay.recordedConfirmed' : 'lodging.pay.recorded'),
    },
    shekelFields('amount'),
  );
}

export async function requestPaymentAction(_: FormState, fd: FormData) {
  const t = await getTranslations('lodging.pay');
  const publicUrl = await requestOrigin();
  return runForm(
    fd,
    PayRequestInput,
    (tx, ctx, v) =>
      requestPayment(tx, ctx, v, {
        publicUrl,
        description: (s) =>
          t('description', { name: s.guestName, from: dmy(s.checkIn), to: dmy(s.checkOut) }),
        message: (url, amount) =>
          t(v.what === 'deposit' ? 'messageDeposit' : 'messageBalance', {
            amount: formatILS(agorot(amount)),
            url,
          }),
      }),
    {
      revalidate: withStay(fd),
      success: (r, tr) => tr(r.sent ? 'lodging.pay.linkSent' : 'lodging.pay.linkMade'),
    },
  );
}

/** The guest pays the rest at the desk on arrival (cash or card), or goes back to paying by link. */
export async function payAtArrivalAction(_: FormState, fd: FormData) {
  return runForm(fd, PayAtArrivalInput, (tx, _ctx, v) => setPayAtArrival(tx, v), {
    revalidate: withStay(fd),
    success: fd.get('on') ? 'lodging.pay.atArrivalOn' : 'lodging.pay.atArrivalOff',
  });
}

/** Closes a room, or one bed of a dorm ("roomId:bedId"), for repair on some nights. */
export async function blockRoomAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    BlockInput,
    (tx, ctx, v) => blockRoom(tx, ctx, v),
    {
      revalidate: PATHS,
      success: (_r, tr) => tr('lodging.block.saved'),
      errorField: (path) =>
        path[0] === 'roomId' || path[0] === 'bedId' ? 'target' : String(path[0] ?? '_'),
    },
    ({ target, ...raw }) => {
      const [roomId, bedId] = String(target ?? '').split(':');
      return { ...raw, roomId, bedId: bedId ?? null };
    },
  );
}
