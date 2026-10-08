/**
 * Profiles for the public live demo (deploy/demo): the same fake seed dressed for a kind of school. Chosen with
 * RSWIM_DEMO_PROFILE; RSWIM_DEMO_SCHOOL_NAME and RSWIM_DEMO_OWNER_NAME override the name and the owner. The data
 * changes for each profile live in @rswim/seed (live-demo.ts); this is only what the web app needs to show.
 */
export const DEMO_PROFILES = {
  swim: {
    schoolName: 'שחייה בכיף (דמו)',
    ownerFirstName: 'יעל',
    tagline: 'מערכת ההפעלה של בית הספר לשחייה',
    uiWords: {},
  },
  freediving: {
    schoolName: 'כחול עמוק (דמו)',
    ownerFirstName: 'אורי',
    tagline: 'מערכת ההפעלה של בית הספר לצלילה חופשית',
    // Swimming words in the app's own wording, replaced in order (longest first).
    uiWords: {
      he: [
        ['שחיית תינוקות', 'סדנת נשימה'],
        ['קייטנות', 'מחנות צלילה'],
        ['קייטנה', 'מחנה צלילה'],
        ['השחייה', 'הצלילה'],
        ['לשחייה', 'לצלילה'],
        ['שחייה', 'צלילה'],
      ],
      en: [
        ['baby swimming', 'breathing workshop'],
        ['Baby swimming', 'Breathing workshop'],
        ['swimming', 'freediving'],
        ['Swimming', 'Freediving'],
        ['swim', 'freedive'],
        ['Swim', 'Freedive'],
      ],
    },
  },
} as const;

export type DemoProfileKey = keyof typeof DEMO_PROFILES;

export interface DemoProfile {
  key: DemoProfileKey;
  schoolName: string;
  ownerFirstName: string;
  tagline: string;
  /** Replacements for the app's own wording, per locale. */
  uiWords: Partial<Record<'he' | 'en', readonly (readonly [string, string])[]>>;
}

/** The profile this deployment runs, with its environment overrides applied. An unknown name falls back to swim. */
export function demoProfile(env: Record<string, string | undefined> = process.env): DemoProfile {
  const key: DemoProfileKey =
    env.RSWIM_DEMO_PROFILE && env.RSWIM_DEMO_PROFILE in DEMO_PROFILES
      ? (env.RSWIM_DEMO_PROFILE as DemoProfileKey)
      : 'swim';
  const p = DEMO_PROFILES[key];
  return {
    key,
    schoolName: env.RSWIM_DEMO_SCHOOL_NAME || p.schoolName,
    ownerFirstName: env.RSWIM_DEMO_OWNER_NAME || p.ownerFirstName,
    tagline: p.tagline,
    uiWords: p.uiWords,
  };
}

/** The app's messages with a profile's words replaced in every string (keys untouched). */
export function dressMessages<T>(
  messages: T,
  words: readonly (readonly [string, string])[] = [],
): T {
  if (words.length === 0) return messages;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return words.reduce((s, [from, to]) => s.replaceAll(from, to), v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(messages) as T;
}
