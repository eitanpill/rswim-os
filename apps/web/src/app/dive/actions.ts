'use server';

import {
  applyLinePlan,
  BookInput,
  bookSession,
  BookingRef,
  cancelBooking,
  checkIn,
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
  setTarget,
  signWaiver,
  SkillToggle,
  TargetInput,
  toggleSkill,
  updateMedical,
} from '@rswim/domain-dive';
import { z } from 'zod';
import type { FormState } from '@/lib/form-state';
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
