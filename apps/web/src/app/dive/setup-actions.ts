'use server';

import { headers } from 'next/headers';
import {
  addSessions,
  ProgramInput,
  saveProgram,
  saveSite,
  SessionsInput,
  SiteInput,
} from '@rswim/domain-dive';
import { createInvite, InviteInput } from '@rswim/domain-staff';
import type { FormState } from '@/lib/form-state';
import { runForm } from '@/lib/forms';

const PAGES = ['/dive/setup', '/dive/owner', '/dive/manager', '/dive/office', '/dive/instructor'];

/** The owner or the manager adds or edits a dive site (the database checks the office role and the plan). */
export async function saveSiteAction(_: FormState, fd: FormData) {
  return runForm(fd, SiteInput, (tx, ctx, input) => saveSite(tx, ctx, input), {
    revalidate: PAGES,
    success: 'dive.setup.saved',
  });
}

/** Edits a program's name, price and level, or adds a new one. */
export async function saveProgramAction(_: FormState, fd: FormData) {
  return runForm(fd, ProgramInput, (tx, ctx, input) => saveProgram(tx, ctx, input), {
    revalidate: PAGES,
    success: 'dive.setup.saved',
  });
}

/** Puts a session (or the same one weekly for a few weeks) on the club's calendar. */
export async function addSessionsAction(_: FormState, fd: FormData) {
  return runForm(fd, SessionsInput, (tx, ctx, input) => addSessions(tx, ctx, input), {
    revalidate: PAGES,
    success: 'dive.setup.sessions.added',
  });
}

/** The owner invites an instructor or a manager by a one-time link. */
export async function inviteTeamAction(_: FormState, fd: FormData) {
  const h = await headers();
  const origin = `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host') ?? 'localhost:3000'}`;
  return runForm(fd, InviteInput, (tx, ctx, input) => createInvite(tx, ctx, input), {
    revalidate: '/dive/setup',
    success: 'staff.invite.created',
    // The token exists only in this response; the database keeps its hash.
    data: ({ token }) => ({ link: `${origin}/invite/${token}` }),
  });
}
