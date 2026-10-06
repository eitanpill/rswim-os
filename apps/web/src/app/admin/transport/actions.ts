'use server';

import { z } from 'zod';
import { requiredDate } from '@rswim/contracts';
import {
  addRider,
  cancelRun,
  createRoute,
  createSchool,
  endRider,
  EndRiderInput,
  MarkInput,
  markRider,
  OpenRunInput,
  openRun,
  planRuns,
  recordStage,
  removeEvent,
  RiderInput,
  RiderPointInput,
  RouteInput,
  SchoolInput,
  setRouteActive,
  StageInput,
  updateRiderPoint,
  updateRoute,
  updateSchool,
} from '@rswim/domain-transport';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';
import { todayIL } from '@/lib/options';

const Id = z.object({ id: z.uuid() });
const TODAY = '/admin/transport';
const ROUTES = '/admin/transport/routes';
const SCHOOLS = '/admin/transport/schools';
const route = (id: string) => `${ROUTES}/${id}`;

export async function planRunsAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ date: requiredDate() }),
    (tx, ctx, { date }) => planRuns(tx, ctx, date),
    {
      revalidate: TODAY,
      success: (n, tr) => tr('transport.admin.planned', { n }),
    },
  );
}

export async function openRunAction(_: FormState, fd: FormData) {
  return runForm(fd, OpenRunInput, (tx, ctx, input) => openRun(tx, ctx, input), {
    revalidate: TODAY,
    success: 'transport.admin.opened',
  });
}

export async function cancelRunAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => cancelRun(tx, id), { revalidate: TODAY });
}

export async function officeStageAction(_: FormState, fd: FormData) {
  return runForm(fd, StageInput, (tx, ctx, input) => recordStage(tx, ctx, input), {
    revalidate: TODAY,
  });
}

export async function officeMarkAction(_: FormState, fd: FormData) {
  return runForm(fd, MarkInput, (tx, ctx, input) => markRider(tx, ctx, input), {
    revalidate: TODAY,
  });
}

export async function removeEventAction(_: FormState, fd: FormData) {
  return runForm(fd, Id, (tx, _ctx, { id }) => removeEvent(tx, id), { revalidate: TODAY });
}

export async function createSchoolAction(_: FormState, fd: FormData) {
  return runForm(fd, SchoolInput, (tx, ctx, input) => createSchool(tx, ctx, input), {
    revalidate: SCHOOLS,
    success: 'forms.saved',
  });
}

export async function updateSchoolAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    SchoolInput.extend({ id: z.uuid() }),
    (tx, _ctx, { id, ...input }) => updateSchool(tx, id, input),
    { revalidate: SCHOOLS, success: 'forms.saved' },
  );
}

export async function createRouteAction(_: FormState, fd: FormData) {
  return runForm(fd, RouteInput, (tx, ctx, input) => createRoute(tx, ctx, input), {
    redirectTo: (id) => route(id),
  });
}

export async function updateRouteAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    RouteInput.extend({ id: z.uuid() }),
    (tx, _ctx, { id, ...input }) => updateRoute(tx, id, input).then(() => id),
    { revalidate: [ROUTES], success: 'forms.saved' },
  );
}

export async function setRouteActiveAction(_: FormState, fd: FormData) {
  return runForm(
    fd,
    z.object({ id: z.uuid(), active: z.enum(['true', 'false']) }),
    (tx, _ctx, { id, active }) => setRouteActive(tx, id, active === 'true'),
    { revalidate: ROUTES },
  );
}

export async function addRiderAction(_: FormState, fd: FormData) {
  return runForm(fd, RiderInput, (tx, ctx, input) => addRider(tx, ctx, input), {
    revalidate: ROUTES,
    success: 'transport.admin.riderAdded',
  });
}

export async function updateRiderPointAction(_: FormState, fd: FormData) {
  return runForm(fd, RiderPointInput, (tx, _ctx, input) => updateRiderPoint(tx, input), {
    revalidate: ROUTES,
    success: 'forms.saved',
  });
}

export async function endRiderAction(_: FormState, fd: FormData) {
  return runForm(fd, EndRiderInput, (tx, _ctx, input) => endRider(tx, input, todayIL()), {
    revalidate: ROUTES,
  });
}
