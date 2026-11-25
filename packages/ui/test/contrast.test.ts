/**
 * Every text/background pairing the kit uses must stay readable in light AND dark mode (WCAG AA: 4.5:1 for text,
 * 3:1 for large text). Pit found selected chips and tabs that went white-on-white in dark mode (2026-11-20); this
 * suite reads the real tokens from the stylesheets, so a token change that breaks a pairing fails CI.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrast, over, parseColor, tokensOf, type Rgb, type Scheme } from '../src/contrast';

const ROOT = join(__dirname, '..', '..', '..');
const kit = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const web = readFileSync(join(ROOT, 'apps', 'web', 'src', 'app', 'globals.css'), 'utf8');

const theme = tokensOf(kit, '@theme');
const light = tokensOf(kit, ':root');
const dark = tokensOf(kit, '.dark');
const dive = tokensOf(web, '.dive');
const diveDark = tokensOf(web, '.dark .dive');

function palette(scheme: Scheme, inDive = false) {
  const vars: Record<string, string> = {
    ...theme,
    ...(scheme === 'light' ? light : { ...light, ...dark }),
    ...(inDive ? { ...dive, ...(scheme === 'dark' ? diveDark : {}) } : {}),
  };
  // Tailwind's --color-surface etc. point at the scheme's --surface.
  return (name: string): Rgb => parseColor(`var(--${name})`, scheme, vars);
}

const AA = 4.5;
const SCHEMES: Scheme[] = ['light', 'dark'];

describe.each(SCHEMES)('kit tokens, %s mode', (scheme) => {
  const c = palette(scheme);
  const page = c('surface');
  const card = c('surface-raised');
  const white: Rgb = [1, 1, 1];

  // Backgrounds text can sit on: page, card, the brand tints (selected chip/tab, soft button, badge, hover).
  const neutralGrounds: [string, Rgb][] = [
    ['page', page],
    ['card', card],
    ['brand-50', c('color-brand-50')],
    ['brand-100', c('color-brand-100')],
    ['brand-50/60 on card', over(c('color-brand-50'), 0.6, card)],
  ];

  it.each(neutralGrounds)('ink, muted ink and brand-ink stay readable on %s', (_, ground) => {
    expect(contrast(c('color-ink'), ground)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c('color-ink-muted'), ground)).toBeGreaterThanOrEqual(AA);
    expect(contrast(c('color-brand-ink'), ground)).toBeGreaterThanOrEqual(AA);
  });

  it.each(['color-brand-600', 'color-brand-700', 'color-ok-strong', 'color-danger'])(
    'white text stays readable on a %s fill',
    (fill) => {
      expect(contrast(white, c(fill))).toBeGreaterThanOrEqual(AA);
    },
  );

  it('text on a bright fill (warn, white) stays dark in both modes', () => {
    expect(contrast(c('color-on-bright'), c('color-warn'))).toBeGreaterThanOrEqual(AA);
    expect(contrast(c('color-on-bright'), white)).toBeGreaterThanOrEqual(AA);
  });

  it.each(['ok', 'danger', 'warn'])('%s-ink reads on the page, cards and its own tints', (tone) => {
    const ink = c(`color-${tone}-ink`);
    const fill = c(`color-${tone}`);
    for (const ground of [page, card, over(fill, 0.2, card), over(fill, 0.2, page)]) {
      expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe.each(SCHEMES)('freediving tokens, %s mode', (scheme) => {
  const c = palette(scheme, true);
  const page = c('surface');
  const card = c('surface-raised');
  const white: Rgb = [1, 1, 1];

  it.each(['sea', 'coral', 'go', 'nogo', 'caution'])(
    'dive-%s-ink reads on the page, cards and its own tint',
    (tone) => {
      const ink = c(`dive-${tone}-ink`);
      for (const ground of [page, card, over(c(`dive-${tone}`), 0.16, card)]) {
        expect(contrast(ink, ground)).toBeGreaterThanOrEqual(AA);
      }
    },
  );

  it.each(['sea', 'coral', 'go'])('white text reads on a dive-%s-strong fill', (tone) => {
    expect(contrast(white, c(`dive-${tone}-strong`))).toBeGreaterThanOrEqual(AA);
  });
});

/**
 * Source rules: the classes that caused unreadable text must not come back. Text in the brand or status colour
 * uses the -ink tokens; only scales the theme defines are used.
 */
describe('class usage in the apps', () => {
  const roots = [join(ROOT, 'apps', 'web', 'src'), join(ROOT, 'packages', 'ui', 'src')];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(name)) files.push(p);
    }
  };
  roots.forEach(walk);

  const RULES: [RegExp, string, (line: string) => boolean][] = [
    [
      /\btext-brand-(500|600|700)\b/,
      'brand text uses text-brand-ink (brand-600/700 are dark in dark mode)',
      (l) => !/bg-white/.test(l),
    ],
    [
      /\btext-(ok|danger|warn)(?![-\w/])/,
      'status text uses text-ok-ink / -danger-ink / -warn-ink',
      () => true,
    ],
    [
      /text-\[var\(--dive-(sea|coral|go|nogo|caution)\)\]/,
      'freediving text uses var(--dive-*-ink)',
      () => true,
    ],
    [/\bbrand-(200|300|400|800|900|950)\b/, 'only brand-50/100/500/600/700/ink exist', () => true],
    [
      /\b(bg-warn|aqua-shine)(?![-\w/])[^'"`]*\btext-ink\b|\btext-ink\b[^'"`]*\b(bg-warn|aqua-shine)(?![-\w/])/,
      'text on a bright fill uses text-on-bright (ink turns light in dark mode)',
      () => true,
    ],
    [
      /\bbg-ok(?![-\w/])[^'"`]*text-white|text-white[^'"`]*\bbg-ok(?![-\w/])/,
      'white text sits on bg-ok-strong',
      () => true,
    ],
  ];

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(RULES.map(([re, why, applies]) => [why, re, applies] as const))(
    '%s',
    (_, re, applies) => {
      const hits: string[] = [];
      for (const f of files) {
        readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (re.test(line) && applies(line)) hits.push(`${relative(ROOT, f)}:${i + 1}`);
          });
      }
      expect(hits).toEqual([]);
    },
  );
});
