'use server';

import {
  applyLinePlan,
  BookInput,
  bookSession,
  BookingRef,
  cancelBooking,
  checkIn,
  checkoutView,
  myDiverId,
  closeIncident,
  ConditionsInput,
  IncidentClose,
  IncidentInput,
  LeadMove,
  LogInput,
  logDive,
  markNoShow,
  MedicalInput,
  moveLead,
  recordConditions,
  RentalRef,
  RentInput,
  rentGear,
  reportIncident,
  returnGear,
  SessionRef,
  SessionStatusInput,
  setSessionStatus,
  PassSale,
  sellPass,
  setTarget,
  SettleInput,
  settleBooking,
  signWaiver,
  SkillToggle,
  TargetInput,
  toggleSkill,
  updateMedical,
} from '@rswim/domain-dive';
import { DIVE_PASS_KINDS } from '@rswim/contracts';
import { confirmCheckout, confirmPassCheckout } from '@rswim/domain-dive/checkout';
import { toDomainError } from '@rswim/domain-core';
import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { z } from 'zod';
import type { FormState } from '@/lib/form-state';
import { db, withSession } from '@/lib/db';
import { fakeCheckout } from '@/lib/dive-payments';
import { runForm } from '@/lib/forms';

/**
 * Every tap in the club. Each runs as the signed-in person under RLS; the database refuses what their role may not
 * do (a customer cancelling someone else's booking, an instructor ringing up a sale) and guards capacity and gear.
 */
const ALL = [
  '/dive/owner',
  '/dive/manager',
  '/dive/office',
  '/dive/instructor',
  '/dive/me',
  '/dive/divers',
];
const opts = (success = 'forms.saved') => ({ revalidate: ALL, success });

export async function checkInAction(_: FormState, fd: FormData) {
  return runForm(fd, BookingRef, (tx, _c, i) => checkIn(tx, i), opts('dive.done.checkedIn'));
}

export async function noShowAction(_: FormState, fd: FormData) {
  return runForm(fd, BookingRef, (tx, _c, i) => markNoShow(tx, i), opts());
}

export async function cancelBookingAction(_: FormState, fd: FormData) {
  return runForm(fd, BookingRef, (tx, _c, i) => cancelBooking(tx, i), opts('dive.done.cancelled'));
}

export async function bookAction(_: FormState, fd: FormData) {
  return runForm(fd, BookInput, (tx, ctx, i) => bookSession(tx, ctx, i), opts('dive.done.booked'));
}

/** The diver books online: a paid session goes straight to checkout, since it only counts once it is paid. */
export async function bookOnlineAction(_: FormState, fd: FormData) {
  return runForm(fd, BookInput, (tx, ctx, i) => bookSession(tx, ctx, i), {
    ...opts('dive.done.booked'),
    redirectTo: (r) =>
      r.status === 'pending_payment' ? `/dive/me/pay/${r.bookingId}` : '/dive/me?booked=1',
  });
}

/** The desk takes the money for a booking waiting for payment, which confirms it. */
export async function settleBookingAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    SettleInput,
    (tx, ctx, i) => settleBooking(tx, ctx, i),
    opts('dive.done.paid'),
  );
}

/** The desk sells a pass to a diver, or gives one without charge. */
export async function sellPassAction(_: FormState, fd: FormData) {
  const t = await getTranslations('dive');
  const kind = String(fd.get('kind') ?? '');
  const label = (DIVE_PASS_KINDS as readonly string[]).includes(kind)
    ? t(`passKind.${kind}`)
    : kind;
  return runForm(
    fd,
    PassSale,
    (tx, ctx, i) => sellPass(tx, ctx, i),
    opts('dive.done.passSold'),
    (raw) => ({ ...raw, label }),
  );
}

/** The diver buys a pass online (payment fake until the club's Grow is live); it is issued once paid. */
export async function buyPassAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations();
  const fail = (key: string) => ({ ok: false, errors: {}, message: t(key) });
  if (!fakeCheckout()) return fail('dive.pay.notLive');
  const kind = z.enum(DIVE_PASS_KINDS).safeParse(fd.get('kind'));
  if (!kind.success) return fail('common.errors.notFound');
  const me = await withSession(async (tx, ctx, session) => ({
    diverId: await myDiverId(tx),
    orgId: ctx.orgId,
    userId: session.userId,
  }));
  if (!me.diverId) return fail('dive.errors.noDiver');
  await confirmPassCheckout(db(), {
    orgId: me.orgId,
    userId: me.userId,
    diverId: me.diverId,
    kind: kind.data,
    label: t(`dive.passKind.${kind.data}`),
  });
  for (const p of ALL) revalidatePath(p);
  redirect('/dive/me?pass=1');
}

/**
 * The diver pays on the checkout page. Only the payment fake answers here (local, E2E, the live demo): the booking is
 * checked as the diver (their own, still held), then confirmed the way the provider's callback will confirm it.
 */
export async function payCheckoutAction(_: FormState, fd: FormData): Promise<FormState> {
  const t = await getTranslations();
  const fail = (key: string) => ({ ok: false, errors: {}, message: t(key) });
  if (!fakeCheckout()) return fail('dive.pay.notLive');
  const bookingId = z.uuid().safeParse(fd.get('bookingId'));
  if (!bookingId.success) return fail('common.errors.notFound');
  const found = await withSession(async (tx, ctx, session) => ({
    view: await checkoutView(tx, bookingId.data),
    orgId: ctx.orgId,
    userId: session.userId,
  }));
  if (!found.view) return fail('common.errors.notFound');
  if (found.view.status === 'pending_payment') {
    if (!found.view.holding) return fail('dive.errors.holdLapsed');
    try {
      await confirmCheckout(db(), {
        orgId: found.orgId,
        userId: found.userId,
        bookingId: bookingId.data,
        externalId: `demo_${randomUUID()}`,
      });
    } catch (e) {
      const de = toDomainError(e);
      if (!de) throw e;
      return fail(t.has(de.code) ? de.code : 'forms.errors.invalid');
    }
  }
  for (const p of ALL) revalidatePath(p);
  redirect(`/dive/me?paid=${bookingId.data}`);
}

export async function rentAction(_: FormState, fd: FormData) {
  return runForm(fd, RentInput, (tx, ctx, i) => rentGear(tx, ctx, i), opts('dive.done.rented'));
}

export async function returnAction(_: FormState, fd: FormData) {
  return runForm(fd, RentalRef, (tx, _c, i) => returnGear(tx, i), opts('dive.done.returned'));
}

export async function moveLeadAction(_: FormState, fd: FormData) {
  return runForm(fd, LeadMove, (tx, _c, i) => moveLead(tx, i), opts());
}

export async function logDiveAction(_: FormState, fd: FormData) {
  return runForm(fd, LogInput, (tx, ctx, i) => logDive(tx, ctx, i), opts('dive.done.logged'));
}

export async function reportIncidentAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    IncidentInput,
    (tx, ctx, i) => reportIncident(tx, ctx, i),
    opts('dive.done.reported'),
  );
}

export async function closeIncidentAction(_: FormState, fd: FormData) {
  return runForm(fd, IncidentClose, (tx, _c, i) => closeIncident(tx, i), opts());
}

export async function conditionsAction(_: FormState, fd: FormData) {
  return runForm(fd, ConditionsInput, (tx, ctx, i) => recordConditions(tx, ctx, i), {
    revalidate: ALL,
    success: (call, tr) => tr('dive.done.conditions', { call: tr(`dive.call.${call}`) }),
  });
}

export async function sessionStatusAction(_: FormState, fd: FormData) {
  return runForm(fd, SessionStatusInput, (tx, ctx, i) => setSessionStatus(tx, ctx, i), opts());
}

export async function linePlanAction(_: FormState, fd: FormData) {
  return runForm(fd, SessionRef, (tx, _c, i) => applyLinePlan(tx, i), opts('dive.done.lines'));
}

export async function targetAction(_: FormState, fd: FormData) {
  return runForm(fd, TargetInput, (tx, _c, i) => setTarget(tx, i), opts());
}

export async function skillAction(_: FormState, fd: FormData) {
  return runForm(fd, SkillToggle, (tx, _c, i) => toggleSkill(tx, i), opts());
}

export async function waiverAction(_: FormState, fd: FormData) {
  return runForm(fd, z.object({}), (tx) => signWaiver(tx), opts('dive.done.waiver'));
}

export async function medicalAction(_: FormState, fd: FormData) {
  return runForm(fd, MedicalInput, (tx, _c, i) => updateMedical(tx, i), opts());
}
