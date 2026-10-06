import 'server-only';
import { addDays } from '@rswim/calendar';
import type { Tx } from '@rswim/db';
import {
  bookingsOfCredits,
  childProgress,
  listCredits,
  listNotices,
} from '@rswim/domain-attendance';
import { portalRequestsOf, seatChangesOf } from '@rswim/domain-billing';
import { formsDueFor } from '@rswim/domain-enrollment';
import { getHousehold, searchHouseholds } from '@rswim/domain-people';
import { placesByIds, seatsOfStudent, upcomingSessionsOfStudent } from '@rswim/domain-scheduling';
import { runsOnDate } from '@rswim/domain-transport';
import { todayIL } from '@/lib/options';

/** The signed-in parent's household (RLS shows them only their own). */
export async function myHousehold(tx: Tx) {
  const [h] = await searchHouseholds(tx, '', 1);
  return h ? getHousehold(tx, h.id) : null;
}

/**
 * What the family portal shows: each child's lessons in the next two weeks with any notice already sent, live makeup
 * credits with their bookings, and the forms still owed.
 */
export async function familyOverview(tx: Tx) {
  const family = await myHousehold(tx);
  if (!family) return null;
  const ids = family.students.map((s) => s.id);
  const until = addDays(todayIL(), 14);
  const [lessons, notices, credits, forms] = await Promise.all([
    Promise.all(
      family.students.map(async (s) => ({
        student: s,
        sessions: await upcomingSessionsOfStudent(tx, s.id, until),
      })),
    ),
    ids.length ? listNotices(tx, { studentIds: ids, limit: 100 }) : Promise.resolve([]),
    ids.length
      ? listCredits(tx, { studentIds: ids, statuses: ['open', 'booked'] })
      : Promise.resolve([]),
    formsDueFor(tx, family.household.id),
  ]);
  const bookings = await bookingsOfCredits(
    tx,
    credits.map((c) => c.id),
  );
  return { family, lessons, notices, credits, bookings, forms };
}

/**
 * One child's card: the coming lessons, their groups with any freeze or leaving decision, the family's own requests
 * and the progress on their level. Null when the child is not in the signed-in parent's family.
 */
export async function childOverview(tx: Tx, studentId: string) {
  const family = await myHousehold(tx);
  const student = family?.students.find((s) => s.id === studentId);
  if (!family || !student) return null;
  const today = todayIL();
  const [sessions, seats, [progress]] = await Promise.all([
    upcomingSessionsOfStudent(tx, student.id, addDays(today, 14)),
    seatsOfStudent(tx, student.id, today),
    childProgress(tx, [{ id: student.id, levelId: student.levelId }]),
  ]);
  const ids = seats.map((s) => s.enrollmentId);
  const [places, changes, requests, runs] = await Promise.all([
    placesByIds(tx, ids),
    seatChangesOf(tx, ids),
    portalRequestsOf(tx, ids),
    runsOnDate(tx, today),
  ]);
  // Today's after-school ride, if the child is on one (RLS shows a family only their own child on it).
  const ride = runs.find((r) => r.riders.some((x) => x.studentId === student.id)) ?? null;
  return { family, student, sessions, places, changes, requests, progress, ride };
}
