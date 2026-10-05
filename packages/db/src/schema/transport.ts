/**
 * After-school transport (brief §6.10). A route brings children from a school to an after-school group and back;
 * each day it runs once, with an escort who taps each stage and each child. Run events are append-only facts.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { RUN_EVENT_KINDS, RUN_STAGES, RUN_STATUSES } from '@rswim/contracts';
import { createdAt, id, inList, orgId, updatedAt } from './_helpers';
import { staffMembers, students } from './people';
import { classTemplates, sessions } from './scheduling';

/** A partner school children are picked up from. */
export const schools = pgTable(
  'schools',
  {
    id: id(),
    organizationId: orgId(),
    name: text('name').notNull(),
    address: text('address'),
    contactName: text('contact_name'),
    contactPhone: text('contact_phone'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('schools_org_id').on(t.organizationId, t.id),
    unique('schools_org_name').on(t.organizationId, t.name),
  ],
);

/** From a school to an after-school group on given weekdays, and back to each child's drop-off point. */
export const transportRoutes = pgTable(
  'transport_routes',
  {
    id: id(),
    organizationId: orgId(),
    name: text('name').notNull(),
    schoolId: uuid('school_id').notNull(),
    classTemplateId: uuid('class_template_id').notNull(),
    /** 0 = Sunday … 6 = Saturday. */
    weekdays: smallint('weekdays').array().notNull(),
    leavesSchoolAt: time('leaves_school_at').notNull(),
    /** The ride between the school and the pool, for the "on the way, about N minutes" message. */
    rideMinutes: integer('ride_minutes').notNull(),
    escortStaffId: uuid('escort_staff_id'),
    vehicle: text('vehicle'),
    driverName: text('driver_name'),
    driverPhone: text('driver_phone'),
    active: boolean('active').notNull().default(true),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('transport_routes_org_id').on(t.organizationId, t.id),
    unique('transport_routes_org_name').on(t.organizationId, t.name),
    foreignKey({
      name: 'transport_routes_school_fk',
      columns: [t.organizationId, t.schoolId],
      foreignColumns: [schools.organizationId, schools.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transport_routes_template_fk',
      columns: [t.organizationId, t.classTemplateId],
      foreignColumns: [classTemplates.organizationId, classTemplates.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'transport_routes_escort_fk',
      columns: [t.organizationId, t.escortStaffId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }),
    check('transport_routes_ride_check', sql`${t.rideMinutes} between 0 and 180`),
    check(
      'transport_routes_weekdays_check',
      sql`cardinality(${t.weekdays}) > 0 and ${t.weekdays} <@ array[0,1,2,3,4,5,6]::smallint[]`,
    ),
  ],
);

/** A child on a route, with where they get off on the way back (null: back at the school). */
export const routeRiders = pgTable(
  'route_riders',
  {
    id: id(),
    organizationId: orgId(),
    routeId: uuid('route_id').notNull(),
    studentId: uuid('student_id').notNull(),
    dropoffPoint: text('dropoff_point'),
    dropoffNote: text('dropoff_note'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('route_riders_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'route_riders_route_fk',
      columns: [t.organizationId, t.routeId],
      foreignColumns: [transportRoutes.organizationId, transportRoutes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'route_riders_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    uniqueIndex('route_riders_open')
      .on(t.organizationId, t.routeId, t.studentId)
      .where(sql`${t.endsOn} is null`),
    index('route_riders_student').on(t.organizationId, t.studentId),
    check('route_riders_dates_check', sql`${t.endsOn} is null or ${t.endsOn} > ${t.startsOn}`),
  ],
);

/** One day's run of a route: who escorts it, the lesson it brings children to, and how far it got. */
export const routeRuns = pgTable(
  'route_runs',
  {
    id: id(),
    organizationId: orgId(),
    routeId: uuid('route_id').notNull(),
    date: date('date').notNull(),
    escortStaffId: uuid('escort_staff_id'),
    sessionId: uuid('session_id'),
    status: text('status').notNull().default('planned'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('route_runs_org_id').on(t.organizationId, t.id),
    unique('route_runs_once').on(t.organizationId, t.routeId, t.date),
    foreignKey({
      name: 'route_runs_route_fk',
      columns: [t.organizationId, t.routeId],
      foreignColumns: [transportRoutes.organizationId, transportRoutes.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'route_runs_escort_fk',
      columns: [t.organizationId, t.escortStaffId],
      foreignColumns: [staffMembers.organizationId, staffMembers.id],
    }),
    foreignKey({
      name: 'route_runs_session_fk',
      columns: [t.organizationId, t.sessionId],
      foreignColumns: [sessions.organizationId, sessions.id],
    }).onDelete('set null'),
    index('route_runs_date').on(t.organizationId, t.date),
    check('route_runs_status_check', sql.raw(`status in (${inList(RUN_STATUSES)})`)),
  ],
);

/** What the escort tapped, when: a stage of the run, or a mark on one child. Never changed, only added. */
export const runEvents = pgTable(
  'run_events',
  {
    id: id(),
    organizationId: orgId(),
    runId: uuid('run_id').notNull(),
    kind: text('kind').notNull(),
    studentId: uuid('student_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    recordedBy: uuid('recorded_by'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('run_events_org_id').on(t.organizationId, t.id),
    foreignKey({
      name: 'run_events_run_fk',
      columns: [t.organizationId, t.runId],
      foreignColumns: [routeRuns.organizationId, routeRuns.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'run_events_student_fk',
      columns: [t.organizationId, t.studentId],
      foreignColumns: [students.organizationId, students.id],
    }).onDelete('cascade'),
    uniqueIndex('run_events_stage_once')
      .on(t.organizationId, t.runId, t.kind)
      .where(sql`${t.studentId} is null`),
    uniqueIndex('run_events_mark_once')
      .on(t.organizationId, t.runId, t.studentId, t.kind)
      .where(sql`${t.studentId} is not null`),
    check('run_events_kind_check', sql.raw(`kind in (${inList(RUN_EVENT_KINDS)})`)),
    check(
      'run_events_subject_check',
      sql.raw(`(kind in (${inList(RUN_STAGES)})) = (student_id is null)`),
    ),
  ],
);
