/**
 * Automations: a domain event becomes a message to the family's guardians (brief §6.12). Each mapped event has a
 * resolver that finds the children or household it concerns and the words the template needs; the rule decides
 * whether it runs and after what delay. One message per event, child and guardian, whatever the redelivery.
 */
import { z } from 'zod';
import { addDays } from '@rswim/calendar';
import type { TemplateKey } from '@rswim/contracts';
import { eq, schema, type Tx } from '@rswim/db';
import type { ServiceContext } from '@rswim/domain-core';
import { guardiansOfHouseholds, staffNames, studentsByIds } from '@rswim/domain-people';
import {
  lessonTexts,
  migrationNotices,
  placesByIds,
  slotText,
  studentsInLessons,
  studentsOfClosure,
} from '@rswim/domain-scheduling';
import { dropAudience, stageAudience } from '@rswim/domain-transport';
import { agorot, formatILS } from '@rswim/money';
import { messageDate, messagePeriod, migrationNoticeVars } from '../policies';
import { enqueueMessage, type Vars } from './outbound';
import { ensureCommsDefaults } from './templates';

const { automationRules } = schema;

type Locale = 'he' | 'en';

export interface Target {
  /** Stable within the event (a child, a household). */
  key: string;
  householdId: string;
  /** A different template for this target (an absence that earned no makeup). */
  templateKey?: TemplateKey;
  vars: (locale: Locale) => Vars;
}

type Resolver = (tx: Tx, payload: unknown) => Promise<Target[]>;

const uuid = z.uuid();

async function forStudents(
  tx: Tx,
  studentIds: readonly string[],
  vars: (student: { id: string; firstName: string }, locale: Locale) => Vars,
  templateKey?: TemplateKey,
): Promise<Target[]> {
  const students = await studentsByIds(tx, studentIds);
  return students.map((s) => ({
    key: s.id,
    householdId: s.householdId,
    templateKey,
    vars: (l) => ({ student_name: s.firstName, ...vars(s, l) }),
  }));
}

async function lessonOf(tx: Tx, sessionId: string) {
  const [l] = await lessonTexts(tx, [sessionId]);
  return l ?? null;
}

/** "16:05" in Israel. */
const clock = (at: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);

/** A stage the escort tapped: the children on board hear it (nothing for an old tap). */
const transportStage: Resolver = async (tx, raw) => {
  const p = z.looseObject({ eventId: uuid }).parse(raw);
  const a = await stageAudience(tx, p.eventId);
  if (!a) return [];
  return forStudents(tx, a.studentIds, () => ({
    pickup: a.school,
    venue: a.venue,
    group: a.group,
    minutes: a.rideMinutes,
    time: clock(a.at),
  }));
};

const lessonVars =
  (l: { date: string; time: string; groupName: string; venueName: string }) =>
  (locale: Locale): Vars => ({
    date: messageDate(l.date, locale),
    time: l.time,
    group: l.groupName,
    venue: l.venueName,
  });

/** A venue migration (or its revert): one personal message per child, from the migration's notices. */
const venueMigration: Resolver = async (tx, raw) => {
  const p = z.looseObject({ migrationId: uuid }).parse(raw);
  const notices = await migrationNotices(tx, p.migrationId);
  return notices.map((n) => ({
    key: n.studentId,
    householdId: n.householdId,
    vars: (l) => migrationNoticeVars(n, l),
  }));
};

/** The events that message families, and how each finds its audience and words. */
export const RESOLVERS: Record<string, Resolver> = {
  'scheduling.venue_migrated': venueMigration,
  'scheduling.venue_migration_reverted': venueMigration,
  'enrollment.trial_booked': async (tx, raw) => {
    const p = z.looseObject({ studentId: uuid, sessionId: uuid }).parse(raw);
    const l = await lessonOf(tx, p.sessionId);
    return l ? forStudents(tx, [p.studentId], (_, loc) => lessonVars(l)(loc)) : [];
  },
  'scheduling.slot_booked': async (tx, raw) => {
    const p = z.looseObject({ studentId: uuid, slotId: uuid }).parse(raw);
    const l = await slotText(tx, p.slotId);
    return l ? forStudents(tx, [p.studentId], (_, loc) => lessonVars(l)(loc)) : [];
  },
  'enrollment.trial_converted': async (tx, raw) => {
    const p = z
      .looseObject({ studentId: uuid, enrollmentId: uuid, startsOn: z.iso.date() })
      .parse(raw);
    const [place] = await placesByIds(tx, [p.enrollmentId]);
    return forStudents(tx, [p.studentId], (_, loc) => ({
      group: place?.groupName,
      date: messageDate(p.startsOn, loc),
    }));
  },
  'attendance.absence_processed': async (tx, raw) => {
    const p = z
      .looseObject({ studentId: uuid, sessionId: uuid, creditId: uuid.nullable() })
      .parse(raw);
    const l = await lessonOf(tx, p.sessionId);
    if (!l) return [];
    return forStudents(
      tx,
      [p.studentId],
      (_, loc) => lessonVars(l)(loc),
      p.creditId ? undefined : 'absence_received_no_makeup',
    );
  },
  'attendance.makeup_booked': async (tx, raw) => {
    const p = z.looseObject({ studentId: uuid, sessionId: uuid }).parse(raw);
    const l = await lessonOf(tx, p.sessionId);
    return l ? forStudents(tx, [p.studentId], (_, loc) => lessonVars(l)(loc)) : [];
  },
  'scheduling.staff_changed': async (tx, raw) => {
    const p = z.looseObject({ sessionIds: z.array(uuid), toStaffId: uuid.nullable() }).parse(raw);
    if (!p.toStaffId || p.sessionIds.length === 0) return [];
    const names = await staffNames(tx, [p.toStaffId]);
    const lessons = await lessonTexts(tx, p.sessionIds);
    const first = lessons[0];
    if (!first) return [];
    const students = await studentsInLessons(tx, p.sessionIds);
    return forStudents(tx, students, (_, loc) => ({
      ...lessonVars(first)(loc),
      instructor: names.get(p.toStaffId as string),
    }));
  },
  'attendance.closure_opened': async (tx, raw) => {
    const p = z
      .looseObject({ closureEventId: uuid, startsOn: z.iso.date(), endsOn: z.iso.date() })
      .parse(raw);
    const affected = await studentsOfClosure(tx, p.closureEventId);
    const venue = new Map(affected.map((a) => [a.studentId, a.venueName]));
    return forStudents(
      tx,
      affected.map((a) => a.studentId),
      (s, loc) => ({
        venue: venue.get(s.id),
        from: messageDate(p.startsOn, loc),
        to: messageDate(p.endsOn, loc),
      }),
    );
  },
  'billing.payment_link_created': async (_tx, raw) => {
    const p = z
      .looseObject({ householdId: uuid, url: z.string(), amountAgorot: z.number().int() })
      .parse(raw);
    return [
      {
        key: p.householdId,
        householdId: p.householdId,
        vars: (loc) => ({ amount: formatILS(agorot(p.amountAgorot), loc), url: p.url }),
      },
    ];
  },
  'billing.dunning_step': async (_tx, raw) => {
    const p = z.looseObject({ householdId: uuid, amountAgorot: z.number().int() }).parse(raw);
    return [
      {
        key: p.householdId,
        householdId: p.householdId,
        vars: (loc) => ({ amount: formatILS(agorot(p.amountAgorot), loc) }),
      },
    ];
  },
  'billing.freeze_decided': async (tx, raw) => {
    const p = z.looseObject({ enrollmentId: uuid, decision: z.string() }).parse(raw);
    if (p.decision !== 'approved') return [];
    const [place] = await placesByIds(tx, [p.enrollmentId]);
    return place ? forStudents(tx, [place.studentId], () => ({ group: place.groupName })) : [];
  },
  'transport.left_school': transportStage,
  'transport.arrived_pool': transportStage,
  'transport.left_pool': transportStage,
  'transport.rider_dropped': async (tx, raw) => {
    const p = z.looseObject({ eventId: uuid }).parse(raw);
    const a = await dropAudience(tx, p.eventId);
    return a ? forStudents(tx, [a.studentId], () => ({ point: a.point, time: clock(a.at) })) : [];
  },
  'billing.cancellation_requested': async (tx, raw) => {
    const p = z
      .looseObject({ studentId: uuid, lastChargedPeriod: z.string(), endsOn: z.iso.date() })
      .parse(raw);
    return forStudents(tx, [p.studentId], (_, loc) => ({
      period: messagePeriod(p.lastChargedPeriod),
      date: messageDate(addDays(p.endsOn, -1), loc),
    }));
  },
};

export interface AutomationEvent {
  id: string;
  type: string;
  payload: unknown;
}

/** Runs the automation for one domain event: messages queued (or logged as blocked) per child and guardian. */
export async function runAutomation(
  tx: Tx,
  ctx: ServiceContext,
  event: AutomationEvent,
): Promise<{ outcome: 'disabled' | 'unmapped' | 'done'; queued: number; blocked: number }> {
  const resolver = RESOLVERS[event.type];
  if (!resolver) return { outcome: 'unmapped', queued: 0, blocked: 0 };
  let [rule] = await tx
    .select()
    .from(automationRules)
    .where(eq(automationRules.eventType, event.type));
  if (!rule) {
    await ensureCommsDefaults(tx, ctx.orgId);
    [rule] = await tx
      .select()
      .from(automationRules)
      .where(eq(automationRules.eventType, event.type));
  }
  if (!rule?.enabled) return { outcome: 'disabled', queued: 0, blocked: 0 };
  const targets = await resolver(tx, event.payload);
  return sendToTargets(tx, ctx, targets, {
    templateKey: rule.templateKey as TemplateKey,
    keyPrefix: `auto:${event.id}`,
    source: { eventId: event.id, eventType: event.type },
    notBefore: new Date(Date.now() + rule.delayMin * 60_000),
  });
}

/** Queues a template to every guardian of every target's household. */
export async function sendToTargets(
  tx: Tx,
  ctx: ServiceContext,
  targets: Target[],
  o: {
    templateKey: TemplateKey;
    keyPrefix: string;
    source?: { eventId: string; eventType: string };
    broadcastId?: string;
    notBefore?: Date;
  },
) {
  const guardians = await guardiansOfHouseholds(tx, [
    ...new Set(targets.map((t) => t.householdId)),
  ]);
  const cache = {};
  let queued = 0;
  let blocked = 0;
  for (const t of targets) {
    for (const g of guardians.filter((x) => x.householdId === t.householdId)) {
      const r = await enqueueMessage(
        tx,
        ctx,
        {
          guardian: g,
          templateKey: t.templateKey ?? o.templateKey,
          vars: t.vars,
          idempotencyKey: `${o.keyPrefix}:${t.key}:${g.id}`,
          source: o.source,
          broadcastId: o.broadcastId,
          notBefore: o.notBefore,
        },
        cache,
      );
      if (r.status === 'blocked') blocked++;
      else queued++;
    }
  }
  return { outcome: 'done' as const, queued, blocked };
}
