'use server';

import { z } from 'zod';
import {
  bookSlot,
  cancelBooking,
  cancelSlot,
  openSlots,
  SlotInput,
} from '@rswim/domain-scheduling';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PATH = '/admin/slots';
const Id = z.object({ id: z.uuid() });

export async function openSlotsAction(_: FormState, fd: FormData) {
  return runForm(fd, SlotInput, (tx, ctx, input) => openSlots(tx, ctx, input), {
    revalidate: PATH,
    success: 'scheduling.slots.opened',
  });
}

export async function bookSlotAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ slotId: z.uuid(), studentId: z.uuid() }),
    (tx, ctx, { slotId, studentId }) => bookSlot(tx, ctx, slotId, studentId),
    { revalidate: PATH },
  );
}

export async function cancelBookingAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => cancelBooking(tx, ctx, id), { revalidate: PATH });
}

export async function cancelSlotAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, ctx, { id }) => cancelSlot(tx, ctx, id), { revalidate: PATH });
}
