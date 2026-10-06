/**
 * The owner's copilot (brief §6.15). A request runs the model with read tools and propose tools inside the owner's own
 * transaction (RLS as the owner); proposals are stored and wait. Confirming one runs the same domain service the
 * screens use (placeStudent, sendToTargets, openSlots), as the owner, under the same policies; the copilot tables and
 * those services write the audit log. Read tools query as the owner, like the reports read model.
 */
import { randomUUID } from 'node:crypto';
import {
  SLOT_DEFAULT_CAPACITY,
  type CopilotActionKind,
  type CopilotActionStatus,
} from '@rswim/contracts';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@rswim/db';
import { debtsDashboard } from '@rswim/domain-billing';
import { schoolName, sendToTargets } from '@rswim/domain-comms';
import { DomainError, toDomainError, type ServiceContext } from '@rswim/domain-core';
import {
  openSlots,
  placeStudent,
  previewPlacement,
  removeStudent,
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
import {
  actionStep,
  copilotGate,
  copilotSystem,
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
  kind: CopilotActionKind;
  params: unknown;
  summary: Explanation;
}

const one = <T>(xs: T[], code = 'common.errors.notFound'): T => {
  const x = xs[0];
  if (!x) throw new DomainError(code);
  return x;
};

/** The tools bound to one request: reads run as the owner; proposals are checked and collected, never applied. */
export function copilotToolbox(tx: Tx, today: string) {
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
          sql`select t.name "group", v.name venue, to_char(s.starts_at at time zone 'Asia/Jerusalem', 'HH24:MI') "time",
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
      case 'propose_move_student':
        return propose('move_student', input);
      case 'propose_message_family':
        return propose('message_family', input);
      case 'propose_open_makeup_slots':
        return propose('open_makeup_slots', input);
      default:
        throw new DomainError('copilot.errors.unknownTool');
    }
  };

  async function propose(kind: CopilotActionKind, raw: unknown) {
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
    proposals.push({ kind, params: parsed.params, summary });
    return { proposed: true, waitsForOwner: true, summary };
  }

  return { call, proposals };
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
    const intent = fakeIntent(input.prompt);
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
        const out = await use('propose_move_student', {
          studentId: s.id,
          fromGroupId: s.groups[0]?.id ?? null,
          toGroupId: g.id,
          onDate,
        });
        return done(
          out
            ? `הכנתי הצעה להעביר את ${s.name} ל${g.name} מ-${onDate}. היא מחכה לאישור שלך.`
            : 'המעבר הזה לא עומד בכללים.',
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
      case 'slots': {
        type Staff = { id: string; name: string; venues: { id: string }[] };
        const m = (await use<Staff[]>('find_staff', { query: intent.staff }))?.[0];
        const venueId = m?.venues[0]?.id;
        if (!m || !venueId) return done('לא מצאתי את המדריך/ה או בריכה שבה הוא/היא זמין/ה.');
        const out = await use('propose_open_makeup_slots', {
          staffId: m.id,
          venueId,
          date: intent.date,
          startsAt: intent.from,
          endsAt: intent.to,
        });
        return done(
          out
            ? `הכנתי הצעה לפתוח השלמות עם ${m.name}. היא מחכה לאישור שלך.`
            : 'אי אפשר לפתוח את ההשלמות האלה.',
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
          'אני (גרסת הדמו) מבין/ה: "תעביר את <ילד> ל<קבוצה>", "תשלח ל<ילד>: <הודעה>", "תפתח השלמות עם <מדריך> ב-<תאריך> <שעה>-<שעה>", "מי חייב", "מה יש היום".',
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
  const box = copilotToolbox(tx, today);
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
  const requestId = randomUUID();
  await tx.insert(copilotRequests).values({
    id: requestId,
    organizationId: ctx.orgId,
    userId: ctx.userId as string,
    prompt: text,
    model: (model as CopilotModel).name,
    status: out ? 'answered' : 'failed',
    answer: out?.answer ?? null,
    trace: out?.trace ?? [],
    errorCode: out
      ? out.incomplete
        ? 'copilot.errors.incomplete'
        : null
      : 'copilot.errors.modelFailed',
  });
  if (out && box.proposals.length) {
    await tx.insert(copilotActions).values(
      box.proposals.map((p) => ({
        organizationId: ctx.orgId,
        requestId,
        kind: p.kind,
        params: p.params,
        summary: p.summary,
      })),
    );
  }
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
 * The owner confirms: the action runs through its domain service as the owner. A refusal by the rules is stored on
 * the action (status failed, with the reason) instead of failing the request.
 */
export async function confirmCopilotAction(tx: Tx, ctx: ServiceContext, id: string) {
  const a = await loadAction(tx, id, 'confirm');
  try {
    const result = await tx.transaction((sp) => apply(sp, ctx, a));
    await tx
      .update(copilotActions)
      .set({ status: 'confirmed', result, decidedBy: ctx.userId, decidedAt: new Date() })
      .where(eq(copilotActions.id, id));
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
        decidedBy: ctx.userId,
        decidedAt: new Date(),
      })
      .where(eq(copilotActions.id, id));
    return { status: 'failed' as const, code: de.code, params: de.params ?? {} };
  }
}

export async function dismissCopilotAction(tx: Tx, ctx: ServiceContext, id: string) {
  await loadAction(tx, id, 'dismiss');
  await tx
    .update(copilotActions)
    .set({ status: 'dismissed', decidedBy: ctx.userId, decidedAt: new Date() })
    .where(and(eq(copilotActions.id, id)));
}

/** Undoes a confirmed move: the child goes back to the group they left, from the same date. */
export async function undoCopilotAction(tx: Tx, ctx: ServiceContext, id: string) {
  const a = await loadAction(tx, id, 'undo');
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
  await tx
    .update(copilotActions)
    .set({ status: 'undone', undoneAt: new Date() })
    .where(eq(copilotActions.id, id));
}
