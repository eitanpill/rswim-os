/**
 * The owner's copilot (brief §6.15), the business brain's chat (docs/AI-BRAIN.md). A request runs the model with read
 * tools and propose tools inside the owner's own transaction (RLS as the owner). Each proposal passes the brain's gate:
 * it runs at once when the owner let that kind run on its own, otherwise it waits for the owner's tap. Running one
 * calls the same domain service the screens use (placeStudent, sendToTargets, openSlots, requestPaymentLink), as the
 * owner, under the same policies; the copilot tables and those services write the audit log. Read tools query as the
 * owner, like the reports read model.
 */
import { randomUUID } from 'node:crypto';
import {
  CLOSURE_SOURCES,
  SLOT_DEFAULT_CAPACITY,
  type AgentSource,
  type CopilotActionKind,
  type CopilotActionStatus,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import {
  bookMakeup,
  cancelMakeupBooking,
  createClosureEvent,
  openClosureEvent,
  previewClosure,
  reportAbsence,
} from '@rswim/domain-attendance';
import {
  cancelPaymentLink,
  debtsDashboard,
  decideFreeze,
  requestFreeze,
  requestPaymentLink,
} from '@rswim/domain-billing';
import { enqueueMessage, schoolName, sendToTargets } from '@rswim/domain-comms';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  cancelSlot,
  cancelSubstituteRequest,
  openSlots,
  placeStudent,
  previewPlacement,
  removeStudent,
  requestSubstitute,
  todayIL,
} from '@rswim/domain-scheduling';
import { resolvePolicyFor } from '@rswim/domain-settings';
import {
  traced,
  type CopilotModel,
  type CopilotRunInput,
  type CopilotTool,
  type CopilotTraceStep,
} from '@rswim/integrations';
import { gateFor, getAgentSettings } from './agent';
import { approvalText } from './agent-policies';
import {
  actionStep,
  copilotGate,
  copilotSystem,
  endOfNextMonth,
  fakeIntent,
  nextWeekday,
  parseProposal,
  proposalSummary,
  type ActionStep,
  type Explanation,
  type ProposalParams,
} from './policies';

const { copilotRequests, copilotActions } = schema;

const rows = async <T>(tx: Tx, q: ReturnType<typeof sql>) =>
  (await tx.execute<Record<string, unknown>>(q)).rows as T[];

const like = (q: unknown) => `%${String(q ?? '').trim()}%`;

// ─── Tools ──────────────────────────────────────────────────────────────────

const obj = (
  properties: Record<string, unknown>,
  required: string[],
): CopilotTool['input_schema'] => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: 'string', description });

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    name: 'find_students',
    description:
      'Find children by (part of) their first or last name. Returns their family and current groups.',
    input_schema: obj({ query: str('Name or part of it') }, ['query']),
  },
  {
    name: 'find_groups',
    description:
      'Find active groups by (part of) their name, with venue, weekday (0=Sunday), time and seats.',
    input_schema: obj({ query: str('Group name or part of it') }, ['query']),
  },
  {
    name: 'find_staff',
    description: 'Find active instructors by name, with the venues they are available at.',
    input_schema: obj({ query: str('Name or part of it') }, ['query']),
  },
  {
    name: 'debts',
    description:
      'Families that owe money, largest first (amounts in agorot), with the date of the oldest charge.',
    input_schema: obj({}, []),
  },
  {
    name: 'lessons_on',
    description:
      'Group lessons on a date (YYYY-MM-DD): group, venue, time, status and instructors.',
    input_schema: obj({ date: str('YYYY-MM-DD') }, ['date']),
  },
  {
    name: 'closures',
    description: 'Venue closures and holidays from today on.',
    input_schema: obj({}, []),
  },
  {
    name: 'find_venues',
    description: 'Active venues (pools) by (part of) their name; an empty query lists them all.',
    input_schema: obj({ query: str('Venue name or part of it, or empty') }, ['query']),
  },
  {
    name: 'staff_lessons',
    description:
      "An instructor's group lessons on a date (YYYY-MM-DD) that they lead: sessionId, group, venue, time and status.",
    input_schema: obj({ staffId: str('Instructor id'), date: str('YYYY-MM-DD') }, [
      'staffId',
      'date',
    ]),
  },
  {
    name: 'propose_move_student',
    description:
      'Propose moving a child from one group to another from a date (fromGroupId null to add them). Checked against the placement rules; the owner confirms.',
    input_schema: obj(
      {
        studentId: str('Child id'),
        fromGroupId: { type: ['string', 'null'], description: 'Current group id, or null' },
        toGroupId: str('Target group id'),
        onDate: str('YYYY-MM-DD, a lesson day of the target group'),
      },
      ['studentId', 'fromGroupId', 'toGroupId', 'onDate'],
    ),
  },
  {
    name: 'propose_message_family',
    description:
      "Propose a WhatsApp message to a child's family (free text). The owner confirms before it is sent.",
    input_schema: obj({ householdId: str('Family id'), text: str('The message, in Hebrew') }, [
      'householdId',
      'text',
    ]),
  },
  {
    name: 'propose_payment_link',
    description:
      'Propose sending a family a payment link for an amount in agorot (100 = 1 shekel), with a short description the family sees. Use the debts tool for what they owe.',
    input_schema: obj(
      {
        householdId: str('Family id'),
        amountAgorot: { type: 'integer', description: 'Amount in agorot, at least 100' },
        description: str('What the payment is for, in Hebrew'),
      },
      ['householdId', 'amountAgorot', 'description'],
    ),
  },
  {
    name: 'propose_cancel_lessons',
    description:
      'Propose cancelling every lesson from one date to another, at one venue (venueId) or all venues (null). Children get makeup credits by the regulations and families are told. Always waits for the owner.',
    input_schema: obj(
      {
        venueId: { type: ['string', 'null'], description: 'Venue id, or null for every venue' },
        startsOn: str('YYYY-MM-DD'),
        endsOn: str('YYYY-MM-DD, the same day for one day'),
        reason: str('Why, in Hebrew; the families see it'),
        source: {
          type: 'string',
          enum: [...CLOSURE_SOURCES],
          description:
            'Who closed: the school, the venue, an authority, a technical fault, water quality or a holiday',
        },
        makeupDeadline: str('YYYY-MM-DD, after endsOn: the last day to make the lessons up'),
      },
      ['venueId', 'startsOn', 'endsOn', 'reason', 'source', 'makeupDeadline'],
    ),
  },
  {
    name: 'propose_substitute',
    description:
      'Propose looking for a substitute for one lesson (sessionId from staff_lessons or lessons_on): qualified instructors get the offer; the first to accept takes it and the families are told.',
    input_schema: obj(
      {
        sessionId: str('Lesson id'),
        reason: { type: ['string', 'null'], description: 'Why, e.g. sick; or null' },
      },
      ['sessionId', 'reason'],
    ),
  },
  {
    name: 'propose_open_makeup_slots',
    description:
      'Propose opening makeup slots with an instructor at a venue on a date and time. The owner confirms.',
    input_schema: obj(
      {
        staffId: str('Instructor id'),
        venueId: str('Venue id'),
        date: str('YYYY-MM-DD'),
        startsAt: str('HH:MM'),
        endsAt: str('HH:MM'),
        capacity: { type: 'integer', description: 'Children per slot (default by kind)' },
      },
      ['staffId', 'venueId', 'date', 'startsAt', 'endsAt'],
    ),
  },
];

interface Proposal {
  id: string;
  kind: CopilotActionKind;
  status: 'done' | 'waiting' | 'failed';
}

const one = <T>(xs: T[], code = 'common.errors.notFound'): T => {
  const x = xs[0];
  if (!x) throw new DomainError(code);
  return x;
};

/**
 * The tools bound to one request: reads run as the owner; each proposal is checked, passes the brain's gate and is
 * stored on the request, and runs at once only when the gate says so.
 */
export function copilotToolbox(tx: Tx, ctx: ServiceContext, today: string, requestId: string) {
  const proposals: Proposal[] = [];
  const name = async (
    table: 'students' | 'class_templates' | 'staff_members' | 'venues',
    id: string,
  ) => {
    const q = {
      students: sql`select first_name || ' ' || last_name n from students where id = ${id}`,
      class_templates: sql`select name n from class_templates where id = ${id}`,
      staff_members: sql`select first_name || ' ' || last_name n from staff_members where id = ${id}`,
      venues: sql`select name n from venues where id = ${id}`,
    }[table];
    return one(await rows<{ n: string }>(tx, q)).n;
  };

  const call = async (tool: string, input: unknown): Promise<unknown> => {
    const a = (input ?? {}) as Record<string, unknown>;
    switch (tool) {
      case 'find_students':
        return rows(
          tx,
          sql`select s.id, s.first_name || ' ' || s.last_name "name", s.household_id "householdId",
                     h.display_name family,
                     coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name, 'venue', v.name,
                                 'weekday', t.weekday, 'startsAt', to_char(t.starts_at, 'HH24:MI')))
                               from enrollments e join class_templates t on t.id = e.class_template_id
                               join venues v on v.id = t.venue_id
                               where e.student_id = s.id and e.status in ('active', 'frozen', 'cancel_requested')
                                 and (e.ends_on is null or e.ends_on > ${today}::date)), '[]') "groups"
              from students s join households h on h.id = s.household_id
              where s.first_name || ' ' || s.last_name ilike ${like(a.query)}
              order by s.first_name, s.last_name limit 10`,
        );
      case 'find_groups':
        return rows(
          tx,
          sql`select t.id, t.name, v.name venue, t.venue_id "venueId", t.weekday, to_char(t.starts_at, 'HH24:MI') "startsAt",
                     t.capacity, (select count(*) from enrollments e where e.class_template_id = t.id
                       and e.status in ('active', 'frozen', 'cancel_requested')
                       and (e.ends_on is null or e.ends_on > ${today}::date))::int seated,
                     (select m.first_name || ' ' || m.last_name from staff_members m where m.id = t.lead_staff_id) lead
              from class_templates t join venues v on v.id = t.venue_id
              where t.status = 'active' and t.cohort_id is null and t.name ilike ${like(a.query)}
                and (t.effective_to is null or t.effective_to > ${today}::date)
              order by t.name limit 10`,
        );
      case 'find_staff':
        return rows(
          tx,
          sql`select m.id, m.first_name || ' ' || m.last_name "name",
                     coalesce((select json_agg(distinct jsonb_build_object('id', v.id, 'name', v.name))
                               from availability_rules r join venues v on v.id = r.venue_id
                               where r.staff_member_id = m.id), '[]') venues
              from staff_members m
              where m.status = 'active' and m.first_name || ' ' || m.last_name ilike ${like(a.query)}
              order by m.first_name limit 10`,
        );
      case 'debts':
        return (await debtsDashboard(tx)).rows.slice(0, 10).map((d) => ({
          family: d.name,
          householdId: d.householdId,
          balanceAgorot: d.balance,
          oldestCharge: d.oldest,
        }));
      case 'lessons_on':
        return rows(
          tx,
          sql`select s.id "sessionId", t.name "group", v.name venue, s.venue_id "venueId", to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') "time",
                     s.status,
                     (select string_agg(m.first_name, ', ') from session_staff ss
                        join staff_members m on m.id = ss.staff_member_id where ss.session_id = s.id) staff
              from sessions s join class_templates t on t.id = s.class_template_id join venues v on v.id = s.venue_id
              where s.date = ${String(a.date ?? today)}::date order by s.starts_at`,
        );
      case 'closures':
        return rows(
          tx,
          sql`select v.name venue, c.starts_on::text "from", c.ends_on::text "to", c.reason
              from venue_closures c join venues v on v.id = c.venue_id
              where c.ends_on >= ${today}::date order by c.starts_on limit 20`,
        );
      case 'find_venues':
        return rows(
          tx,
          sql`select id, name from venues where status = 'active' and name ilike ${like(a.query)}
              order by name limit 20`,
        );
      case 'staff_lessons':
        return rows(
          tx,
          sql`select s.id "sessionId", t.name "group", v.name venue,
                     to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') "time", s.status
              from sessions s join class_templates t on t.id = s.class_template_id join venues v on v.id = s.venue_id
              where s.date = ${String(a.date ?? today)}::date
                and coalesce((select ss.staff_member_id from session_staff ss
                              where ss.session_id = s.id and ss.role = 'lead'), t.lead_staff_id) = ${String(a.staffId ?? '')}::uuid
              order by s.starts_at`,
        );
      case 'propose_cancel_lessons':
        return propose('cancel_lessons', input);
      case 'propose_substitute':
        return propose('substitute', input);
      case 'propose_move_student':
        return propose('move_student', input);
      case 'propose_message_family':
        return propose('message_family', input);
      case 'propose_open_makeup_slots':
        return propose('open_makeup_slots', input);
      case 'propose_payment_link':
        return propose('payment_link', input);
      default:
        throw new DomainError('copilot.errors.unknownTool');
    }
  };

  /**
   * The kinds the owner's chat proposes; the parents' bot takes absences, makeups and freezes (bot.ts), and an
   * instructor's WhatsApp asks for substitutes (brain-inbound.ts).
   */
  async function propose(
    kind:
      | 'move_student'
      | 'message_family'
      | 'open_makeup_slots'
      | 'payment_link'
      | 'cancel_lessons'
      | 'substitute',
    raw: unknown,
  ) {
    const parsed = parseProposal(kind, raw);
    if (!parsed.ok) throw new DomainError(parsed.code);
    let summary: Explanation;
    if (kind === 'move_student') {
      const p = parsed.params as ProposalParams['move_student'];
      const preview = await previewPlacement(tx, {
        studentId: p.studentId,
        fromTemplateId: p.fromGroupId,
        toTemplateId: p.toGroupId,
        onDate: p.onDate,
        status: 'active',
      });
      const v = preview.decision.violations[0];
      if (v) throw new DomainError(v.code, v.params);
      summary = proposalSummary({
        kind,
        student: `${preview.student.firstName} ${preview.student.lastName}`,
        from: preview.from?.name ?? null,
        to: preview.to.name,
        date: p.onDate,
      });
    } else if (kind === 'message_family') {
      const p = parsed.params as ProposalParams['message_family'];
      const [h] = await rows<{ n: string }>(
        tx,
        sql`select display_name n from households where id = ${p.householdId}`,
      );
      if (!h) throw new DomainError('common.errors.notFound');
      summary = proposalSummary({ kind, family: h.n, text: p.text });
    } else if (kind === 'payment_link') {
      const p = parsed.params as ProposalParams['payment_link'];
      const [h] = await rows<{ n: string }>(
        tx,
        sql`select display_name n from households where id = ${p.householdId}`,
      );
      if (!h) throw new DomainError('common.errors.notFound');
      summary = proposalSummary({
        kind,
        family: h.n,
        amountAgorot: p.amountAgorot,
        description: p.description,
      });
    } else if (kind === 'cancel_lessons') {
      summary = await cancelLessonsSummary(tx, parsed.params as ProposalParams['cancel_lessons']);
    } else if (kind === 'substitute') {
      summary = await substituteSummary(
        tx,
        (parsed.params as ProposalParams['substitute']).sessionId,
      );
    } else {
      const p = parsed.params as ProposalParams['open_makeup_slots'];
      summary = proposalSummary({
        kind,
        staff: await name('staff_members', p.staffId),
        venue: await name('venues', p.venueId),
        date: p.date,
        from: p.startsAt,
        to: p.endsAt,
        capacity: p.capacity ?? SLOT_DEFAULT_CAPACITY.makeup,
      });
    }
    const amount =
      kind === 'payment_link'
        ? (parsed.params as ProposalParams['payment_link']).amountAgorot
        : null;
    const taken = await takeAction(tx, ctx, {
      source: 'owner_chat',
      requestId,
      kind,
      params: parsed.params,
      summary,
      amountAgorot: amount,
    });
    proposals.push({ id: taken.id, kind, status: taken.status });
    return { status: taken.status, summary, ...(taken.code ? { refusedBy: taken.code } : {}) };
  }

  return { call, proposals };
}

/** The card's sentence for cancelling lessons: the venue and how many lessons the range holds now. */
export async function cancelLessonsSummary(
  tx: Tx,
  p: ProposalParams['cancel_lessons'],
): Promise<Explanation> {
  const preview = await previewClosure(tx, {
    venueId: p.venueId,
    startsOn: p.startsOn,
    endsOn: p.endsOn,
    source: p.source,
  });
  if (preview.totals.sessions === 0) throw new DomainError('agent.errors.noLessons');
  const venue = p.venueId
    ? one(await rows<{ n: string }>(tx, sql`select name n from venues where id = ${p.venueId}`)).n
    : null;
  return proposalSummary({
    kind: 'cancel_lessons',
    venue,
    date: p.startsOn,
    until: p.endsOn,
    sessions: preview.totals.sessions,
    reason: p.reason,
  });
}

/**
 * The card's sentence for a substitute: whose lesson, which group, when (`open`: a lesson nobody teaches yet). Only a
 * lesson still ahead qualifies.
 */
export async function substituteSummary(
  tx: Tx,
  sessionId: string,
  opts: { open?: boolean } = {},
): Promise<Explanation> {
  const l = one(
    await rows<{
      group: string;
      date: string;
      time: string;
      staff: string | null;
      status: string;
      ahead: boolean;
    }>(
      tx,
      sql`select t.name "group", s.date::text date, s.status, s.starts_at > now() ahead,
                 to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') "time",
                 (select m.first_name || ' ' || m.last_name from staff_members m
                  where m.id = coalesce((select ss.staff_member_id from session_staff ss
                                         where ss.session_id = s.id and ss.role = 'lead'), t.lead_staff_id)) staff
          from sessions s join class_templates t on t.id = s.class_template_id
          where s.id = ${sessionId}`,
    ),
  );
  if (l.status !== 'scheduled' || !l.ahead)
    throw new DomainError('scheduling.substitute.notUpcoming');
  return proposalSummary({
    kind: 'substitute',
    staff: opts.open ? null : l.staff,
    group: l.group,
    date: l.date,
    time: l.time,
  });
}

// ─── The rules-based stand-in ───────────────────────────────────────────────

/**
 * A model stand-in for demos and tests (RSWIM_COPILOT_FAKE=1): it understands the phrasings `fakeIntent` knows,
 * calls the same tools a model would, and answers in plain Hebrew. It never sees an API key.
 */
export class FakeCopilotModel implements CopilotModel {
  readonly name = 'fake:rules';

  constructor(private readonly today: string) {}

  async run(input: CopilotRunInput) {
    const trace: CopilotTraceStep[] = [];
    const use = async <T>(tool: string, args: unknown) => {
      const r = await traced(input, trace, tool, args);
      return r.error ? null : (JSON.parse(r.text) as T);
    };
    const done = (answer: string) => ({ answer, trace, incomplete: false });
    const intent = fakeIntent(input.prompt, this.today);
    type Student = { id: string; name: string; householdId: string; groups: { id: string }[] };
    switch (intent.kind) {
      case 'move': {
        let s: Student | undefined;
        let g: { id: string; name: string; weekday: number } | undefined;
        for (const split of intent.splits) {
          s = (await use<Student[]>('find_students', { query: split.student }))?.[0];
          g = s
            ? (
                await use<{ id: string; name: string; weekday: number }[]>('find_groups', {
                  query: split.group,
                })
              )?.[0]
            : undefined;
          if (s && g) break;
        }
        if (!s || !g) return done('לא מצאתי את הילד/ה או את הקבוצה.');
        const onDate = intent.date ?? nextWeekday(this.today, g.weekday);
        const out = await use<{ status: string }>('propose_move_student', {
          studentId: s.id,
          fromGroupId: s.groups[0]?.id ?? null,
          toGroupId: g.id,
          onDate,
        });
        return done(
          !out
            ? 'המעבר הזה לא עומד בכללים.'
            : out.status === 'done'
              ? `העברתי את ${s.name} ל${g.name} מ-${onDate}.`
              : out.status === 'failed'
                ? 'ניסיתי להעביר, אבל הכללים לא אפשרו את זה.'
                : `הכנתי הצעה להעביר את ${s.name} ל${g.name} מ-${onDate}. היא מחכה לאישור שלך.`,
        );
      }
      case 'message': {
        const s = (await use<Student[]>('find_students', { query: intent.student }))?.[0];
        if (!s) return done('לא מצאתי את הילד/ה.');
        const out = await use('propose_message_family', {
          householdId: s.householdId,
          text: intent.text,
        });
        return done(
          out
            ? `הכנתי הודעה למשפחה של ${s.name}. היא תישלח אחרי שתאשר/י.`
            : 'לא הצלחתי להכין את ההודעה.',
        );
      }
      case 'payment': {
        const s = (await use<Student[]>('find_students', { query: intent.student }))?.[0];
        if (!s) return done('לא מצאתי את הילד/ה.');
        const out = await use<{ status: string }>('propose_payment_link', {
          householdId: s.householdId,
          amountAgorot: intent.shekels * 100,
          description: `תשלום עבור ${s.name}`,
        });
        if (!out) return done('לא הצלחתי להכין את קישור התשלום.');
        return done(
          out.status === 'done'
            ? `שלחתי קישור תשלום של ${intent.shekels} ₪ למשפחה של ${s.name}.`
            : `הכנתי קישור תשלום של ${intent.shekels} ₪ למשפחה של ${s.name}. הוא מחכה לאישור שלך.`,
        );
      }
      case 'slots': {
        type Staff = { id: string; name: string; venues: { id: string }[] };
        const m = (await use<Staff[]>('find_staff', { query: intent.staff }))?.[0];
        const venueId = m?.venues[0]?.id;
        if (!m || !venueId) return done('לא מצאתי את המדריך/ה או בריכה שבה הוא/היא זמין/ה.');
        const out = await use<{ status: string }>('propose_open_makeup_slots', {
          staffId: m.id,
          venueId,
          date: intent.date,
          startsAt: intent.from,
          endsAt: intent.to,
        });
        return done(
          !out
            ? 'אי אפשר לפתוח את ההשלמות האלה.'
            : out.status === 'done'
              ? `פתחתי השלמות עם ${m.name}.`
              : `הכנתי הצעה לפתוח השלמות עם ${m.name}. היא מחכה לאישור שלך.`,
        );
      }
      case 'cancel': {
        type Venue = { id: string; name: string };
        const venue = intent.venue
          ? (await use<Venue[]>('find_venues', { query: intent.venue }))?.[0]
          : null;
        if (intent.venue && !venue) return done(`לא מצאתי בריכה בשם ${intent.venue}.`);
        const out = await use<{ status: string }>('propose_cancel_lessons', {
          venueId: venue?.id ?? null,
          startsOn: intent.date,
          endsOn: intent.date,
          reason: intent.reason ?? 'ביטול של בית הספר',
          source: 'school',
          makeupDeadline: endOfNextMonth(intent.date),
        });
        const where = venue ? ` ב${venue.name}` : '';
        return done(
          !out
            ? `אין שיעורים לבטל ב-${intent.date}${where}.`
            : out.status === 'done'
              ? `ביטלתי את השיעורים ב-${intent.date}${where} ועדכנתי את המשפחות.`
              : `הכנתי ביטול של השיעורים ב-${intent.date}${where}. הוא מחכה לאישור שלך, ואחריו המשפחות יקבלו הודעה וזיכוי.`,
        );
      }
      case 'substitute': {
        const m = (
          await use<{ id: string; name: string }[]>('find_staff', { query: intent.staff })
        )?.[0];
        if (!m) return done('לא מצאתי את המדריך/ה.');
        const lessons =
          (await use<{ sessionId: string; status: string }[]>('staff_lessons', {
            staffId: m.id,
            date: intent.date,
          })) ?? [];
        const statuses: string[] = [];
        for (const l of lessons.filter((x) => x.status === 'scheduled')) {
          const out = await use<{ status: string }>('propose_substitute', {
            sessionId: l.sessionId,
            reason: null,
          });
          if (out) statuses.push(out.status);
        }
        if (statuses.length === 0)
          return done(`לא מצאתי ל${m.name} שיעורים קרובים ב-${intent.date}.`);
        return done(
          statuses.every((x) => x === 'done')
            ? `פתחתי חיפוש מחליף ל-${statuses.length} השיעורים של ${m.name} ב-${intent.date}.`
            : `הכנתי חיפוש מחליף ל-${statuses.length} השיעורים של ${m.name} ב-${intent.date}. הוא מחכה לאישור שלך.`,
        );
      }
      case 'debts': {
        const d = (await use<{ family: string; balanceAgorot: number }[]>('debts', {})) ?? [];
        return done(
          d.length
            ? `החובות הגדולים: ${d
                .slice(0, 3)
                .map((x) => `${x.family} (${Math.round(x.balanceAgorot / 100)} ₪)`)
                .join(', ')}.`
            : 'אין חובות פתוחים.',
        );
      }
      case 'lessons': {
        const date = intent.date ?? this.today;
        const l = (await use<{ group: string }[]>('lessons_on', { date })) ?? [];
        return done(
          `ב-${date} יש ${l.length} שיעורים${l.length ? `: ${l.map((x) => x.group).join(', ')}` : ''}.`,
        );
      }
      default:
        return done(
          'אני (גרסת הדמו) מבין/ה: "תעביר את <ילד> ל<קבוצה>", "תשלח ל<ילד>: <הודעה>", "תפתח השלמות עם <מדריך> ב-<תאריך> <שעה>-<שעה>", "תבטל את השיעורים מחר", "תמצא מחליף ל<מדריך> היום", "מי חייב", "מה יש היום".',
        );
    }
  }
}

// ─── Requests ───────────────────────────────────────────────────────────────

export interface CopilotActionRow {
  id: string;
  kind: CopilotActionKind;
  params: unknown;
  summary: Explanation;
  status: CopilotActionStatus;
  result: unknown;
  errorCode: string | null;
  decidedAt: Date | null;
  undoneAt: Date | null;
}

export interface CopilotExchange {
  id: string;
  prompt: string;
  answer: string | null;
  status: string;
  errorCode: string | null;
  model: string;
  trace: CopilotTraceStep[];
  createdAt: Date;
  actions: CopilotActionRow[];
}

/** Whether the copilot can run for this user now: the owner, the policy on, and a model configured. */
export async function copilotAvailable(tx: Tx, model: CopilotModel | null) {
  const today = await todayIL(tx);
  const [{ owner } = { owner: false }] = await rows<{ owner: boolean }>(
    tx,
    sql`select app.is_owner() owner`,
  );
  const enabled = (await resolvePolicyFor(tx, { date: today })).rules.copilot?.enabled === true;
  return copilotGate({ enabled, owner, model: model !== null });
}

/** Runs one request: the model reads and proposes; the answer and the proposals are stored for the owner. */
export async function askCopilot(
  tx: Tx,
  ctx: ServiceContext,
  model: CopilotModel | null,
  prompt: string,
): Promise<string> {
  const gate = await copilotAvailable(tx, model);
  if (!gate.ok) throw new DomainError(gate.code);
  const text = prompt.trim();
  if (!text || text.length > 2000) throw new DomainError('copilot.errors.prompt');
  const today = await todayIL(tx);
  // The request row comes first: actions the gate runs during the model's turn hang on it.
  const requestId = randomUUID();
  await tx.insert(copilotRequests).values({
    id: requestId,
    organizationId: ctx.orgId,
    userId: ctx.userId as string,
    prompt: text,
    model: (model as CopilotModel).name,
    status: 'answered',
  });
  const box = copilotToolbox(tx, ctx, today, requestId);
  let out: { answer: string; trace: CopilotTraceStep[]; incomplete: boolean } | null = null;
  try {
    out = await (model as CopilotModel).run({
      system: copilotSystem({ today, school: await schoolName(tx, ctx.orgId) }),
      prompt: text,
      tools: COPILOT_TOOLS,
      callTool: box.call,
    });
  } catch {
    out = null;
  }
  await tx
    .update(copilotRequests)
    .set({
      status: out ? 'answered' : 'failed',
      answer: out?.answer ?? null,
      trace: out?.trace ?? [],
      errorCode: out
        ? out.incomplete
          ? 'copilot.errors.incomplete'
          : null
        : 'copilot.errors.modelFailed',
    })
    .where(eq(copilotRequests.id, requestId));
  return requestId;
}

/** The owner's recent requests with their proposals, newest first. */
export async function listCopilot(tx: Tx, limit = 20): Promise<CopilotExchange[]> {
  const reqs = await tx
    .select()
    .from(copilotRequests)
    .orderBy(desc(copilotRequests.createdAt))
    .limit(limit);
  const acts = reqs.length
    ? await tx
        .select()
        .from(copilotActions)
        .where(
          inArray(
            copilotActions.requestId,
            reqs.map((r) => r.id),
          ),
        )
        .orderBy(copilotActions.createdAt)
    : [];
  return reqs.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    answer: r.answer,
    status: r.status,
    errorCode: r.errorCode,
    model: r.model,
    trace: r.trace as CopilotTraceStep[],
    createdAt: r.createdAt,
    actions: acts
      .filter((a) => a.requestId === r.id)
      .map((a) => ({
        id: a.id,
        kind: a.kind as CopilotActionKind,
        params: a.params,
        summary: a.summary as Explanation,
        status: a.status as CopilotActionStatus,
        result: a.result,
        errorCode: a.errorCode,
        decidedAt: a.decidedAt,
        undoneAt: a.undoneAt,
      })),
  }));
}

// ─── Taking an action ───────────────────────────────────────────────────────

/**
 * Records one action the brain wants to take and sends it through the gate: refused when its kind is off, run at once
 * when the owner let it run alone (ran_alone, no decider), otherwise stored as a proposal for the owner.
 */
export async function takeAction(
  tx: Tx,
  ctx: ServiceContext,
  a: {
    source: AgentSource;
    requestId: string | null;
    /** The family's WhatsApp message, for actions the parents' bot took. */
    inboundMessageId?: string | null;
    kind: CopilotActionKind;
    params: unknown;
    summary: Explanation;
    amountAgorot: number | null;
  },
): Promise<{
  id: string;
  status: 'done' | 'waiting' | 'failed';
  code?: string;
  /** What the domain service returned, when it ran. */
  result?: unknown;
}> {
  const { level, decision } = await gateFor(tx, a.kind, a.amountAgorot);
  if (decision.route === 'refuse') throw new DomainError(decision.code);
  const [row] = await tx
    .insert(copilotActions)
    .values({
      organizationId: ctx.orgId,
      requestId: a.requestId,
      inboundMessageId: a.inboundMessageId ?? null,
      source: a.source,
      ref: sql`(select coalesce(max(ref), 0) + 1 from copilot_actions)`,
      autonomy: level,
      kind: a.kind,
      params: a.params,
      summary: a.summary,
      // Why it waits, when the level alone would have let it run.
      ...(decision.route === 'wait' && decision.reason !== 'level'
        ? { result: { waitReason: decision.reason } }
        : {}),
    })
    .returning();
  const action = row as typeof copilotActions.$inferSelect;
  if (decision.route === 'wait') {
    // The owner is not in the chat when a family or an instructor asked: the request goes to their WhatsApp.
    if (a.source !== 'owner_chat') await askOwnerOnWhatsApp(tx, ctx, action);
    return { id: action.id, status: 'waiting' };
  }
  const out = await runAction(tx, ctx, action, { alone: true });
  return out.status === 'confirmed'
    ? { id: action.id, status: 'done', result: out.result }
    : { id: action.id, status: 'failed', code: out.code };
}

/**
 * Sends a waiting action to the owner's WhatsApp, when they set a number for approvals: the sentence and "כן 12" /
 * "לא 12" (brain-inbound.ts reads the answer). Like every message it waits out quiet hours and Shabbat.
 */
async function askOwnerOnWhatsApp(
  tx: Tx,
  ctx: ServiceContext,
  action: typeof copilotActions.$inferSelect,
) {
  const s = await getAgentSettings(tx);
  if (!s.approvalPhoneE164 || action.ref === null) return;
  await enqueueMessage(tx, ctx, {
    guardian: {
      id: null,
      householdId: null,
      firstName: '',
      phoneE164: s.approvalPhoneE164,
      whatsappOptIn: true,
      locale: 'he',
    },
    templateKey: 'free_text',
    vars: (locale) => ({
      text: approvalText(
        { ref: action.ref as number, summary: action.summary as Explanation },
        locale,
      ),
    }),
    idempotencyKey: `agent.approval:${action.id}`,
  });
}

// ─── Deciding a proposal ────────────────────────────────────────────────────

async function loadAction(tx: Tx, id: string, step: ActionStep) {
  const [a] = await tx.select().from(copilotActions).where(eq(copilotActions.id, id)).for('update');
  if (!a) throw new DomainError('common.errors.notFound');
  const check = actionStep(
    { status: a.status as CopilotActionStatus, kind: a.kind as CopilotActionKind },
    step,
  );
  if (!check.ok) throw new DomainError(check.code);
  return a;
}

async function apply(tx: Tx, ctx: ServiceContext, a: typeof copilotActions.$inferSelect) {
  switch (a.kind as CopilotActionKind) {
    case 'move_student': {
      const p = a.params as ProposalParams['move_student'];
      const r = await placeStudent(tx, ctx, {
        studentId: p.studentId,
        fromTemplateId: p.fromGroupId,
        toTemplateId: p.toGroupId,
        onDate: p.onDate,
        status: 'active',
      });
      return { enrollmentId: r.enrollmentId };
    }
    case 'message_family': {
      const p = a.params as ProposalParams['message_family'];
      return sendToTargets(
        tx,
        ctx,
        [{ key: a.id, householdId: p.householdId, vars: () => ({ text: p.text }) }],
        {
          templateKey: 'free_text',
          keyPrefix: `copilot:${a.id}`,
        },
      );
    }
    case 'payment_link': {
      const p = a.params as ProposalParams['payment_link'];
      const linkId = await requestPaymentLink(tx, ctx, {
        householdId: p.householdId,
        amountAgorot: p.amountAgorot,
        description: p.description,
        requestId: a.id,
      });
      return { linkId };
    }
    case 'report_absence': {
      const p = a.params as ProposalParams['report_absence'];
      const o = await reportAbsence(tx, ctx, {
        sessionId: p.sessionId,
        studentId: p.studentId,
        channel: 'whatsapp',
        receivedAt: p.receivedAt,
        note: p.note ?? undefined,
      });
      return { noticeId: o.noticeId, classification: o.classification, creditId: o.creditId };
    }
    case 'book_makeup': {
      const p = a.params as ProposalParams['book_makeup'];
      return { bookingId: await bookMakeup(tx, ctx, p) };
    }
    case 'freeze': {
      const p = a.params as ProposalParams['freeze'];
      return requestFreeze(tx, ctx, { ...p, note: null });
    }
    case 'cancel_lessons': {
      const p = a.params as ProposalParams['cancel_lessons'];
      const closureEventId = await createClosureEvent(tx, ctx, {
        venueId: p.venueId,
        startsOn: p.startsOn,
        endsOn: p.endsOn,
        source: p.source,
        reason: p.reason,
        makeupFrom: null,
        makeupDeadline: p.makeupDeadline,
        endRule: null,
      });
      await openClosureEvent(tx, ctx, closureEventId);
      return { closureEventId };
    }
    case 'substitute': {
      const p = a.params as ProposalParams['substitute'];
      const r = await requestSubstitute(tx, ctx, p);
      return { substituteRequestId: r.id, offered: r.offered };
    }
    default: {
      const p = a.params as ProposalParams['open_makeup_slots'];
      const slotIds = await openSlots(tx, ctx, {
        staffMemberId: p.staffId,
        venueId: p.venueId,
        poolId: null,
        programId: null,
        kind: 'makeup',
        date: p.date,
        startsAt: p.startsAt,
        endsAt: p.endsAt,
        capacity: p.capacity ?? null,
        repeatWeeks: 1,
        notes: null,
      });
      return { slotIds };
    }
  }
}

/**
 * Runs an action through its domain service. A refusal by the rules is stored on the action (status failed, with the
 * reason) instead of failing the request. `alone` marks an action the gate ran without a person's tap.
 */
async function runAction(
  tx: Tx,
  ctx: ServiceContext,
  a: typeof copilotActions.$inferSelect,
  opts: { alone: boolean },
) {
  const decided = {
    decidedBy: opts.alone ? null : ctx.userId,
    decidedAt: new Date(),
    ranAlone: opts.alone,
  };
  try {
    const result = await tx.transaction((sp) => apply(sp, ctx, a));
    await tx
      .update(copilotActions)
      .set({ status: 'confirmed', result, ...decided })
      .where(eq(copilotActions.id, a.id));
    return { status: 'confirmed' as const, result };
  } catch (e) {
    const de = toDomainError(e);
    if (!de) throw e;
    await tx
      .update(copilotActions)
      .set({
        status: 'failed',
        errorCode: de.code,
        // The refusal's params, so the card can say it in full.
        result: { params: de.params ?? {} },
        ...decided,
      })
      .where(eq(copilotActions.id, a.id));
    return { status: 'failed' as const, code: de.code, params: de.params ?? {} };
  }
}

/** The owner confirms: the action runs through its domain service as the owner. */
export async function confirmCopilotAction(tx: Tx, ctx: ServiceContext, id: string) {
  const a = await loadAction(tx, id, 'confirm');
  return runAction(tx, ctx, a, { alone: false });
}

export async function dismissCopilotAction(tx: Tx, ctx: ServiceContext, id: string) {
  await loadAction(tx, id, 'dismiss');
  await tx
    .update(copilotActions)
    .set({ status: 'dismissed', decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(copilotActions.id, id)));
}

/**
 * Takes a confirmed action back: a child returns to the group they left from the same date; makeup slots nobody booked
 * are cancelled; a payment link nobody paid is cancelled; a booked makeup is cancelled (the credit is open again); a
 * freeze is cancelled; a substitute search nobody took yet is withdrawn.
 */
export async function undoCopilotAction(tx: Tx, ctx: ServiceContext, id: string) {
  const a = await loadAction(tx, id, 'undo');
  switch (a.kind as CopilotActionKind) {
    case 'move_student': {
      const p = a.params as ProposalParams['move_student'];
      if (p.fromGroupId) {
        await placeStudent(tx, ctx, {
          studentId: p.studentId,
          fromTemplateId: p.toGroupId,
          toTemplateId: p.fromGroupId,
          onDate: p.onDate,
          status: 'active',
        });
      } else {
        await removeStudent(tx, ctx, {
          studentId: p.studentId,
          templateId: p.toGroupId,
          onDate: p.onDate,
        });
      }
      break;
    }
    case 'open_makeup_slots': {
      const { slotIds } = a.result as { slotIds: string[] };
      const [{ n } = { n: 0 }] = await rows<{ n: number }>(
        tx,
        sql`select count(*)::int n from slot_bookings
            where slot_id = any(${slotIds}::uuid[]) and status = 'booked'`,
      );
      if (n > 0) throw new DomainError('agent.errors.slotsBooked', { n });
      for (const slotId of slotIds) await cancelSlot(tx, ctx, slotId);
      break;
    }
    case 'book_makeup':
      await cancelMakeupBooking(tx, ctx, (a.result as { bookingId: string }).bookingId);
      break;
    case 'freeze':
      await decideFreeze(tx, ctx, (a.result as { freezeId: string }).freezeId, 'cancelled');
      break;
    case 'substitute':
      await cancelSubstituteRequest(
        tx,
        (a.result as { substituteRequestId: string }).substituteRequestId,
      );
      break;
    default: {
      const { linkId } = a.result as { linkId: string };
      await cancelPaymentLink(tx, linkId);
    }
  }
  await tx
    .update(copilotActions)
    .set({ status: 'undone', undoneAt: new Date() })
    .where(eq(copilotActions.id, id));
}
