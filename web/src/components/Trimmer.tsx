import { useEffect, useRef, useState } from 'react';
import type { Clip } from '../api';
import { clampTrim } from '../trim';

/** Mini timeline around the clip with two draggable handles + numeric inputs. */
export function Trimmer({ clip, duration, onTrim }: { clip: Clip; duration: number; onTrim: (start: number, end: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const lo = Math.max(0, clip.start - 30);
  const hi = Math.min(duration, clip.end + 30);
  const pct = (t: number) => ((t - lo) / (hi - lo)) * 100;
  const toTime = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return lo + Math.min(1, Math.max(0, (x - r.left) / r.width)) * (hi - lo);
  };
  const drag = (which: 'start' | 'end') => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const t = toTime(ev.clientX);
      const r = which === 'start' ? clampTrim(t, clip.end, duration) : clampTrim(clip.start, t, duration);
      onTrim(r.start, r.end);
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const commit = (which: 'start' | 'end', text: string) => {
    const v = Number(text);
    if (text.trim() === '' || !Number.isFinite(v)) return;
    const r = which === 'start' ? clampTrim(v, clip.end, duration) : clampTrim(clip.start, v, duration);
    onTrim(r.start, r.end);
  };
  return (
    <div className="trimmer">
      <div className="bar" ref={bar}>
        <div className="sel" style={{ left: `${pct(clip.start)}%`, width: `${pct(clip.end) - pct(clip.start)}%` }} />
        <div className="handle" style={{ left: `${pct(clip.start)}%` }} onPointerDown={drag('start')} />
        <div className="handle" style={{ left: `${pct(clip.end)}%` }} onPointerDown={drag('end')} />
      </div>
      <div className="row3">
        <TimeField label="Start (s)" value={clip.start} onCommit={(t) => commit('start', t)} />
        <TimeField label="End (s)" value={clip.end} onCommit={(t) => commit('end', t)} />
        <label>Length<input readOnly value={`${(clip.end - clip.start).toFixed(1)}s`} /></label>
      </div>
    </div>
  );
}

/** Free-typing number box: applies on blur/Enter so partial input (e.g. "1" on the way to "185") isn't clamped mid-typing. */
function TimeField({ label, value, onCommit }: { label: string; value: number; onCommit: (text: string) => void }) {
  const [text, setText] = useState(String(+value.toFixed(2)));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setText(String(+value.toFixed(2))); }, [value]);
  return (
    <label>{label}
      <input type="number" step="0.1" value={text}
        onFocus={() => { editing.current = true; }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { editing.current = false; onCommit(text); setText(String(+value.toFixed(2))); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}
