/**
 * Fake data for the freediving vertical: an Eilat club ("כחול עמוק אילת") with its staff, sites, programs, ~110 divers
 * (Eilat locals, Israelis from the centre, guests from abroad), eight weeks of sessions behind and two ahead, every
 * booking, logged dive, sale, pass, rental, lead, incident and sea report, plus a smaller Haifa club on a trial.
 * Dates are relative to the day the seed runs, so the demo always looks like "this week". Every name is invented.
 */
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { DIVE_MANAGER_PERMISSIONS, DIVE_ORG, DIVE_ORG_2, DIVE_PERSONAS } from '@rswim/db/personas';

/** A lookup into the seed's own tables that must exist; fails loudly if the data is edited inconsistently. */
function need<T>(v: T | undefined | null): T {
  if (v === undefined || v === null) throw new Error('dive seed: missing lookup');
  return v;
}

export interface DiveDataSummary {
  divers: number;
  sessions: number;
  bookings: number;
  logs: number;
  sales: number;
}

// ─── Small helpers ──────────────────────────────────────────────────────────

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
}

/** Today in Israel (YYYY-MM-DD). */
export function todayInIsrael(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** A wall-clock time in Israel as a real instant (handles summer time). */
function il(date: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':');
  const guess = new Date(`${date}T${String(h).padStart(2, '0')}:${m}:00Z`);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(guess);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const wall = new Date(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:00Z`,
  );
  return new Date(guess.getTime() - (wall.getTime() - guess.getTime()));
}

const plusMinutes = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);

async function insertMany(
  client: pg.PoolClient,
  table: string,
  cols: string[],
  values: unknown[][],
): Promise<void> {
  for (let i = 0; i < values.length; i += 400) {
    const chunk = values.slice(i, i + 400);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const ph = row.map((v) => {
        params.push(v);
        return `$${params.length}`;
      });
      return `(${ph.join(', ')})`;
    });
    await client.query(
      `insert into ${table} (${cols.join(', ')}) values ${tuples.join(', ')}`,
      params,
    );
  }
}

// ─── Names ──────────────────────────────────────────────────────────────────

const HE_WOMEN = [
  'נועה',
  'תמר',
  'מאיה',
  'יעל',
  'שירה',
  'הדס',
  'רוני',
  'ליאור',
  'מיכל',
  'עדי',
  'גלי',
  'קרן',
  'רותם',
  'אורית',
  'ענבל',
  'סיון',
  'הילה',
  'טל',
  'ליה',
  'נגה',
];
const HE_MEN = [
  'יונתן',
  'איתי',
  'דניאל',
  'אריאל',
  'עידו',
  'נדב',
  'עומר',
  'אלון',
  'גיא',
  'אסף',
  'תומר',
  'ניר',
  'רועי',
  'שחר',
  'עמית',
  'אביב',
  'בן',
  'אופק',
  'יאיר',
  'אלעד',
];
const HE_LAST = [
  'כהן',
  'לוי',
  'מזרחי',
  'פרץ',
  'ביטון',
  'אברהם',
  'פרידמן',
  'שפירא',
  'אזולאי',
  'גולן',
  'רוזן',
  'כץ',
  'ברק',
  'שגיא',
  'אלמוג',
  'נחום',
  'דהן',
  'חדד',
  'סער',
  'ים',
];
const ABROAD: [string, string, string, 'female' | 'male'][] = [
  ['Lena', 'Schmidt', 'גרמניה', 'female'],
  ['Jonas', 'Weber', 'גרמניה', 'male'],
  ['Camille', 'Durand', 'צרפת', 'female'],
  ['Hugo', 'Martin', 'צרפת', 'male'],
  ['Olivia', 'Brown', 'בריטניה', 'female'],
  ['Sam', 'Taylor', 'בריטניה', 'male'],
  ['Anya', 'Volkova', 'רוסיה', 'female'],
  ['Dmitri', 'Orlov', 'רוסיה', 'male'],
  ['Emma', 'de Vries', 'הולנד', 'female'],
  ['Lucas', 'Jansen', 'הולנד', 'male'],
  ['Mia', 'Johnson', 'ארה״ב', 'female'],
  ['Noah', 'Miller', 'ארה״ב', 'male'],
  ['Sofia', 'Rossi', 'איטליה', 'female'],
  ['Marco', 'Bianchi', 'איטליה', 'male'],
  ['Ingrid', 'Larsen', 'נורווגיה', 'female'],
  ['Petr', 'Novak', 'צ׳כיה', 'male'],
];
const CITIES = [
  'תל אביב',
  'תל אביב',
  'חיפה',
  'ירושלים',
  'באר שבע',
  'הרצליה',
  'רמת גן',
  'מודיעין',
  'ראשון לציון',
  'כפר סבא',
  'רעננה',
  'נתניה',
];
const TAGS = [
  'slow_equalizer',
  'cold_sensitive',
  'photographer',
  'competition',
  'vip',
  'motion_sickness',
];
const SOURCES = ['instagram', 'google', 'referral', 'hotel', 'walk_in', 'whatsapp'];

// ─── The club ───────────────────────────────────────────────────────────────

interface Diver {
  id: string;
  first: string;
  last: string;
  origin: 'eilat' | 'israel' | 'abroad';
  level: number;
  pb: number | null;
  sta: number | null;
  dyn: number | null;
  /** Comes to sea training on weekdays (locals) or weekends (visitors). */
  weekday: boolean;
  passId: string | null;
  passLeft: number;
  guardianId: string | null;
}

interface Session {
  id: string;
  programCode: string;
  kind: string;
  date: string;
  startsAt: Date;
  capacity: number;
  minLevel: number;
  lead: string;
  maxDepth: number;
  status: string;
  title: string | null;
  price: number;
  programId: string;
}

const PROGRAMS = [
  // code, he, en, kind, agency, minLevel, grants, days, minutes, maxDepth, price (agorot), color, description
  [
    'discover',
    'חוויית צלילה חופשית',
    'Discover freediving',
    'experience',
    'club',
    0,
    1,
    1,
    180,
    8,
    39000,
    '#2dd4bf',
    'שלוש שעות: נשימה ורגיעה על החוף, ואז צלילות ראשונות לאורך חבל, עד 8 מטר. בלי ניסיון קודם.',
  ],
  [
    'wave1',
    'Molchanovs Wave 1',
    'Molchanovs Wave 1',
    'course',
    'molchanovs',
    0,
    2,
    2,
    420,
    16,
    165000,
    '#38bdf8',
    'הקורס הבינלאומי הראשון: תיאוריה, סטטי, השוואת לחצים פרנזל, הצלה, ועד 16 מטר בים.',
  ],
  [
    'wave2',
    'Molchanovs Wave 2',
    'Molchanovs Wave 2',
    'course',
    'molchanovs',
    2,
    3,
    3,
    420,
    30,
    245000,
    '#0ea5e9',
    'נפילה חופשית, היכרות עם מאוטפיל, הצלה מעומק, ועד 30 מטר.',
  ],
  [
    'wave3',
    'Molchanovs Wave 3',
    'Molchanovs Wave 3',
    'course',
    'molchanovs',
    3,
    4,
    4,
    420,
    40,
    320000,
    '#0369a1',
    'מאוטפיל מלא, טבלאות CO2, בטיחות עומק, ועד 40 מטר.',
  ],
  [
    'aida2',
    'AIDA 2 Freediver',
    'AIDA 2 Freediver',
    'course',
    'aida',
    0,
    2,
    2,
    420,
    20,
    175000,
    '#a78bfa',
    'הסמכת AIDA 2 כוכבים: סטטי 2 דקות, דינמי 40 מטר, 12 עד 20 מטר בים.',
  ],
  [
    'aida3',
    'AIDA 3 Advanced',
    'AIDA 3 Advanced',
    'course',
    'aida',
    2,
    3,
    3,
    420,
    30,
    260000,
    '#7c3aed',
    'AIDA 3 כוכבים: סטטי 2:45, דינמי 55 מטר, 24 עד 30 מטר בים.',
  ],
  [
    'line',
    'אימון חבלים בים',
    'Sea line training',
    'training',
    'club',
    2,
    null,
    1,
    150,
    30,
    18000,
    '#14b8a6',
    'אימון עומק על חבלים מהחוף, מדריך לכל שלושה צוללים, צלילה בזוגות.',
  ],
  [
    'deep',
    'אימון עומק מתקדמים',
    'Advanced depth training',
    'training',
    'club',
    3,
    null,
    1,
    150,
    45,
    20000,
    '#0f766e',
    'לבעלי Wave 2 / AIDA 3 ומעלה: חבל עמוק, נגדית ובטיחות עומק.',
  ],
  [
    'pool',
    'אימון בריכה: סטטי ודינמי',
    'Pool: static & dynamic',
    'training',
    'club',
    1,
    null,
    1,
    90,
    null,
    12000,
    '#22d3ee',
    'טבלאות סטטי ודינמי עם בטיחות צמודה.',
  ],
  [
    'eq',
    'סדנת השוואת לחצים ומאוטפיל',
    'Equalization & mouthfill clinic',
    'workshop',
    'club',
    2,
    null,
    1,
    180,
    null,
    35000,
    '#f59e0b',
    'פרנזל, מאוטפיל, תרגול יבש ועבודה על החבל. הבעיה מספר 1 בעומק נפתרת כאן.',
  ],
  [
    'breath',
    'נשימה ויוגה בזריחה',
    'Sunrise breath & yoga',
    'workshop',
    'club',
    0,
    null,
    1,
    75,
    null,
    9000,
    '#fb7185',
    'מתיחות ונשימה סרעפתית על החוף, לפני שהרוח עולה.',
  ],
  [
    'boat',
    'יציאת סירה לעומק',
    'Deep boat trip',
    'trip',
    'club',
    3,
    null,
    1,
    240,
    60,
    32000,
    '#1e40af',
    'יציאה לקצה המדף מדרום לחוף האלמוגים, חבל עד 60 מטר.',
  ],
] as const;

const SITES = [
  [
    'המגדלור',
    'Lighthouse Beach',
    'shore',
    40,
    true,
    'בכניסה לחוף, ליד המקלחות. נפגשים 15 דקות לפני.',
    'המדף יורד מהר: 40 מטר במרחק שחייה קצר. החבלים שלנו קבועים שם.',
  ],
  [
    'הגן היפני',
    'Japanese Gardens',
    'shore',
    30,
    true,
    'ליד מגרש החניה הדרומי.',
    'ריף רדוד ושקט, מושלם לחוויות ולקורסים.',
  ],
  ['סלע משה', 'Moses Rock', 'shore', 20, true, 'בחוף הצפוני של האתר.', 'מפרצון מוגן מרוח צפונית.'],
  [
    'ספינת סטיל',
    'Satil wreck',
    'boat',
    28,
    true,
    'במעגן, רציף 3.',
    'שבר ספינה על חול, 18 עד 28 מטר.',
  ],
  [
    'קצה המדף (סירה)',
    'Drop-off (boat)',
    'boat',
    60,
    true,
    'במעגן, רציף 3. סירת המועדון "כחול 1".',
    'מים פתוחים, חבל עד 60 מטר, ראות עמוקה.',
  ],
  [
    'בריכת המועדון',
    'Club pool',
    'pool',
    4,
    false,
    'בכניסה הראשית של המתחם.',
    'מסלול 25 מטר, מים מחוממים.',
  ],
] as const;

/** Seeds one club. `scale` 1 is the Eilat hero club; smaller numbers make a lighter club. */
async function seedClub(
  client: pg.PoolClient,
  org: { id: string; slug: string; name: string },
  opts: { scale: number; seed: number; hero: boolean; customerGuardianId?: string | null },
): Promise<DiveDataSummary & { staff: Record<string, string>; dana?: string }> {
  const random = rng(opts.seed);
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)] as T;
  const chance = (p: number) => random() < p;
  const between = (a: number, b: number) => a + Math.floor(random() * (b - a + 1));
  const today = todayInIsrael();
  const orgId = org.id;
  let phone = opts.hero ? 3000 : 7000;
  const fakePhone = () => `+9725000${String(phone++).padStart(5, '0')}`;

  // Rules: the club runs on the defaults, with its own (slightly stricter) wind limit.
  const rulesId = randomUUID();
  await client.query(
    `insert into dive_rule_sets (id, organization_id, effective_from, rules, notes) values ($1, $2, $3, $4, $5)`,
    [
      rulesId,
      orgId,
      addDays(today, -200),
      JSON.stringify({ sea: { max_wind_kts: 20, caution_wind_kts: 14 } }),
      'נהלי בטיחות 2026',
    ],
  );

  // Staff
  const staffSpecs: [string, string, string, string][] = opts.hero
    ? [
        ['owner', 'אורי', 'שחר', 'employee'],
        ['manager', 'מאיה', 'ברק', 'employee'],
        ['office', 'שני', 'אלון', 'employee'],
        ['yoav', 'יואב', 'גל', 'freelancer_licensed'],
        ['neta', 'נטע', 'רז', 'freelancer_exempt'],
        ['ron', 'רון', 'לביא', 'employee'],
        ['lior', 'ליאור', 'בן דוד', 'freelancer_exempt'],
      ]
    : [
        ['owner', 'עדי', 'כרמל', 'employee'],
        ['yoav', 'תום', 'שני', 'freelancer_exempt'],
      ];
  const staff: Record<string, string> = {};
  for (const [key, first, last, type] of staffSpecs) {
    const id = randomUUID();
    await client.query(
      `insert into staff_members (id, organization_id, first_name, last_name, employment_type, phone_e164, start_date)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [id, orgId, first, last, type, fakePhone(), addDays(today, -between(200, 1200))],
    );
    staff[key] = id;
  }
  const instructors = opts.hero ? ['yoav', 'neta', 'ron'] : ['yoav'];
  const certs: [string, string, string, string | null, number][] = opts.hero
    ? [
        ['owner', 'instructor', 'Molchanovs Instructor Trainer', 'molchanovs', 410],
        ['owner', 'first_aid', 'עזרה ראשונה וחמצן', null, 190],
        ['owner', 'insurance', 'ביטוח אחריות מקצועית', null, 120],
        ['yoav', 'instructor', 'Molchanovs Instructor', 'molchanovs', 300],
        ['yoav', 'first_aid', 'עזרה ראשונה וחמצן', null, 45],
        ['yoav', 'insurance', 'ביטוח אחריות מקצועית', null, 160],
        ['neta', 'instructor', 'AIDA Instructor', 'aida', 180],
        ['neta', 'first_aid', 'עזרה ראשונה וחמצן', null, 12],
        ['neta', 'insurance', 'ביטוח אחריות מקצועית', null, 250],
        ['ron', 'instructor', 'AIDA Instructor', 'aida', 500],
        ['ron', 'boat_license', 'רישיון משיט', null, 700],
        ['ron', 'insurance', 'ביטוח אחריות מקצועית', null, -2],
        ['lior', 'instructor', 'Safety Freediver', 'club', 90],
        ['lior', 'first_aid', 'עזרה ראשונה וחמצן', null, 9],
      ]
    : [
        ['owner', 'instructor', 'AIDA Instructor', 'aida', 300],
        ['yoav', 'instructor', 'Molchanovs Instructor', 'molchanovs', 200],
      ];
  await insertMany(
    client,
    'dive_staff_certs',
    ['organization_id', 'staff_member_id', 'kind', 'title', 'agency', 'number', 'expires_on'],
    certs.map(([s, kind, title, agency, days]) => [
      orgId,
      staff[s],
      kind,
      title,
      agency,
      `${(agency ?? 'IL').toUpperCase().slice(0, 3)}-${between(10000, 99999)}`,
      addDays(today, days),
    ]),
  );

  // Sites and programs
  const siteIds: Record<string, string> = {};
  for (const [name, nameEn, kind, depth, line, meet, desc] of SITES) {
    const id = randomUUID();
    siteIds[nameEn] = id;
    await client.query(
      `insert into dive_sites (id, organization_id, name, name_en, kind, max_depth_m, has_line, meeting_point, description)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        orgId,
        opts.hero ? name : name.replace('המגדלור', 'חוף דדו'),
        nameEn,
        kind,
        depth,
        line,
        meet,
        desc,
      ],
    );
  }
  const programs: Record<
    string,
    {
      id: string;
      kind: string;
      minLevel: number;
      price: number;
      maxDepth: number;
      he: string;
      grants: number | null;
    }
  > = {};
  for (const [
    code,
    he,
    en,
    kind,
    agency,
    minLevel,
    grants,
    days,
    minutes,
    maxDepth,
    price,
    color,
    desc,
  ] of PROGRAMS) {
    const id = randomUUID();
    programs[code] = { id, kind, minLevel, price, maxDepth: maxDepth ?? 4, he, grants };
    await client.query(
      `insert into dive_programs (id, organization_id, code, name_he, name_en, kind, agency, min_level, grants_level, days, duration_min, max_depth_m, price_agorot, color, description)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        id,
        orgId,
        code,
        he,
        en,
        kind,
        agency,
        minLevel,
        grants,
        days,
        minutes,
        maxDepth,
        price,
        color,
        desc,
      ],
    );
  }

  // Divers
  const divers: Diver[] = [];
  const total = Math.round(110 * opts.scale);
  const diverRows: unknown[][] = [];
  const addDiver = (d: Diver, extra: Partial<Record<string, unknown>> = {}) => {
    divers.push(d);
    const abroad = d.origin === 'abroad';
    const medicalRoll = random();
    diverRows.push([
      d.id,
      orgId,
      d.guardianId,
      d.first,
      d.last,
      extra.phone ?? fakePhone(),
      abroad ? `${d.first.toLowerCase()}@example.test` : null,
      d.origin,
      extra.city ?? (d.origin === 'eilat' ? 'אילת' : d.origin === 'israel' ? pick(CITIES) : null),
      abroad ? (extra.country ?? null) : null,
      `${between(1970, 2004)}-0${between(1, 9)}-1${between(0, 9)}`,
      extra.gender ?? (chance(0.5) ? 'female' : 'male'),
      d.level,
      d.level >= 2 ? (chance(0.6) ? 'molchanovs' : 'aida') : d.level === 1 ? 'club' : null,
      extra.certName ?? certName(d.level, random),
      d.level >= 2 ? `${between(100000, 999999)}` : null,
      d.pb,
      d.pb ? Math.max(5, d.pb - between(0, 4)) : null,
      d.sta,
      d.dyn,
      extra.depthLimit ?? null,
      extra.medical !== undefined
        ? extra.medical
        : d.level === 0 && chance(0.5)
          ? null
          : medicalRoll < 0.07
            ? addDays(today, between(3, 28))
            : medicalRoll < 0.1
              ? addDays(today, -between(5, 60))
              : addDays(today, between(40, 340)),
      extra.waiver !== undefined
        ? extra.waiver
        : chance(0.92)
          ? addDays(today, -between(5, 330))
          : null,
      d.origin === 'abroad' ? 'Emergency contact' : `${pick(HE_WOMEN)} ${d.last}`,
      fakePhone(),
      extra.source ?? pick(SOURCES),
      extra.tags ?? (chance(0.25) ? [pick(TAGS)] : []),
      extra.notes ?? null,
      extra.joined ?? addDays(today, -between(1, 420)),
    ]);
  };

  // Dana: the customer persona. Tel Aviv, discover 7 months ago, Wave 1, Wave 2 (just certified), now training on a
  // punch card and booked into the next Wave 3.
  let dana: Diver | undefined;
  if (opts.hero) {
    dana = {
      id: randomUUID(),
      first: 'דנה',
      last: 'אביב',
      origin: 'israel',
      level: 3,
      pb: 24,
      sta: 225,
      dyn: 75,
      weekday: false,
      passId: null,
      passLeft: 0,
      guardianId: opts.customerGuardianId ?? null,
    };
    addDiver(dana, {
      phone: DIVE_PERSONAS.diveCustomer.phone,
      city: 'תל אביב',
      gender: 'female',
      certName: 'Molchanovs Wave 2',
      medical: addDays(today, 20),
      waiver: addDays(today, -150),
      source: 'instagram',
      tags: ['photographer'],
      joined: addDays(today, -210),
      notes: 'מגיעה מתל אביב כמעט כל סוף שבוע שני. מטרה: 30 מטר עד הקיץ.',
    });
  }
  for (let i = divers.length; i < total; i++) {
    const r = random();
    const origin: Diver['origin'] = r < 0.3 ? 'eilat' : r < 0.85 ? 'israel' : 'abroad';
    const lr = random();
    const level = lr < 0.08 ? 0 : lr < 0.26 ? 1 : lr < 0.56 ? 2 : lr < 0.82 ? 3 : lr < 0.96 ? 4 : 5;
    const pb =
      level === 0
        ? null
        : level === 1
          ? between(5, 9)
          : level === 2
            ? between(12, 21)
            : level === 3
              ? between(21, 31)
              : level === 4
                ? between(31, 44)
                : between(45, 62);
    let first: string;
    let last: string;
    const extra: Record<string, unknown> = {};
    if (origin === 'abroad') {
      const a = pick(ABROAD);
      [first, last] = [a[0], a[1]];
      extra.country = a[2];
      extra.gender = a[3];
    } else {
      const female = chance(0.48);
      first = pick(female ? HE_WOMEN : HE_MEN);
      last = pick(HE_LAST);
      extra.gender = female ? 'female' : 'male';
    }
    if (level >= 4 && chance(0.3)) extra.depthLimit = (pb ?? 30) + 2;
    addDiver(
      {
        id: randomUUID(),
        first,
        last,
        origin,
        level,
        pb,
        sta: level >= 2 ? between(110 + level * 30, 160 + level * 50) : null,
        dyn: level >= 2 ? between(40 + level * 10, 60 + level * 20) : null,
        weekday: origin === 'eilat' ? chance(0.85) : chance(0.2),
        passId: null,
        passLeft: 0,
        guardianId: null,
      },
      extra,
    );
  }
  await insertMany(
    client,
    'dive_divers',
    [
      'id',
      'organization_id',
      'guardian_id',
      'first_name',
      'last_name',
      'phone_e164',
      'email',
      'origin',
      'city',
      'country',
      'dob',
      'gender',
      'cert_level',
      'cert_agency',
      'cert_name',
      'cert_number',
      'pb_cwt_m',
      'pb_fim_m',
      'pb_sta_sec',
      'pb_dyn_m',
      'depth_limit_m',
      'medical_expires_on',
      'waiver_signed_on',
      'emergency_name',
      'emergency_phone',
      'source',
      'tags',
      'notes',
      'joined_on',
    ],
    diverRows,
  );

  // Passes: regulars train on punch cards and monthly or annual memberships.
  const passRows: unknown[][] = [];
  const sales: unknown[][] = [];
  const sale = (
    diverId: string | null,
    kind: string,
    description: string,
    amount: number,
    at: Date,
    method: string,
    programId: string | null = null,
    sessionId: string | null = null,
  ) => {
    sales.push([
      orgId,
      diverId,
      kind,
      description,
      amount,
      method,
      at,
      programId,
      sessionId,
      `R-${10000 + sales.length + 1}`,
      staff.office ?? staff.owner,
    ]);
  };
  const payMethod = () => (chance(0.6) ? 'card' : chance(0.6) ? 'bit' : 'cash');
  for (const d of divers) {
    if (d.level < 2) continue;
    const isDana = d === dana;
    const roll = random();
    if (!isDana && roll > (d.origin === 'eilat' ? 0.75 : d.origin === 'israel' ? 0.3 : 0.05))
      continue;
    const kind = isDana
      ? 'punch10'
      : d.origin === 'eilat'
        ? pick(['punch10', 'monthly', 'annual', 'punch10'])
        : pick(['punch10', 'punch5']);
    const from = isDana
      ? addDays(today, -40)
      : addDays(today, -between(5, kind === 'annual' ? 200 : 50));
    const until =
      kind === 'annual'
        ? addDays(from, 365)
        : kind === 'monthly'
          ? addDays(from, 30)
          : addDays(from, 120);
    const price = { punch5: 82000, punch10: 150000, monthly: 69000, annual: 590000 }[
      kind
    ] as number;
    const total = kind === 'punch5' ? 5 : kind === 'punch10' ? 10 : null;
    const id = randomUUID();
    d.passId = id;
    d.passLeft = isDana ? 6 : (total ?? 999);
    passRows.push([id, orgId, d.id, kind, total, from, until, price]);
    sale(d.id, 'pass', passName(kind), price, il(from, '09:30'), payMethod());
  }
  await insertMany(
    client,
    'dive_passes',
    [
      'id',
      'organization_id',
      'diver_id',
      'kind',
      'sessions_total',
      'valid_from',
      'valid_until',
      'price_agorot',
    ],
    passRows,
  );

  // Sea reports: the last month observed at the Lighthouse, today, and a forecast with a north-wind day.
  const condRows: unknown[][] = [];
  const noGoDays = new Set<string>();
  // The windy day in the forecast lands on the coming weekend, when the most divers are booked.
  const windy = [2, 3, 4].find((i) => weekday(addDays(today, i)) >= 5) ?? 3;
  for (let i = -30; i <= 4; i++) {
    const date = addDays(today, i);
    let wind = between(4, 15);
    let wave = between(15, 70);
    if (i < 0 && chance(0.1)) {
      wind = between(21, 27);
      wave = between(120, 180);
    }
    if (i >= 0)
      [wind, wave] = i === windy ? [23, 140] : i === windy - 1 ? [16, 80] : [9 + i, 30 + i * 5];
    const vis = between(18, 32);
    const call = wind > 20 || wave > 120 ? 'no_go' : wind > 14 || wave > 70 ? 'caution' : 'go';
    if (call === 'no_go') noGoDays.add(date);
    condRows.push([
      orgId,
      siteIds['Lighthouse Beach'],
      date,
      i > 0,
      wind,
      i >= 0 || chance(0.85) ? 'N' : pick(['NE', 'S', 'NW']),
      wave,
      vis,
      26 - Math.floor(i / 20),
      i === windy ? 'light' : 'none',
      call,
      rulesId,
      i === 0
        ? 'ים שקט, ראות מעולה. החבל העמוק ב-40 מטר.'
        : i === windy
          ? 'תחזית: רוח צפונית חזקה, גלים כבר מהבוקר'
          : null,
      i <= 0 ? il(date, '06:10') : il(today, '06:10'),
    ]);
  }
  await insertMany(
    client,
    'dive_conditions',
    [
      'organization_id',
      'site_id',
      'observed_on',
      'is_forecast',
      'wind_kts',
      'wind_dir',
      'wave_cm',
      'visibility_m',
      'water_temp_c',
      'current',
      'call',
      'rule_set_id',
      'note',
      'recorded_at',
    ],
    condRows,
  );

  // Sessions: eight weeks back, two ahead.
  const sessions: Session[] = [];
  const sessionRows: unknown[][] = [];
  const instr = (n: number) => staff[instructors[n % instructors.length] as string] as string;
  const addSession = (
    code: string,
    date: string,
    time: string,
    site: string,
    capacity: number,
    lead: string,
    assist: string | null,
    title: string | null = null,
    boat: string | null = null,
  ) => {
    const p = programs[code];
    if (!p) return;
    const startsAt = il(date, time);
    const minutes = PROGRAMS.find((x) => x[0] === code)?.[8] ?? 150;
    const past = date < today;
    const sea = SITES.find((s) => s[1] === site)?.[2] !== 'pool';
    const status = past
      ? sea && noGoDays.has(date)
        ? 'cancelled'
        : 'done'
      : date === today
        ? 'go'
        : 'scheduled';
    const id = randomUUID();
    sessions.push({
      id,
      programCode: code,
      kind: p.kind,
      date,
      startsAt,
      capacity,
      minLevel: p.minLevel,
      lead,
      maxDepth: p.maxDepth,
      status,
      title,
      price: p.price,
      programId: p.id,
    });
    sessionRows.push([
      id,
      orgId,
      p.id,
      siteIds[site],
      startsAt,
      plusMinutes(startsAt, minutes),
      lead,
      assist,
      capacity,
      status,
      title,
      boat,
    ]);
  };
  let cohort = 31;
  for (let i = -56; i <= 14; i++) {
    const date = addDays(today, i);
    const wd = weekday(date);
    const n = i + 100;
    if (opts.hero) {
      if (wd !== 1)
        addSession(
          'line',
          date,
          '07:00',
          'Lighthouse Beach',
          8,
          instr(n),
          wd >= 5 ? need(staff.lior) : null,
        );
      if (wd >= 0 && wd <= 4 && wd !== 1)
        addSession(
          'line',
          date,
          '16:00',
          'Moses Rock',
          6,
          instr(n + 1),
          null,
          'אימון חבלים – אחה״צ',
        );
      if (wd === 2 || wd === 6)
        addSession(
          'deep',
          date,
          '07:30',
          'Lighthouse Beach',
          6,
          need(staff.owner),
          need(staff.lior),
        );
      if (wd === 1 || wd === 3)
        addSession('pool', date, '19:00', 'Club pool', 10, need(staff.neta), null);
      addSession('discover', date, '10:00', 'Japanese Gardens', 4, instr(n + 2), null);
      if (wd >= 4) addSession('discover', date, '13:30', 'Japanese Gardens', 4, instr(n), null);
      if (wd === 5)
        addSession('breath', date, '06:00', 'Lighthouse Beach', 16, need(staff.owner), null);
      if (wd === 6)
        addSession(
          'boat',
          date,
          '08:00',
          'Drop-off (boat)',
          8,
          need(staff.ron),
          need(staff.owner),
          null,
          'כחול 1',
        );
      if (wd === 3 && Math.abs(i) % 14 < 7)
        addSession('eq', date, '17:00', 'Club pool', 10, need(staff.owner), null);
      // Courses: Wave 1 every other Thursday–Friday; Wave 2 and AIDA monthly; the next Wave 3 in nine days.
      if (wd === 4 && Math.abs(i) % 14 < 7) {
        const t = `Molchanovs Wave 1 · מחזור ${cohort++}`;
        addSession('wave1', date, '09:00', 'Japanese Gardens', 4, need(staff.yoav), null, t);
        addSession(
          'wave1',
          addDays(date, 1),
          '08:30',
          'Lighthouse Beach',
          4,
          need(staff.yoav),
          null,
          t,
        );
      }
      if (wd === 0 && (i === -49 || i === -21 || i === 7)) {
        const t = `Molchanovs Wave 2 · מחזור ${cohort++}`;
        for (let k = 0; k < 3; k++)
          addSession(
            'wave2',
            addDays(date, k),
            '08:30',
            'Lighthouse Beach',
            4,
            need(staff.owner),
            null,
            t,
          );
      }
      if (wd === 0 && (i === -35 || i === -7)) {
        const t = `AIDA 2 · מחזור ${cohort++}`;
        for (let k = 0; k < 2; k++)
          addSession(
            'aida2',
            addDays(date, k),
            '09:00',
            'Japanese Gardens',
            4,
            need(staff.neta),
            null,
            t,
          );
      }
    } else if (wd === 5 || wd === 6) {
      addSession('line', date, '08:00', 'Lighthouse Beach', 6, need(staff.owner), null);
      addSession('discover', date, '11:00', 'Japanese Gardens', 4, need(staff.yoav), null);
    }
  }
  if (opts.hero) {
    const w3 = addDays(today, 9);
    const t = 'Molchanovs Wave 3 · מחזור 7';
    for (let k = 0; k < 4; k++)
      addSession(
        'wave3',
        addDays(w3, k),
        '08:00',
        'Lighthouse Beach',
        4,
        need(staff.owner),
        need(staff.lior),
        t,
      );
  }
  await insertMany(
    client,
    'dive_sessions',
    [
      'id',
      'organization_id',
      'program_id',
      'site_id',
      'starts_at',
      'ends_at',
      'lead_staff_id',
      'assist_staff_id',
      'capacity',
      'status',
      'title',
      'boat',
    ],
    sessionRows,
  );

  // Bookings, logs, enrollments, sales.
  const bookingRows: unknown[][] = [];
  const logRows: unknown[][] = [];
  const enrollRows: unknown[][] = [];
  const booked = new Map<string, Set<string>>();
  const course = new Map<string, string[]>(); // title -> divers
  const eligible = (s: Session) =>
    divers.filter((d) => {
      if (s.kind === 'experience') return d.level <= 1 && d !== dana;
      if (s.kind === 'course') {
        const grants = programs[s.programCode]?.grants ?? 2;
        return d.level === grants - 1 || (d.level === grants && chance(0.15));
      }
      return d.level >= s.minLevel;
    });
  const fillFor = (s: Session) => {
    const wd = weekday(s.date);
    const weekend = wd >= 4;
    const future = s.date > today;
    const base =
      s.kind === 'experience'
        ? weekend
          ? 0.95
          : 0.6
        : s.kind === 'course'
          ? 0.85
          : s.kind === 'workshop'
            ? 0.55
            : s.kind === 'trip'
              ? 0.85
              : weekend
                ? 0.9
                : 0.55;
    const ahead = future
      ? Math.max(0.25, 1 - (Date.parse(s.date) - Date.parse(today)) / 86_400_000 / 12)
      : 1;
    return base * ahead;
  };
  for (const s of sessions) {
    if (s.status === 'cancelled' && chance(0.5)) continue;
    const set = new Set<string>();
    booked.set(s.id, set);
    let chosen: Diver[] = [];
    if (s.kind === 'course' && s.title) {
      const existing = course.get(s.title);
      if (existing) chosen = existing.map((id) => divers.find((d) => d.id === id) as Diver);
      else {
        const pool = eligible(s).filter((d) => d !== dana);
        const want =
          s.programCode === 'wave3'
            ? 0
            : s.date > addDays(today, 3) && s.programCode === 'wave1'
              ? 1
              : Math.round(s.capacity * fillFor(s));
        for (const d of pool.sort(() => random() - 0.5).slice(0, want)) chosen.push(d);
        if (s.programCode === 'wave3' && dana) chosen.push(dana);
        course.set(
          s.title,
          chosen.map((d) => d.id),
        );
      }
    } else {
      const want = Math.min(
        s.capacity,
        Math.round(s.capacity * fillFor(s) * (0.75 + random() * 0.4)),
      );
      const weekendDay = weekday(s.date) >= 4;
      const pool = eligible(s)
        .filter((d) => d !== dana)
        .map((d) => ({
          d,
          w: random() + (d.weekday !== weekendDay ? 0.6 : 0) + (d.passId ? 0.4 : 0),
        }))
        .sort((a, b) => b.w - a.w)
        .slice(0, want)
        .map((x) => x.d);
      chosen = pool;
    }
    // Dana trains every other weekend, and tomorrow morning at the Lighthouse.
    if (dana && s.programCode === 'line' && s.startsAt.getUTCHours() < 8) {
      const d = Math.round((Date.parse(s.date) - Date.parse(today)) / 86_400_000);
      if ((d < 0 && weekday(s.date) === 5 && Math.abs(d) % 14 < 7) || d === 1)
        chosen = [dana, ...chosen.filter((x) => x !== dana)].slice(0, s.capacity);
    }
    for (const d of chosen) {
      if (set.has(d.id)) continue;
      set.add(d.id);
      const past = s.date < today;
      const isToday = s.date === today;
      const status =
        s.status === 'cancelled'
          ? 'cancelled'
          : past
            ? chance(0.05)
              ? 'no_show'
              : chance(0.04)
                ? 'cancelled'
                : 'checked_in'
            : isToday
              ? s.startsAt.getTime() < Date.now() && chance(0.7)
                ? 'checked_in'
                : 'booked'
              : 'booked';
      let passId: string | null = null;
      if (s.kind === 'training' && d.passId && d.passLeft > 0 && status !== 'cancelled') {
        passId = d.passId;
        d.passLeft--;
      }
      const price = passId ? 0 : s.kind === 'course' ? 0 : s.price;
      const target =
        s.kind === 'training' && s.programCode !== 'pool' && d.pb
          ? Math.min(s.maxDepth, d.pb + (chance(0.5) ? 1 : 2))
          : null;
      bookingRows.push([
        randomUUID(),
        orgId,
        s.id,
        d.id,
        status,
        d === dana && s.date > today && s.programCode === 'line' ? 26 : target,
        passId,
        price,
        d.origin === 'abroad' ? 'whatsapp' : chance(0.55) ? 'online' : 'office',
        rulesId,
        status === 'checked_in' ? plusMinutes(s.startsAt, -between(5, 25)) : null,
        plusMinutes(s.startsAt, -between(60 * 6, 60 * 24 * 9)),
      ]);
      // Money: pay-as-you-go divers pay per session; courses once per cohort (below).
      if (status !== 'cancelled' && price > 0 && (past || isToday || chance(0.35)))
        sale(
          d.id,
          s.kind,
          s.title ?? need(programs[s.programCode]).he,
          price,
          plusMinutes(s.startsAt, -between(10, 60 * 48)),
          payMethod(),
          s.programId,
          s.id,
        );
      // The water: what each diver did.
      if (status === 'checked_in' && past) logDives(s, d);
    }
  }

  function logDives(s: Session, d: Diver) {
    const daysAgo = Math.round((Date.parse(today) - Date.parse(s.date)) / 86_400_000);
    const push = (
      discipline: string,
      depth: number | null,
      distance: number | null,
      secs: number | null,
      outcome = 'clean',
      notes: string | null = null,
    ) =>
      logRows.push([
        orgId,
        d.id,
        s.id,
        s.date,
        discipline,
        depth,
        distance,
        secs,
        outcome,
        notes,
        staff[instructors[0] as string],
        plusMinutes(s.startsAt, between(30, 140)),
      ]);
    if (s.programCode === 'pool') {
      if (d.sta)
        push('STA', null, null, Math.max(60, d.sta - between(5, 40) - Math.floor(daysAgo / 3)));
      if (d.dyn) {
        push('DYN', null, Math.max(25, d.dyn - between(10, 25)), null);
        push(
          chance(0.5) ? 'DYN' : 'DNF',
          null,
          Math.max(25, d.dyn - between(0, 12) - Math.floor(daysAgo / 6)),
          null,
        );
      }
      return;
    }
    if (s.kind === 'workshop') return;
    const cap =
      s.kind === 'experience'
        ? between(4, 8)
        : Math.min(s.maxDepth, Math.max(6, (d.pb ?? 10) - Math.floor(daysAgo / 9)));
    const dives = s.kind === 'experience' ? 3 : 4;
    for (let k = 0; k < dives; k++) {
      const depth = Math.max(3, Math.round(cap * need([0.5, 0.7, 0.85, 1][k])));
      const discipline =
        k === 0 ? 'FIM' : s.kind === 'experience' ? 'FIM' : chance(0.15) ? 'CWTB' : 'CWT';
      push(
        discipline,
        depth,
        null,
        Math.round(depth * 2.2 + between(5, 20)),
        k === 3 && chance(0.04) ? 'early_turn' : 'clean',
      );
    }
  }

  // Courses become enrollments (completed in the past, active now) and one sale each.
  for (const [title, ids] of course) {
    const ss = sessions
      .filter((s) => s.title === title)
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    const first = ss[0] as Session;
    const last = ss[ss.length - 1] as Session;
    const done = last.date < today;
    const skills = (lvl: number) =>
      ({
        2: [
          'breathe_up',
          'recovery_breath',
          'duck_dive',
          'frenzel',
          'free_immersion',
          'buddy_rescue',
          'sta_2min',
          'cwt_12m',
        ],
        3: [
          'mouthfill_intro',
          'freefall',
          'lanyard_rescue',
          'sta_3min',
          'dyn_50m',
          'cwt_24m',
          'blackout_rescue_depth',
        ],
        4: ['mouthfill', 'co2_tables', 'sta_4min', 'dyn_75m', 'cwt_32m', 'deep_safety'],
      })[lvl] ?? [];
    const prog = need(programs[first.programCode]);
    for (const id of ids) {
      const all = skills(prog.grants ?? 2);
      const started = first.date <= today;
      enrollRows.push([
        orgId,
        id,
        prog.id,
        first.lead,
        done ? 'completed' : 'active',
        first.date,
        done ? last.date : null,
        done ? all : started ? all.slice(0, Math.ceil(all.length / 2)) : [],
        done ? between(78, 100) : null,
        done ? `${first.programCode.toUpperCase()}-${between(10000, 99999)}` : null,
      ]);
      sale(
        id,
        'course',
        title,
        prog.price,
        il(addDays(first.date, -between(3, 20)), '12:00'),
        chance(0.8) ? 'card' : 'transfer',
        prog.id,
        null,
      );
    }
  }
  // Dana's history: discover, Wave 1, Wave 2.
  if (dana) {
    enrollRows.push(
      [
        orgId,
        dana.id,
        need(programs.wave1).id,
        staff.yoav,
        'completed',
        addDays(today, -180),
        addDays(today, -179),
        [
          'breathe_up',
          'recovery_breath',
          'duck_dive',
          'frenzel',
          'free_immersion',
          'buddy_rescue',
          'sta_2min',
          'cwt_12m',
        ],
        92,
        'WAVE1-48213',
      ],
      [
        orgId,
        dana.id,
        need(programs.wave2).id,
        staff.owner,
        'completed',
        addDays(today, -62),
        addDays(today, -60),
        [
          'mouthfill_intro',
          'freefall',
          'lanyard_rescue',
          'sta_3min',
          'dyn_50m',
          'cwt_24m',
          'blackout_rescue_depth',
        ],
        88,
        'WAVE2-51877',
      ],
    );
    sale(
      dana.id,
      'experience',
      'חוויית צלילה חופשית',
      39000,
      il(addDays(today, -205), '10:00'),
      'card',
      need(programs.discover).id,
    );
    sale(
      dana.id,
      'course',
      'Molchanovs Wave 1',
      165000,
      il(addDays(today, -190), '12:00'),
      'card',
      need(programs.wave1).id,
    );
    sale(
      dana.id,
      'course',
      'Molchanovs Wave 2',
      245000,
      il(addDays(today, -75), '12:00'),
      'card',
      need(programs.wave2).id,
    );
    // Her depth story, a dive day every couple of weeks.
    const story: [number, number][] = [
      [-205, 7],
      [-180, 12],
      [-179, 14],
      [-165, 15],
      [-150, 17],
      [-136, 17],
      [-121, 18],
      [-107, 19],
      [-93, 20],
      [-79, 21],
      [-62, 22],
      [-61, 23],
      [-60, 24],
      [-44, 22],
      [-30, 23],
      [-16, 24],
    ];
    for (const [ago, depth] of story) {
      const date = addDays(today, ago);
      for (const [k, f] of [
        [0, 0.6],
        [1, 0.8],
        [2, 1],
      ] as const)
        logRows.push([
          orgId,
          dana.id,
          null,
          date,
          k === 0 ? 'FIM' : 'CWT',
          Math.round(depth * f),
          null,
          Math.round(depth * f * 2.3 + 8),
          'clean',
          null,
          staff.yoav,
          il(date, `${8 + k}:15`),
        ]);
    }
  }

  await insertMany(
    client,
    'dive_bookings',
    [
      'id',
      'organization_id',
      'session_id',
      'diver_id',
      'status',
      'target_depth_m',
      'pass_id',
      'price_agorot',
      'booked_via',
      'rule_set_id',
      'checked_in_at',
      'created_at',
    ],
    bookingRows,
  );
  await insertMany(
    client,
    'dive_logs',
    [
      'organization_id',
      'diver_id',
      'session_id',
      'dived_on',
      'discipline',
      'depth_m',
      'distance_m',
      'duration_sec',
      'outcome',
      'notes',
      'recorded_by',
      'recorded_at',
    ],
    logRows,
  );
  await insertMany(
    client,
    'dive_enrollments',
    [
      'organization_id',
      'diver_id',
      'program_id',
      'instructor_staff_id',
      'status',
      'started_on',
      'completed_on',
      'skills',
      'theory_score',
      'cert_number',
    ],
    enrollRows,
  );

  // Older months, before the sessions in this seed: the same club, in sales only (so the revenue chart has a story).
  for (let ago = 57; ago <= 175; ago++) {
    const date = addDays(today, -ago);
    const weekend = weekday(date) >= 4;
    const season = 0.75 + 0.25 * Math.cos((ago / 175) * Math.PI);
    const n = Math.round((weekend ? 20 : 9) * season * opts.scale * (0.7 + random() * 0.6));
    for (let k = 0; k < n; k++) {
      const d = pick(divers);
      const r = random();
      const [code, kind] =
        r < 0.35
          ? ['line', 'training']
          : r < 0.6
            ? ['discover', 'experience']
            : r < 0.68
              ? ['eq', 'workshop']
              : r < 0.75
                ? ['boat', 'trip']
                : r < 0.82
                  ? ['wave1', 'course']
                  : r < 0.85
                    ? ['wave2', 'course']
                    : ['line', 'training'];
      const p = need(programs[code]);
      if (kind === 'course' && k > 1) continue;
      sale(
        d.id,
        kind,
        p.he,
        p.price,
        il(date, `${between(7, 18)}:${pick(['00', '15', '30', '45'])}`),
        payMethod(),
        p.id,
      );
    }
    if (chance(0.35)) {
      const d = pick(divers);
      sale(
        d.id,
        'rental',
        pick(['F-04', 'M-02', 'W3-07', 'C-02']),
        pick([4000, 2000, 5000, 6000]),
        il(date, '09:00'),
        payMethod(),
      );
    }
  }

  // Gear
  const gearRows: unknown[][] = [];
  const gearIds: { id: string; kind: string; price: number }[] = [];
  const addGear = (
    code: string,
    kind: string,
    size: string | null,
    brand: string | null,
    price: number,
    every: number | null,
    status = 'available',
  ) => {
    const id = randomUUID();
    gearIds.push({ id, kind, price });
    const bought = addDays(today, -between(60, 900));
    gearRows.push([
      id,
      orgId,
      code,
      kind,
      size,
      brand,
      status,
      bought,
      every
        ? addDays(
            today,
            -(chance(0.12) ? every + between(5, 40) : between(5, Math.max(6, every - 5))),
          )
        : null,
      every,
      price,
    ]);
  };
  const g = Math.max(1, Math.round(opts.scale * 10));
  for (let i = 1; i <= g + 4; i++)
    addGear(
      `F-${String(i).padStart(2, '0')}`,
      'fins',
      String(38 + (i % 9)),
      'Carbon blade',
      4000,
      180,
    );
  for (let i = 1; i <= g + 2; i++)
    addGear(
      `M-${String(i).padStart(2, '0')}`,
      'mask',
      null,
      'Low volume',
      2000,
      null,
      i === 3 ? 'maintenance' : 'available',
    );
  for (let i = 1; i <= g + 4; i++)
    addGear(
      `W3-${String(i).padStart(2, '0')}`,
      'wetsuit',
      pick(['XS', 'S', 'M', 'M', 'L', 'XL']),
      '3 מ״מ open-cell',
      5000,
      120,
      i === 6 ? 'maintenance' : 'available',
    );
  for (let i = 1; i <= Math.round(g / 2) + 1; i++)
    addGear(
      `W5-${String(i).padStart(2, '0')}`,
      'wetsuit',
      pick(['S', 'M', 'L']),
      '5 מ״מ open-cell',
      6000,
      120,
    );
  for (let i = 1; i <= g; i++)
    addGear(`B-${String(i).padStart(2, '0')}`, 'weight_belt', null, 'Rubber', 1500, null);
  for (let i = 1; i <= Math.round(g / 2) + 1; i++)
    addGear(`N-${String(i).padStart(2, '0')}`, 'neck_weight', null, null, 1500, null);
  for (let i = 1; i <= Math.round(g * 0.8); i++)
    addGear(
      `L-${String(i).padStart(2, '0')}`,
      'lanyard',
      null,
      'Quick release',
      1500,
      90,
      i === 2 ? 'maintenance' : 'available',
    );
  for (let i = 1; i <= Math.round(g * 0.6); i++)
    addGear(`C-${String(i).padStart(2, '0')}`, 'computer', null, 'Freedive computer', 6000, 365);
  for (let i = 1; i <= 3; i++)
    addGear(`Y-${String(i).padStart(2, '0')}`, 'buoy', null, 'Club buoy + 50m line', 0, 60);
  addGear('MF-01', 'monofin', '42', 'Fibreglass mono', 9000, 180);
  await insertMany(
    client,
    'dive_gear',
    [
      'id',
      'organization_id',
      'code',
      'kind',
      'size',
      'brand',
      'status',
      'purchased_on',
      'last_service_on',
      'service_every_days',
      'rental_price_agorot',
    ],
    gearRows,
  );
  // Rentals: history, today's out at the beach (one overdue from yesterday).
  const rentable = gearIds.filter((x) => x.price > 0 && x.kind !== 'buoy');
  let r = 0;
  for (const s of sessions.filter((x) => x.date < today && x.status === 'done').slice(-60)) {
    const set = [...(booked.get(s.id) ?? [])];
    if (set.length === 0 || !chance(0.5)) continue;
    const gear = need(rentable[r++ % rentable.length]);
    const diverId = pick(set);
    await client.query(
      `insert into dive_rentals (organization_id, gear_id, diver_id, out_at, due_at, returned_at, price_agorot)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        orgId,
        gear.id,
        diverId,
        plusMinutes(s.startsAt, -20),
        plusMinutes(s.startsAt, 240),
        plusMinutes(s.startsAt, 200),
        gear.price,
      ],
    );
    sale(diverId, 'rental', gear.kind, gear.price, plusMinutes(s.startsAt, -20), payMethod());
  }
  if (opts.hero) {
    const todays = sessions.filter((x) => x.date === today);
    const out = rentable
      .filter((x) => ['fins', 'wetsuit', 'mask', 'computer'].includes(x.kind))
      .slice(-7);
    for (const [i, gear] of out.entries()) {
      const s = todays[i % Math.max(1, todays.length)];
      const ids = [...(booked.get(s?.id ?? '') ?? [])];
      const diverId = ids[i % Math.max(1, ids.length)] ?? need(divers[i]).id;
      const overdue = i === 0;
      const outAt = overdue
        ? il(addDays(today, -1), '07:10')
        : plusMinutes(s?.startsAt ?? il(today, '07:00'), -15);
      await client.query(
        `insert into dive_rentals (organization_id, gear_id, diver_id, out_at, due_at, price_agorot) values ($1, $2, $3, $4, $5, $6)`,
        [
          orgId,
          gear.id,
          diverId,
          outAt,
          overdue ? plusMinutes(outAt, 300) : il(today, '19:00'),
          gear.price,
        ],
      );
      sale(diverId, 'rental', gear.kind, gear.price, outAt, payMethod());
    }
  }
  // The shop counter.
  for (let k = 0; k < Math.round(28 * opts.scale); k++) {
    const [desc, price] = pick([
      ['מסכת נפח נמוך', 18000],
      ['אטב אף', 6000],
      ['ליינארד', 22000],
      ['גרבי ניאופרן', 9000],
      ['חולצת המועדון', 12000],
      ['חגורת משקולות', 15000],
    ] as const);
    sale(
      pick(divers).id,
      'retail',
      desc,
      price,
      il(addDays(today, -between(0, 170)), `${between(8, 17)}:20`),
      payMethod(),
    );
  }

  // Leads
  if (opts.hero) {
    const leads: [string, string, string, string | null, string, number, string | null][] = [
      [
        'אלה מור',
        'instagram',
        'israel',
        'discover',
        'new',
        3,
        'ראתה רילס של הזריחה בחוף. רוצה לנסות עם בן הזוג בסוף השבוע.',
      ],
      [
        'Jonas Becker',
        'whatsapp',
        'abroad',
        'wave1',
        'new',
        30,
        'Arriving Sunday for a week, asks about Wave 1 in English.',
      ],
      [
        'רועי נחמיאס',
        'google',
        'israel',
        'wave1',
        'new',
        52,
        'שאל על קורס Wave 1 בחנוכה ועל לינה.',
      ],
      [
        'צוות פיתוח, הייטק',
        'referral',
        'israel',
        'discover',
        'new',
        6,
        'גיבוש ל-12 איש, ביום חמישי בעוד שבועיים. מבקשים הצעת מחיר.',
      ],
      [
        'ענבר שטרן',
        'hotel',
        'israel',
        'discover',
        'new',
        2,
        'הקונסיירז׳ של המלון שלח. שתי חברות, מחר בבוקר.',
      ],
      [
        'גיל אורן',
        'instagram',
        'eilat',
        'wave2',
        'contacted',
        70,
        'סיים Wave 1 אצל מועדון אחר. בודק מחיר ל-Wave 2.',
      ],
      [
        'Sofia Ricci',
        'google',
        'abroad',
        'aida2',
        'contacted',
        44,
        'AIDA 2 in December, wants a private course.',
      ],
      [
        'ליטל בר',
        'walk_in',
        'eilat',
        'line',
        'contacted',
        26,
        'עברה ליד החנות. מתעניינת בכרטיסייה לאימוני ים.',
      ],
      [
        'יוסי קדם',
        'referral',
        'israel',
        'eq',
        'contacted',
        90,
        'נתקע ב-18 מטר בגלל השוואת לחצים. מתאים לסדנה.',
      ],
      ['נועם גבאי', 'instagram', 'israel', 'wave1', 'booked', 120, 'נרשם למחזור הבא של Wave 1.'],
      ['מור פלג', 'whatsapp', 'eilat', 'line', 'booked', 200, 'קנתה כרטיסייה של 10.'],
      ['Pierre Lambert', 'hotel', 'abroad', 'discover', 'booked', 20, 'Discover on Friday 10:00.'],
      ['אסנת חזן', 'google', 'israel', 'discover', 'lost', 300, 'מחיר גבוה מדי בשבילה כרגע.'],
      ['דור לוינסון', 'instagram', 'israel', 'wave1', 'lost', 400, 'בחר קורס בחו״ל.'],
    ];
    await insertMany(
      client,
      'dive_leads',
      [
        'organization_id',
        'name',
        'phone_e164',
        'source',
        'origin',
        'interest_program_id',
        'stage',
        'note',
        'next_action_on',
        'created_at',
        'updated_at',
      ],
      leads.map(([name, source, origin, prog, stage, hours, note]) => [
        orgId,
        name,
        fakePhone(),
        source,
        origin,
        prog ? (programs[prog]?.id ?? null) : null,
        stage,
        note,
        stage === 'contacted' ? addDays(today, between(0, 3)) : null,
        new Date(Date.now() - hours * 3_600_000),
        new Date(Date.now() - Math.min(hours, 24) * 3_600_000),
      ]),
    );
  }

  // Incidents: the safety log of the last quarter (last one 23 days ago).
  if (opts.hero) {
    const lmcDay = addDays(today, -23);
    const lmcSession = sessions.find(
      (s) => s.date === lmcDay && s.programCode === 'line' && s.status === 'done',
    );
    const someone = divers.find((d) => d.level === 3 && d !== dana) ?? need(divers[1]);
    const inc: [
      string,
      string,
      string,
      number | null,
      string,
      string,
      string | null,
      string | null,
    ][] = [
      [
        lmcDay,
        'lmc',
        'medium',
        26,
        'סמבה קלה (LMC) ביציאה מ-26 מטר בקו A. הבאדי תמך מעל המים, שלוש נשימות התאוששות, חזר להכרה מלאה תוך שניות.',
        'יצא מהמים להיום. שיחה על חימום וקצב התקדמות; חזר ל-20 מטר אחרי שבוע ואז בהדרגה.',
        lmcSession?.id ?? null,
        someone.id,
      ],
      [
        addDays(today, -41),
        'barotrauma',
        'low',
        14,
        'כאב באוזן שמאל בירידה, המשיך למרות האות. נבדק ע״י רופא א.א.ג: ברוטראומה קלה.',
        'הפסקה של שבוע מעומק, סדנת השוואת לחצים. חזר לאימונים.',
        null,
        need(divers[5]).id,
      ],
      [
        addDays(today, -58),
        'marine_life',
        'low',
        null,
        'צריבת מדוזה בזרוע בכניסה מהחוף בגן היפני.',
        'חומץ, קרח, מעקב. הוספנו בדיקת מדוזות לתדריך הבוקר.',
        null,
        need(divers[9]).id,
      ],
      [
        addDays(today, -77),
        'equipment',
        'low',
        null,
        'אבזם שחרור מהיר בליינארד L-02 לא נפתח בבדיקה לפני צלילה.',
        'הליינארד הוצא לשירות, נוסף לבדיקת ציוד יומית.',
        null,
        null,
      ],
    ];
    await insertMany(
      client,
      'dive_incidents',
      [
        'organization_id',
        'occurred_at',
        'kind',
        'severity',
        'depth_m',
        'description',
        'action_taken',
        'session_id',
        'diver_id',
        'status',
        'closed_at',
        'reported_by',
      ],
      inc.map(([date, kind, sev, depth, desc, act, sid, did]) => [
        orgId,
        il(date, '08:20'),
        kind,
        sev,
        depth,
        desc,
        act,
        sid,
        did,
        'closed',
        il(addDays(date, 2), '12:00'),
        null,
      ]),
    );
  }

  await insertMany(
    client,
    'dive_sales',
    [
      'organization_id',
      'diver_id',
      'kind',
      'description',
      'amount_agorot',
      'method',
      'sold_at',
      'program_id',
      'session_id',
      'receipt_no',
      'sold_by',
    ],
    sales,
  );
  return {
    divers: divers.length,
    sessions: sessions.length,
    bookings: bookingRows.length,
    logs: logRows.length,
    sales: sales.length,
    staff,
    dana: dana?.id,
  };
}

function certName(level: number, random: () => number): string | null {
  const molch = random() < 0.6;
  return (
    [
      null,
      'Discover Freediving',
      molch ? 'Molchanovs Wave 1' : 'AIDA 2',
      molch ? 'Molchanovs Wave 2' : 'AIDA 3',
      molch ? 'Molchanovs Wave 3' : 'AIDA 4',
      molch ? 'Molchanovs Instructor' : 'AIDA Instructor',
    ][level] ?? null
  );
}

function passName(kind: string): string {
  return (
    {
      punch5: 'כרטיסייה 5 אימוני ים',
      punch10: 'כרטיסייה 10 אימוני ים',
      monthly: 'מנוי חודשי ללא הגבלה',
      annual: 'מנוי שנתי למועדון',
    }[kind] ?? kind
  );
}

/**
 * Seeds both freediving clubs (replacing earlier copies), their people and memberships, and their subscriptions.
 * Runs as the database owner inside the caller's transaction.
 */
export async function seedDiveData(client: pg.PoolClient): Promise<DiveDataSummary> {
  await client.query(`delete from organizations where id = any($1)`, [
    [DIVE_ORG.id, DIVE_ORG_2.id],
  ]);
  for (const [org, vertical] of [
    [DIVE_ORG, 'freediving'],
    [DIVE_ORG_2, 'freediving'],
  ] as const) {
    await client.query(
      `insert into organizations (id, slug, name, legal_name, tax_status, vertical) values ($1, $2, $3, $4, 'licensed', $5)`,
      [org.id, org.slug, org.name, `${org.name.replace(' (דמו)', '')} בע״מ (דמו)`, vertical],
    );
    await client.query(`insert into org_settings (organization_id, branding) values ($1, $2)`, [
      org.id,
      JSON.stringify({ displayName: org.name, hue: 'turquoise' }),
    ]);
  }
  // The customer persona's own guardian row (they sign in as themself).
  const household = randomUUID();
  const guardian = randomUUID();
  await client.query(
    `insert into households (id, organization_id, display_name) values ($1, $2, 'דנה אביב')`,
    [household, DIVE_ORG.id],
  );
  await client.query(
    `insert into guardians (id, organization_id, household_id, first_name, last_name, relation, phone_e164, whatsapp_opt_in, is_billing_contact)
     values ($1, $2, $3, 'דנה', 'אביב', 'self', $4, true, true)`,
    [guardian, DIVE_ORG.id, household, DIVE_PERSONAS.diveCustomer.phone],
  );
  const hero = await seedClub(client, DIVE_ORG, {
    scale: 1,
    seed: 7781,
    hero: true,
    customerGuardianId: guardian,
  });
  const small = await seedClub(client, DIVE_ORG_2, { scale: 0.35, seed: 4242, hero: false });

  const m = (
    userId: string,
    role: string,
    extra: { staff?: string; guardian?: string; permissions?: readonly string[] } = {},
  ) =>
    client.query(
      `insert into memberships (organization_id, user_id, role, staff_member_id, guardian_id, permissions) values ($1, $2, $3, $4, $5, $6)`,
      [
        DIVE_ORG.id,
        userId,
        role,
        extra.staff ?? null,
        extra.guardian ?? null,
        extra.permissions ?? [],
      ],
    );
  await m(DIVE_PERSONAS.diveOwner.userId, 'owner', { staff: hero.staff.owner });
  await m(DIVE_PERSONAS.diveManager.userId, 'admin', {
    staff: hero.staff.manager,
    permissions: DIVE_MANAGER_PERMISSIONS,
  });
  await m(DIVE_PERSONAS.diveOffice.userId, 'admin', { staff: hero.staff.office });
  await m(DIVE_PERSONAS.diveInstructor.userId, 'instructor', { staff: hero.staff.yoav });
  await m(DIVE_PERSONAS.diveCustomer.userId, 'parent', { guardian });

  await client.query(
    `insert into org_subscriptions (organization_id, plan_code, status, mandate_id, trial_ends_on)
     values ($1, 'pro', 'active', 'fake-mandate-dive', null), ($2, 'growth', 'trialing', null, current_date + 9)
     on conflict (organization_id) do nothing`,
    [DIVE_ORG.id, DIVE_ORG_2.id],
  );
  return {
    divers: hero.divers + small.divers,
    sessions: hero.sessions + small.sessions,
    bookings: hero.bookings + small.bookings,
    logs: hero.logs + small.logs,
    sales: hero.sales + small.sales,
  };
}
