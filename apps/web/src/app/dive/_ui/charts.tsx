/**
 * The club's charts, drawn as plain SVG on the server. Rules from the data-viz playbook: categorical series in fixed
 * order (blue, orange, aqua, yellow), one axis, thin marks with a 2px surface gap, a legend whenever there are two or
 * more series, text in ink colours (never the series colour), and a native tooltip on every mark.
 * Time runs left to right in both languages, like a tide table.
 */
import { shekels } from './format';

const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)'];

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="size-2.5 rounded-sm"
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * mag;
}

/** Rounded top corners only: data ends are round, the baseline stays square. */
function barPath(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** Revenue by month, stacked by stream (courses, training, experiences, gear). */
export function StackedBars({
  months,
  streams,
  values,
  locale,
  monthLabel,
}: {
  months: string[];
  streams: { key: string; label: string }[];
  /** values[month][stream] in agorot */
  values: Record<string, Record<string, number>>;
  locale: string;
  monthLabel: (m: string) => string;
}) {
  const W = 640;
  const H = 240;
  const padL = 56;
  const padB = 26;
  const padT = 10;
  const totals = months.map((m) => streams.reduce((a, s) => a + (values[m]?.[s.key] ?? 0), 0));
  const max = niceMax(Math.max(...totals, 1));
  const plotH = H - padB - padT;
  const slot = (W - padL) / Math.max(months.length, 1);
  const bw = Math.min(46, slot * 0.56);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  return (
    <figure className="flex flex-col gap-3">
      <Legend items={streams.map((s, i) => ({ label: s.label, color: SERIES[i] as string }))} />
      <div dir="ltr">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
          {ticks.map((v) => {
            const y = padT + plotH - (v / max) * plotH;
            return (
              <g key={v}>
                <line
                  x1={padL}
                  x2={W}
                  y1={y}
                  y2={y}
                  stroke="var(--line)"
                  strokeWidth={v === 0 ? 1.2 : 0.8}
                />
                <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="11" fill="var(--ink-muted)">
                  {shekels(v, locale, { compact: true })}
                </text>
              </g>
            );
          })}
          {months.map((m, mi) => {
            const x = padL + slot * mi + (slot - bw) / 2;
            let acc = 0;
            const segs = streams
              .map((s, si) => ({ s, si, v: values[m]?.[s.key] ?? 0 }))
              .filter((g) => g.v > 0);
            return (
              <g key={m}>
                {segs.map((g, k) => {
                  const h = (g.v / max) * plotH;
                  const y = padT + plotH - ((acc + g.v) / max) * plotH;
                  acc += g.v;
                  const top = k === segs.length - 1;
                  const gap = k > 0 ? 2 : 0;
                  return (
                    <path
                      key={g.s.key}
                      d={
                        top
                          ? barPath(x, y, bw, Math.max(0, h - gap), 4)
                          : `M${x},${y} h${bw} v${Math.max(0, h - gap)} h${-bw} Z`
                      }
                      fill={SERIES[g.si]}
                    >
                      <title>{`${monthLabel(m)} · ${g.s.label}: ${shekels(g.v, locale)}`}</title>
                    </path>
                  );
                })}
                <rect x={x - 4} y={padT} width={bw + 8} height={plotH} fill="transparent">
                  <title>{`${monthLabel(m)}: ${shekels(totals[mi] ?? 0, locale)}`}</title>
                </rect>
                <text
                  x={x + bw / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--ink-muted)"
                >
                  {monthLabel(m)}
                </text>
                {mi === months.length - 1 ? (
                  <text
                    x={x + bw / 2}
                    y={padT + plotH - ((totals[mi] ?? 0) / max) * plotH - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="600"
                    fill="var(--ink)"
                  >
                    {shekels(totals[mi] ?? 0, locale, { compact: true })}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

/** Share of a whole (where divers come from). Few slices, each labelled in the legend with its share. */
export function Donut({
  slices,
  center,
  centerSub,
}: {
  slices: { label: string; value: number; detail?: string }[];
  center: string;
  centerSub: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const R = 52;
  const r = 34;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const a0 = angle;
    const sweep = (s.value / total) * Math.PI * 2;
    angle += sweep;
    const a1 = angle - (slices.length > 1 ? 0.03 : 0);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${60 + rad * Math.cos(a)},${60 + rad * Math.sin(a)}`;
    const d =
      sweep >= Math.PI * 2 - 0.001
        ? `M60,${60 - R} A${R},${R} 0 1 1 59.99,${60 - R} L59.99,${60 - r} A${r},${r} 0 1 0 60,${60 - r} Z`
        : `M${p(R, a0)} A${R},${R} 0 ${large} 1 ${p(R, a1)} L${p(r, a1)} A${r},${r} 0 ${large} 0 ${p(r, a0)} Z`;
    return { d, color: SERIES[i] as string, s, pct: Math.round((s.value / total) * 100) };
  });
  return (
    <figure className="flex items-center gap-5">
      <svg viewBox="0 0 120 120" className="size-32 shrink-0" role="img">
        {arcs.map((a) => (
          <path
            key={a.s.label}
            d={a.d}
            fill={a.color}
            stroke="var(--surface-raised)"
            strokeWidth="2"
          >
            <title>{`${a.s.label}: ${a.pct}%${a.s.detail ? ` · ${a.s.detail}` : ''}`}</title>
          </path>
        ))}
        <text x="60" y="58" textAnchor="middle" fontSize="18" fontWeight="700" fill="var(--ink)">
          {center}
        </text>
        <text x="60" y="74" textAnchor="middle" fontSize="9" fill="var(--ink-muted)">
          {centerSub}
        </text>
      </svg>
      <ul className="flex min-w-0 flex-col gap-2 text-sm">
        {arcs.map((a) => (
          <li key={a.s.label} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1.5 size-2.5 shrink-0 rounded-sm"
              style={{ background: a.color }}
            />
            <span className="min-w-0">
              <span className="font-medium">{a.s.label}</span>{' '}
              <span className="text-ink-muted tabular-nums">{a.pct}%</span>
              {a.s.detail ? (
                <span className="block text-xs text-ink-muted">{a.s.detail}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Horizontal bars of one measure (divers per level): one hue, the length carries the number. */
export function HBars({
  rows,
  format = (v) => String(v),
}: {
  rows: { label: string; value: number; note?: string }[];
  format?: (v: number) => string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li
          key={r.label}
          className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-3 text-sm"
        >
          <span className="truncate text-ink-muted">{r.label}</span>
          <span className="h-3 overflow-hidden rounded-e-full bg-[color-mix(in_oklch,var(--ink)_5%,transparent)]">
            <span
              className="block h-full rounded-e-full"
              style={{
                width: `${Math.max(2, (r.value / max) * 100)}%`,
                background: 'var(--series-1)',
              }}
              title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}
            />
          </span>
          <span className="tabular-nums font-medium">{format(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A diver's depth over time, drawn the way divers think about it: the surface on top, deeper is lower. Reference
 * lines for the personal best and today's allowed depth are labelled where they sit.
 */
export function DepthProfile({
  points,
  pb,
  allowed,
  labels,
}: {
  points: { on: string; depthM: number; label: string }[];
  pb: number | null;
  allowed: number;
  labels: { pb: string; allowed: string; surface: string };
}) {
  const W = 640;
  const H = 220;
  const padL = 40;
  const padR = 12;
  const padT = 22;
  const padB = 16;
  const maxD =
    Math.ceil(Math.max(allowed, pb ?? 0, ...points.map((p) => p.depthM), 10) / 5) * 5 + 5;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const x = (i: number) =>
    padL + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = (d: number) => padT + (d / maxD) * plotH;
  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.depthM).toFixed(1)}`)
    .join(' ');
  const area = points.length
    ? `${line} L${x(points.length - 1).toFixed(1)},${padT} L${x(0).toFixed(1)},${padT} Z`
    : '';
  const ticks = Array.from({ length: Math.floor(maxD / 10) + 1 }, (_, i) => i * 10);
  return (
    <div dir="ltr">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img">
        <defs>
          <linearGradient id="depth-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--dive-shallow)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--dive-deep)" stopOpacity="0.25" />
          </linearGradient>
        </defs>
        <rect x={padL} y={padT} width={plotW} height={plotH} fill="url(#depth-water)" rx="6" />
        {ticks.map((d) => (
          <g key={d}>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(d)}
              y2={y(d)}
              stroke="var(--line)"
              strokeWidth="0.8"
            />
            <text x={padL - 6} y={y(d) + 4} textAnchor="end" fontSize="11" fill="var(--ink-muted)">
              {d === 0 ? labels.surface : `${d}m`}
            </text>
          </g>
        ))}
        <line
          x1={padL}
          x2={W - padR}
          y1={y(allowed)}
          y2={y(allowed)}
          stroke="var(--series-2)"
          strokeWidth="1.5"
          strokeDasharray="5 4"
        />
        <text x={W - padR - 4} y={y(allowed) - 5} textAnchor="end" fontSize="11" fill="var(--ink)">
          {labels.allowed}
        </text>
        {pb !== null ? (
          <>
            <line
              x1={padL}
              x2={W - padR}
              y1={y(pb)}
              y2={y(pb)}
              stroke="var(--series-3)"
              strokeWidth="1.5"
              strokeDasharray="2 3"
            />
            <text x={padL + 6} y={y(pb) + 14} fontSize="11" fill="var(--ink)">
              {labels.pb}
            </text>
          </>
        ) : null}
        {points.length ? (
          <>
            <path d={area} fill="var(--series-1)" opacity="0.08" />
            <path
              d={line}
              fill="none"
              stroke="var(--series-1)"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </>
        ) : null}
        {points.map((p, i) => (
          <g key={`${p.on}-${i}`}>
            <circle
              cx={x(i)}
              cy={y(p.depthM)}
              r="4"
              fill="var(--series-1)"
              stroke="var(--surface-raised)"
              strokeWidth="2"
            />
            <circle cx={x(i)} cy={y(p.depthM)} r="12" fill="transparent">
              <title>{p.label}</title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** A tiny week-at-a-glance strip: one bar per day, height = divers in the water. */
export function DayStrip({
  days,
}: {
  days: { label: string; value: number; title: string; tone?: 'go' | 'caution' | 'no_go' }[];
}) {
  const max = Math.max(...days.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5" dir="ltr">
      {days.map((d) => (
        <div key={d.label} className="flex flex-1 flex-col items-center gap-1" title={d.title}>
          <div className="flex h-14 w-full items-end">
            <div
              className="w-full rounded-t-md"
              style={{
                height: `${Math.max(6, (d.value / max) * 100)}%`,
                background:
                  d.tone === 'no_go'
                    ? 'var(--dive-nogo)'
                    : d.tone === 'caution'
                      ? 'var(--dive-caution)'
                      : 'var(--series-1)',
              }}
            />
          </div>
          <span className="text-[10px] text-ink-muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * The lines in the water: one rope per buoy, each diver marked at their target depth. What the instructor briefs on
 * the beach, drawn. Divers on a line share one colour (the line is the identity); names sit next to the marks.
 */
export function LineDiagram({
  lines,
  labels,
}: {
  lines: { line: string; divers: { name: string; targetM: number }[] }[];
  labels: { line: (l: string) => string; surface: string };
}) {
  const W = 640;
  const H = 230;
  const padT = 34;
  const padB = 12;
  const padL = 40;
  const maxD =
    Math.ceil(Math.max(10, ...lines.flatMap((l) => l.divers.map((d) => d.targetM))) / 10) * 10;
  const y = (d: number) => padT + (d / maxD) * (H - padT - padB);
  const colW = (W - padL) / Math.max(lines.length, 1);
  const ticks = Array.from({ length: maxD / 10 + 1 }, (_, i) => i * 10);
  return (
    <div dir="ltr" className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[420px] max-w-3xl" role="img">
        <defs>
          <linearGradient id="line-water" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--dive-shallow)" stopOpacity="0.5" />
            <stop offset="1" stopColor="var(--dive-deep)" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        <rect
          x={padL}
          y={padT}
          width={W - padL}
          height={H - padT - padB}
          fill="url(#line-water)"
          rx="8"
        />
        {ticks.map((d) => (
          <g key={d}>
            <line x1={padL} x2={W} y1={y(d)} y2={y(d)} stroke="var(--line)" strokeWidth="0.6" />
            <text x={padL - 6} y={y(d) + 4} textAnchor="end" fontSize="10" fill="var(--ink-muted)">
              {d === 0 ? labels.surface : `${d}m`}
            </text>
          </g>
        ))}
        {lines.map((l, i) => {
          const cx = padL + colW * i + colW / 2;
          const color = SERIES[i % SERIES.length] as string;
          const deepest = Math.max(...l.divers.map((d) => d.targetM), 5);
          return (
            <g key={l.line}>
              <line
                x1={cx}
                x2={cx}
                y1={padT - 6}
                y2={y(deepest) + 8}
                stroke="var(--ink-muted)"
                strokeWidth="1.4"
              />
              <circle cx={cx} cy={padT - 12} r="9" fill="var(--dive-coral)" />
              <text
                x={cx}
                y={padT - 8}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill="white"
              >
                {l.line}
              </text>
              <rect
                x={cx - 7}
                y={y(deepest) + 8}
                width="14"
                height="6"
                rx="2"
                fill="var(--ink-muted)"
              />
              {[...new Set(l.divers.map((d) => d.targetM))].map((m, k) => {
                const side = k % 2 === 0 ? 1 : -1;
                const names = l.divers
                  .filter((d) => d.targetM === m)
                  .map((d) => d.name)
                  .join(', ');
                return (
                  <g key={m}>
                    <circle
                      cx={cx}
                      cy={y(m)}
                      r="5"
                      fill={color}
                      stroke="var(--surface-raised)"
                      strokeWidth="2"
                    >
                      <title>{`${labels.line(l.line)} · ${names}: ${m}m`}</title>
                    </circle>
                    <text
                      x={cx + side * 10}
                      y={y(m) + 4}
                      textAnchor={side > 0 ? 'start' : 'end'}
                      fontSize="11"
                      fill="var(--ink)"
                    >
                      {`${names} ${m}m`}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
