/**
 * Phase 3 demo data for the demo tenant: the forms and the regulations, some accepted, attendance for September's
 * lessons, absence notices with their credits (one booked into a makeup), a prospective child with a trial, and
 * progress ticks. Everything goes through the domain services as the tenant's worker, so the rules apply. All fake.
 */
import { createDb, type Tx } from '@rswim/db';
import {
  bookMakeup,
  makeupOffers,
  recordAttendance,
  reportAbsence,
  setProgress,
} from '@rswim/domain-attendance';
import { DomainError, type ServiceContext } from '@rswim/domain-core';
import {
  bookTrial,
  createFormVersion,
  currentForms,
  publishFormVersion,
  submitForm,
} from '@rswim/domain-enrollment';
import type pg from 'pg';

const SEASON_START = '2026-09-01';

export interface AttendanceDataSummary {
  forms: number;
  submissions: number;
  marks: number;
  notices: number;
  credits: number;
  makeups: number;
  trials: number;
  progress: number;
}

const FORMS = [
  {
    kind: 'regulations',
    title: 'תקנון בית הספר לשחייה (דמו)',
    body: [
      'נוסח לדוגמה בלבד, לא התקנון האמיתי.',
      'הודעה על היעדרות עד 12 שעות לפני השיעור מזכה בשיעור השלמה אחד בחודש, לניצול עד סוף אותו חודש.',
      'הודעה מאוחרת יותר אינה מזכה בהשלמה. היעדרות אינה מזכה בהחזר.',
      'ביטול מנוי עד ה-25 לחודש נכנס לתוקף בסוף החודש.',
      'כשהבריכה נסגרת מסיבה חיצונית נשתדל לתת השלמה עד המועד שנפרסם.',
    ].join('\n'),
    questions: '',
  },
  {
    kind: 'health_declaration',
    title: 'הצהרת בריאות (דמו)',
    body: 'אני מצהיר/ה שמצב בריאותו של הילד/ה מאפשר פעילות שחייה, ושאעדכן על כל שינוי. (נוסח לדוגמה)',
    questions: [
      'האם יש לילד/ה מגבלה רפואית שהמדריך צריך לדעת עליה?',
      'האם הילד/ה נוטל/ת תרופות קבועות?',
      'האם היו פרכוסים או אובדן הכרה?',
    ].join('\n'),
  },
  {
    kind: 'photo_consent',
    title: 'הסכמה לצילום (דמו)',
    body: 'מותר לצלם את הילד/ה בשיעורים לצורכי פרסום של בית הספר. אפשר לבטל בכל עת. (נוסח לדוגמה)',
    questions: '',
  },
] as const;

export async function seedAttendanceData(
  client: pg.PoolClient,
  orgId: string,
): Promise<AttendanceDataSummary> {
  const rows = async <T>(text: string, params: unknown[] = []) =>
    (await client.query(text, params)).rows as T[];
  await client.query(
    `select set_config('app.org_id', $1, true), set_config('request.jwt.claims', '{}', true)`,
    [orgId],
  );
  await client.query('set local role rswim_system');
  const tx = createDb(client) as unknown as Tx;
  const ctx: ServiceContext = { orgId, userId: null };
  const summary: AttendanceDataSummary = {
    forms: 0,
    submissions: 0,
    marks: 0,
    notices: 0,
    credits: 0,
    makeups: 0,
    trials: 0,
    progress: 0,
  };

  // ─── Forms, and who accepted them ───────────────────────────────────────────
  for (const f of FORMS) {
    const id = await createFormVersion(tx, ctx, { ...f, effectiveFrom: SEASON_START });
    await publishFormVersion(tx, ctx, id);
    summary.forms++;
  }
  const forms = await currentForms(tx, SEASON_START);
  const formOf = (kind: string) => forms.find((f) => f.kind === kind)?.id as string;
  // Families with a child in a group accepted at registration, except the parent persona's (Cohen) and one more, who
  // still have forms waiting in the portal.
  const families = await rows<{ household_id: string; display_name: string; students: string[] }>(
    `select s.household_id, h.display_name, array_agg(distinct s.id) students
     from enrollments e join students s on s.id = e.student_id join households h on h.id = s.household_id
     where e.organization_id = $1 and e.status = 'active'
     group by s.household_id, h.display_name order by h.display_name`,
    [orgId],
  );
  const waiting = families.find((f) => !f.display_name.includes('כהן'))?.display_name;
  for (const f of families) {
    if (f.display_name.includes('כהן') || f.display_name === waiting) continue;
    await submitForm(tx, ctx, {
      formTemplateId: formOf('regulations'),
      householdId: f.household_id,
      channel: 'owner_recorded',
    });
    summary.submissions++;
    for (const studentId of f.students) {
      await submitForm(tx, ctx, {
        formTemplateId: formOf('health_declaration'),
        householdId: f.household_id,
        studentId,
        answers: { q1: false, q2: false, q3: false },
        channel: 'paper',
      });
      summary.submissions++;
    }
  }

  // ─── Attendance for the lessons already taught (most present, one late, one away) ──
  const past = await rows<{ id: string; starts_at: Date; name: string }>(
    `select s.id, s.starts_at, ct.name from sessions s join class_templates ct on ct.id = s.class_template_id
     where s.organization_id = $1 and s.status = 'scheduled' and s.starts_at < now()
       and ct.name in ('בנות צפרדע', 'בנות דולפין', 'בנים צפרדע', 'גוש שלישי')
     order by s.starts_at`,
    [orgId],
  );
  for (const s of past) {
    const members = await rows<{ student_id: string }>(
      `select e.student_id from enrollments e join sessions x on x.class_template_id = e.class_template_id
       where x.id = $1 and e.status in ('active', 'frozen', 'cancel_requested') and e.starts_on <= x.date
         and (e.ends_on is null or e.ends_on > x.date) order by e.student_id`,
      [s.id],
    );
    if (members.length === 0) continue;
    const at = new Date(s.starts_at.getTime() + 5 * 60_000).toISOString();
    const r = await recordAttendance(
      tx,
      ctx,
      s.id,
      members.map((m, i) => ({
        studentId: m.student_id,
        status: i === 1 ? 'late' : i === 2 ? 'absent' : 'present',
        minutesLate: i === 1 ? 5 : null,
        clientMarkId: `seed-${s.id.slice(0, 8)}-${i}`,
        markedAt: at,
      })),
    );
    summary.marks += r.applied;
  }

  // ─── Absence notices: two timely (credits), one late; one credit booked into a makeup ──
  const upcoming = await rows<{
    session_id: string;
    student_id: string;
    starts_at: Date;
    name: string;
  }>(
    `select distinct on (ct.name) s.id session_id, e.student_id, s.starts_at, ct.name
     from sessions s join class_templates ct on ct.id = s.class_template_id
     join enrollments e on e.class_template_id = ct.id and e.status = 'active' and e.starts_on <= s.date
       and (e.ends_on is null or e.ends_on > s.date)
     where s.organization_id = $1 and s.status = 'scheduled' and s.starts_at > now() + interval '2 days'
       and ct.name in ('בנות דולפין', 'בנים צפרדע', 'בנות כריש')
     order by ct.name, s.starts_at, e.student_id`,
    [orgId],
  );
  const israel = (d: Date) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Jerusalem',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(d)
      .replace(' ', 'T');
  const creditIds: string[] = [];
  for (const [i, u] of upcoming.entries()) {
    const hoursBefore = i === 2 ? 3 : 30;
    const outcome = await reportAbsence(tx, ctx, {
      sessionId: u.session_id,
      studentId: u.student_id,
      channel: i === 0 ? 'whatsapp' : 'phone',
      receivedAt: israel(new Date(u.starts_at.getTime() - hoursBefore * 3_600_000)),
      note: 'הודעה לדוגמה',
    });
    summary.notices++;
    if (outcome.creditId) {
      creditIds.push(outcome.creditId);
      summary.credits++;
    }
  }
  if (creditIds[0]) {
    const { offers } = await makeupOffers(tx, creditIds[0]);
    const offer = offers.find((o) => o.decision.ok);
    if (offer) {
      await bookMakeup(tx, ctx, { creditId: creditIds[0], sessionId: offer.sessionId });
      summary.makeups++;
    }
  }

  // ─── A prospective family with a trial next week ────────────────────────────
  await client.query('reset role');
  const [h] = await rows<{ id: string }>(
    `insert into households (organization_id, display_name, notes) values ($1, 'משפחת לוי (ליד)', 'הגיעו מהפייסבוק (דמו)') returning id`,
    [orgId],
  );
  await client.query(
    `insert into guardians (organization_id, household_id, first_name, last_name, relation, phone_e164, is_billing_contact)
     values ($1, $2, 'אורית', 'לוי', 'mother', '+972500009901', true)`,
    [orgId, h?.id],
  );
  const [lead] = await rows<{ id: string }>(
    `insert into students (organization_id, household_id, first_name, last_name, dob, gender)
     values ($1, $2, 'שירה', 'לוי', '2020-04-12', 'female') returning id`,
    [orgId, h?.id],
  );
  await client.query('set local role rswim_system');
  const trialSessions = await rows<{ id: string }>(
    `select s.id from sessions s join class_templates ct on ct.id = s.class_template_id
     where s.organization_id = $1 and s.status = 'scheduled' and s.starts_at > now() + interval '1 day'
       and ct.name in ('בנות צפרדע', 'מעורבת ראשון') order by s.starts_at limit 6`,
    [orgId],
  );
  for (const s of trialSessions) {
    try {
      await bookTrial(tx, ctx, {
        studentId: lead?.id as string,
        sessionId: s.id,
        notes: 'ליד מהקמפיין (דמו)',
      });
      summary.trials++;
      break;
    } catch (e) {
      if (!(e instanceof DomainError)) throw e;
    }
  }

  // ─── Progress: the first skill of their level for the frog girls ────────────
  const ticks = await rows<{ student_id: string; level_id: string; skill: string }>(
    `select s.id student_id, s.level_id, l.skills -> 0 ->> 'code' skill
     from enrollments e join class_templates ct on ct.id = e.class_template_id
     join students s on s.id = e.student_id join levels l on l.id = s.level_id
     where e.organization_id = $1 and ct.name = 'בנות דולפין' and e.status = 'active'
       and jsonb_array_length(l.skills) > 0`,
    [orgId],
  );
  for (const p of ticks) {
    await setProgress(tx, ctx, {
      studentId: p.student_id,
      levelId: p.level_id,
      skillCode: p.skill,
      achieved: true,
    });
    summary.progress++;
  }

  await client.query('reset role');
  return summary;
}
