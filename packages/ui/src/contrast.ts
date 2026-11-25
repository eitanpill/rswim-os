/**
 * WCAG contrast for the design tokens. Reads the colour forms the tokens use (oklch, light-dark(), hex, white)
 * and composes tints the way the browser does (sRGB alpha blending), so tests can check every pairing in both
 * colour schemes without a browser.
 */

export type Scheme = 'light' | 'dark';
/** sRGB channels 0..1 */
export type Rgb = readonly [number, number, number];

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/** OKLCH (L 0..1, C, H degrees) → gamma-encoded sRGB, clipped to the gamut. */
export function oklchToRgb(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const enc = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const [r = 0, g = 0, bl = 0] = lin;
  return [clamp(enc(r)), clamp(enc(g)), clamp(enc(bl))];
}

/** Splits "a, b" at the top level (commas inside brackets stay). */
function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(s.slice(start, i).trim());
      start = i + 1;
    }
  }
  out.push(s.slice(start).trim());
  return out;
}

/**
 * Parses a token value in the given scheme. `vars` resolves var(--x) references.
 * Supported: oklch(L% C H [/ a]), light-dark(a, b), #rrggbb, white, black, var(--x).
 */
export function parseColor(
  value: string,
  scheme: Scheme,
  vars: Readonly<Record<string, string>> = {},
): Rgb {
  const v = value.trim();
  const ld = /^light-dark\((.*)\)$/s.exec(v);
  if (ld) {
    const [light = '', dark = ''] = splitTop(ld[1] ?? '');
    return parseColor(scheme === 'light' ? light : dark, scheme, vars);
  }
  const ref = /^var\((--[\w-]+)\)$/.exec(v);
  if (ref) {
    const target = vars[ref[1] ?? ''];
    if (target === undefined) throw new Error(`unknown token ${ref[1]}`);
    return parseColor(target, scheme, vars);
  }
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(v);
  if (ok) {
    const l = Number(ok[1]) / (ok[2] ? 100 : 1);
    return oklchToRgb(l, Number(ok[3]), Number(ok[4]));
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1] ?? '0', 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  if (v === 'white') return [1, 1, 1];
  if (v === 'black') return [0, 0, 0];
  throw new Error(`unsupported colour: ${v}`);
}

/** `top` at `alpha` over `bottom` (what bg-x/10 on a card looks like). */
export function over(top: Rgb, alpha: number, bottom: Rgb): Rgb {
  const mix = (i: 0 | 1 | 2) => top[i] * alpha + bottom[i] * (1 - alpha);
  return [mix(0), mix(1), mix(2)];
}

function luminance(c: Rgb): number {
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

/** WCAG 2 contrast ratio, 1..21. */
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Custom properties declared in a CSS block, e.g. tokensOf(css, ':root') or tokensOf(css, '@theme').
 * Only the first block with exactly that selector is read.
 */
export function tokensOf(css: string, selector: string): Record<string, string> {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no block ${selector}`);
  let depth = 0;
  let i = css.indexOf('{', at);
  const start = i + 1;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  const body = css.slice(start, i).replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const [, name = '', value = ''] = m;
    out[name] = value.trim();
  }
  return out;
}
