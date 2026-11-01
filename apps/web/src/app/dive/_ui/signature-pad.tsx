'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SIGNATURE_PAD } from '@rswim/contracts';
import { useFormResult } from '@/components/form';

type Stroke = [number, number][];

/**
 * A pad to sign with a finger or a mouse. It keeps the strokes as points on a 600x200 grid in a hidden field named
 * `signature` (JSON), so the server stores points and draws them back, never an image the browser made.
 */
export function SignaturePad({
  label,
  hint,
  clear,
}: {
  label: string;
  hint: string;
  clear: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const drawing = useRef(false);
  const [value, setValue] = useState('');
  const error = useFormResult().errors.signature;

  const redraw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const ratio = c.width / SIGNATURE_PAD.width;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.5 * ratio;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = getComputedStyle(c).color;
    for (const s of strokes.current) {
      ctx.beginPath();
      s.forEach(([x, y], i) =>
        i === 0 ? ctx.moveTo(x * ratio, y * ratio) : ctx.lineTo(x * ratio, y * ratio),
      );
      const [first] = s;
      if (s.length === 1 && first) ctx.lineTo(first[0] * ratio + 0.5, first[1] * ratio + 0.5);
      ctx.stroke();
    }
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const fit = () => {
      const w = c.clientWidth;
      c.width = Math.round(w * (window.devicePixelRatio || 1));
      c.height = Math.round((c.width * SIGNATURE_PAD.height) / SIGNATURE_PAD.width);
      redraw();
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [redraw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * SIGNATURE_PAD.width);
    const y = Math.round(((e.clientY - r.top) / r.height) * SIGNATURE_PAD.height);
    return [
      Math.max(0, Math.min(SIGNATURE_PAD.width, x)),
      Math.max(0, Math.min(SIGNATURE_PAD.height, y)),
    ];
  };
  const total = () => strokes.current.reduce((n, s) => n + s.length, 0);
  const commit = () => setValue(strokes.current.length ? JSON.stringify(strokes.current) : '');

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <button
          type="button"
          className="min-h-9 rounded-lg px-2.5 text-sm text-[var(--dive-sea)] hover:underline"
          onClick={() => {
            strokes.current = [];
            redraw();
            commit();
          }}
          data-testid="signature-clear"
        >
          {clear}
        </button>
      </div>
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        className="aspect-[3/1] w-full touch-none rounded-xl border-2 border-dashed border-line bg-white text-[#0b2a4a] aria-[invalid=true]:border-danger"
        aria-invalid={Boolean(error)}
        data-testid="signature-pad"
        onPointerDown={(e) => {
          if (total() >= SIGNATURE_PAD.maxPoints) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          strokes.current.push([point(e)]);
          redraw();
        }}
        onPointerMove={(e) => {
          if (!drawing.current || total() >= SIGNATURE_PAD.maxPoints) return;
          const s = strokes.current[strokes.current.length - 1];
          const p = point(e);
          const last = s?.[s.length - 1];
          if (s && (!last || Math.abs(last[0] - p[0]) + Math.abs(last[1] - p[1]) >= 2)) {
            s.push(p);
            redraw();
          }
        }}
        onPointerUp={() => {
          drawing.current = false;
          commit();
        }}
        onPointerCancel={() => {
          drawing.current = false;
          commit();
        }}
      />
      <input type="hidden" name="signature" value={value} />
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : (
        <p className="text-xs text-ink-muted">{hint}</p>
      )}
    </div>
  );
}

/** "I have read and agree", with the form's error under it when it was left unticked. */
export function AgreeBox({ label }: { label: string }) {
  const error = useFormResult().errors.agree;
  return (
    <div className="flex flex-col gap-1">
      <label className="flex min-h-tap items-start gap-3 text-sm">
        <input
          type="checkbox"
          name="agree"
          aria-invalid={Boolean(error)}
          className="mt-0.5 size-5 shrink-0 accent-[var(--dive-sea)]"
          data-testid="agree"
        />
        <span>{label}</span>
      </label>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
