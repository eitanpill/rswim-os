/**
 * The demo clubs' forms (invented sample texts, not legal or medical advice) and every diver's signatures, made to
 * agree with the dates already on their file: a waiver signed on the day the file says, a health declaration that
 * runs out when the file says, and an insurance policy for most active divers. A few health declarations wait for
 * the club's clearance, and a few policies are about to end, so the paperwork screens have something to show.
 * Runs after the club is seeded, with its own random stream, so the rest of the demo data does not move.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';

export const HEALTH_QUESTIONS = [
  {
    code: 'heart',
    he: 'האם אובחנת אי פעם במחלת לב, הפרעת קצב, או שאתה/את נוטל/ת תרופות ללב או ללחץ דם?',
    flag: true,
  },
  {
    code: 'lungs',
    he: 'האם יש או הייתה לך אסתמה, מחלת ריאות, או קריסת ריאה (פנאומוטורקס)?',
    flag: true,
  },
  {
    code: 'epilepsy',
    he: 'האם סבלת אי פעם מאפילפסיה, פרכוסים, אובדן הכרה או עילפונים?',
    flag: true,
  },
  { code: 'diabetes', he: 'האם יש לך סוכרת שמטופלת בתרופות או באינסולין?', flag: true },
  {
    code: 'ears',
    he: 'האם עברת ניתוח באוזניים או בסינוסים, או שיש לך קושי חוזר להשוות לחץ?',
    flag: true,
  },
  { code: 'surgery', he: 'האם עברת ניתוח או אשפוז בשנה האחרונה?', flag: true },
  { code: 'pregnant', he: 'האם את בהיריון או שייתכן שאת בהיריון?', flag: true },
  {
    code: 'meds',
    he: 'האם את/ה נוטל/ת כרגע תרופות קבועות (מלבד גלולות או ויטמינים)?',
    flag: false,
  },
  { code: 'cold', he: 'האם יש לך כרגע הצטננות, גודש או דלקת אוזניים?', flag: false },
  { code: 'blackout', he: 'האם היה לך בעבר אובדן הכרה (בלאקאאוט) או סמבה בצלילה?', flag: false },
] as const;

const HEALTH_BODY = `הצהרת בריאות לצלילה חופשית (נוסח לדוגמה)

צלילה חופשית היא פעילות בעצירת נשימה, ומצבים רפואיים מסוימים מגדילים בה את הסיכון. כדי שנוכל לשמור עליך, ענה/י בכנות על כל השאלות. תשובת "כן" אינה פוסלת אותך: היא אומרת שנבקש אישור רופא או שנבדוק יחד לפני הכניסה למים.

אני מצהיר/ה כי:
1. התשובות שנתתי נכונות ומלאות.
2. אעדכן את המועדון לפני כל צלילה אם חל שינוי במצבי הבריאותי.
3. ידוע לי שהמועדון רשאי שלא לאפשר לי להיכנס למים אם מצבי אינו מאפשר זאת בבטחה.

ההצהרה תקפה לשנה מיום החתימה.`;

const WAIVER_BODY = `כתב ויתור, הסכמה ושחרור מאחריות (נוסח לדוגמה)

1. ידוע לי שצלילה חופשית, ביחס לכל פעילות במים פתוחים ובבריכה, כרוכה בסיכונים, ובהם אובדן שליטה מוטורית (סמבה), אובדן הכרה, פגיעות לחץ באוזניים, בסינוסים ובריאות, פגיעה מבעלי חיים ימיים, וכן סיכונים הנובעים ממזג האוויר ומתנאי הים.
2. אני מתחייב/ת לפעול לפי הוראות המדריכים ונהלי הבטיחות של המועדון, לצלול רק עם בן/בת זוג (באדי) ובחבל מסומן, ולא לחרוג מהעומק שאושר לי.
3. אני מאשר/ת שאני כשיר/ה לפעילות, שמילאתי הצהרת בריאות נכונה, ושאודיע למדריך על כל שינוי או תחושה חריגה.
4. בכפוף לדין, אני משחרר/ת את המועדון, עובדיו ומדריכיו מאחריות לנזק שייגרם לי כתוצאה מהסיכונים הטבועים בפעילות, למעט נזק שנגרם ברשלנות.
5. אני מסכים/ה לצילום במהלך הפעילות לצורכי בטיחות והדרכה.

כתב הוויתור תקף לשנה מיום החתימה.`;

const INSURANCE_BODY = `עדכון ביטוח צלילה (נוסח לדוגמה)

המועדון ממליץ לכל צולל/ת להחזיק ביטוח בתוקף שמכסה צלילה חופשית, כולל חילוץ ופינוי. מלאו את פרטי הפוליסה ואת תאריך הסיום, וצרפו צילום אם יש. נזכיר לכם לפני שהביטוח נגמר.`;

const INSURERS_IL = ['הראל', 'מגדל', 'הפניקס', 'כלל', 'DAN Europe'];
const INSURERS_ABROAD = ['DAN Europe', 'DAN America', 'Divemaster Insurance', 'AXA'];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A believable scribble on the 600x200 pad, different per diver. */
function scribble(random: () => number): number[][][] {
  const strokes: number[][][] = [];
  let x = 40 + Math.floor(random() * 40);
  const parts = 2 + Math.floor(random() * 2);
  for (let p = 0; p < parts; p++) {
    const s: number[][] = [];
    const amp = 25 + random() * 45;
    const freq = 0.04 + random() * 0.06;
    const len = 90 + Math.floor(random() * 120);
    for (let i = 0; i <= len; i += 6) {
      const y = 100 + Math.sin((x + i) * freq) * amp + (random() - 0.5) * 10;
      s.push([Math.min(600, x + i), Math.max(0, Math.min(200, Math.round(y)))]);
    }
    strokes.push(s);
    x = Math.min(520, x + len + 20);
  }
  return strokes;
}

export async function seedDiveForms(
  client: pg.PoolClient,
  orgId: string,
  opts: { seed: number; hero: boolean; deskUserId?: string; danaId?: string },
): Promise<{ templates: number; signatures: number; pending: number }> {
  const random = rng(opts.seed);
  const chance = (p: number) => random() < p;
  const between = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)] as T;

  const tpl = async (kind: string, title: string, body: string, questions: unknown[]) => {
    const id = randomUUID();
    await client.query(
      `insert into dive_form_templates (id, organization_id, kind, version, title, body, questions, published_at)
       values ($1, $2, $3, 1, $4, $5, $6::jsonb, now() - interval '200 days')`,
      [id, orgId, kind, title, body, JSON.stringify(questions)],
    );
    return id;
  };
  const health = await tpl('health', 'הצהרת בריאות', HEALTH_BODY, [...HEALTH_QUESTIONS]);
  const waiver = await tpl('waiver', 'כתב ויתור ושחרור מאחריות', WAIVER_BODY, []);
  const insurance = await tpl('insurance', 'עדכון ביטוח צלילה', INSURANCE_BODY, []);
  if (opts.hero) {
    // The manager is rewording the waiver: a draft waits to be published.
    await client.query(
      `insert into dive_form_templates (organization_id, kind, version, title, body, questions)
       values ($1, 'waiver', 2, 'כתב ויתור ושחרור מאחריות', $2, '[]'::jsonb)`,
      [
        orgId,
        `${WAIVER_BODY}\n\n6. ידוע לי שבימים שבהם הים סגור (החלטת המועדון) לא תתקיים צלילה בים.`,
      ],
    );
  }

  const divers = (
    await client.query<{
      id: string;
      name: string;
      origin: string;
      waiver: string | null;
      medical: string | null;
      active: boolean;
      booked: boolean;
    }>(
      `select d.id, d.first_name || ' ' || d.last_name as name, d.origin,
              d.waiver_signed_on::text as waiver, d.medical_expires_on::text as medical,
              exists (select 1 from dive_logs l where l.diver_id = d.id and l.dived_on > current_date - 120) as active,
              exists (select 1 from dive_bookings b join dive_sessions x on x.id = b.session_id
                      where b.diver_id = d.id and x.starts_at > now() and b.status in ('booked', 'pending_payment')) as booked
       from dive_divers d where d.organization_id = $1 order by d.created_at, d.id`,
      [orgId],
    )
  ).rows;

  const rows: unknown[][] = [];
  const no = Object.fromEntries(HEALTH_QUESTIONS.map((q) => [q.code, 'no']));
  const sign = (
    diver: (typeof divers)[number],
    template: string,
    kind: string,
    signedAt: string,
    extra: { answers?: object; insurer?: string; policy?: string; until?: string } = {},
  ) => {
    const desk = chance(0.35) && opts.deskUserId;
    rows.push([
      orgId,
      diver.id,
      template,
      kind,
      JSON.stringify(extra.answers ?? (kind === 'health' ? no : {})),
      diver.name,
      JSON.stringify(scribble(random)),
      `${signedAt}T${String(between(8, 18)).padStart(2, '0')}:${String(between(0, 59)).padStart(2, '0')}:00+03:00`,
      desk ? 'desk' : 'online',
      desk ? opts.deskUserId : null,
      extra.insurer ?? null,
      extra.policy ?? null,
      extra.until ?? null,
    ]);
  };

  const today = (await client.query<{ d: string }>(`select app.today()::text as d`)).rows[0]
    ?.d as string;
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const monthsBack = (date: string, months: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - months);
    return d.toISOString().slice(0, 10);
  };

  // Health declarations waiting for clearance: booked divers whose medical is missing or out of date.
  const pendingFor = new Set(
    divers
      .filter((d) => d.booked && d.id !== opts.danaId && (!d.medical || d.medical < today))
      .slice(0, opts.hero ? 2 : 1)
      .map((d) => d.id),
  );

  for (const d of divers) {
    if (d.waiver) sign(d, waiver, 'waiver', d.waiver);
    // The declaration that gave today's medical date (the database adds the rules' 12 months back on).
    if (d.medical) sign(d, health, 'health', monthsBack(d.medical, 12));
    if (pendingFor.has(d.id)) {
      const flagged = pick(HEALTH_QUESTIONS.filter((q) => q.flag && q.code !== 'pregnant'));
      sign(d, health, 'health', shift(today, -between(0, 2)), {
        answers: { ...no, [flagged.code]: 'yes' },
      });
    }
    const insured =
      d.id === opts.danaId || ((d.active || d.booked) && chance(0.85)) || chance(0.25);
    if (insured) {
      const until =
        d.id === opts.danaId
          ? shift(today, 12)
          : chance(0.1)
            ? shift(today, between(2, 28))
            : chance(0.05)
              ? shift(today, -between(3, 40))
              : shift(today, between(40, 330));
      // A policy that has already ended was entered while it was still valid.
      const signedAt =
        until < today ? shift(until, -between(60, 300)) : shift(today, -between(1, 300));
      sign(d, insurance, 'insurance', signedAt < until ? signedAt : shift(until, -1), {
        insurer: d.origin === 'abroad' ? pick(INSURERS_ABROAD) : pick(INSURERS_IL),
        policy: `${pick(['PL', 'DV', 'IN'])}-${between(100000, 999999)}`,
        until,
      });
    }
  }

  // Oldest first, so each diver's file ends on their latest signature.
  rows.sort((a, b) => String(a[7]).localeCompare(String(b[7])));
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `insert into dive_form_signatures (organization_id, diver_id, template_id, kind, answers, signer_name,
         signature, signed_at, channel, recorded_by, insurer, policy_number, valid_until, text_hash)
       select o::uuid, dv::uuid, t::uuid, k, a::jsonb, n, s::jsonb, at::timestamptz, ch, rb::uuid, ins, pol, vu::date, ''
       from (values ${tuples.join(', ')}) v(o, dv, t, k, a, n, s, at, ch, rb, ins, pol, vu)`,
      params,
    );
  }
  return { templates: opts.hero ? 4 : 3, signatures: rows.length, pending: pendingFor.size };
}
