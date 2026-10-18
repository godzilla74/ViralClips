import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import { detectFace } from '../faceDetect';
import { clampRect, moveRect, pickPanels, resizeRect, type Layout, type Rect } from '../layout';

type Key = 'screen' | 'face' | 'facePanel';
const META: Record<Key, { label: string; color: string; hint: string; fallback: Rect }> = {
  screen: { label: 'Screen share', color: '#2ecc8f', hint: 'The screen recording that goes on top.', fallback: { x: 0.05, y: 0.15, w: 0.6, h: 0.6 } },
  face: { label: 'Face', color: '#ff5c6c', hint: 'Your face — the bottom panel is centred on it.', fallback: { x: 0.72, y: 0.3, w: 0.15, h: 0.25 } },
  facePanel: { label: 'Webcam area', color: '#46c7ff', hint: 'Optional: limits how far the face crop can reach (keeps the background out).', fallback: { x: 0.7, y: 0.1, w: 0.28, h: 0.8 } },
};
const EMPTY: Layout = { screen: null, face: null, facePanel: null };

/** Detect the screen + face, then drag the boxes to fix anything the detector got wrong. */
export function LayoutEditor({ projectId, duration, layout, onSaved }: {
  projectId: string; duration: number; layout: Layout | null; onSaved: (l: Layout) => void;
}) {
  const [draft, setDraft] = useState<Layout>(layout ?? EMPTY);
  const [active, setActive] = useState<Key>('screen');
  const [times, setTimes] = useState<number[]>([]);
  const [frame, setFrame] = useState(0);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { setDraft(layout ?? EMPTY); setDirty(false); }, [layout]);
  const t = times.length ? times[frame] : +(duration / 2).toFixed(2);
  const update = (k: Key, r: Rect | null) => { setDraft((d) => ({ ...d, [k]: r })); setDirty(true); };

  async function detect() {
    setBusy(true); setMsg('Looking at the video…');
    try {
      const a = await api.analyzeLayout(projectId);
      setTimes(a.times);
      setMsg('Finding your face…');
      const { face, hits, total } = await detectFace(a.times.map((x) => api.frameUrl(projectId, x)));
      const { screen, facePanel } = pickPanels(a.panels, face);
      setDraft({ screen, face, facePanel }); setDirty(true);
      setMsg([
        screen ? 'Found the screen share.' : 'No separate screen share found (talking-head layout).',
        face ? `Found your face in ${hits} of ${total} frames.` : 'No face found — drag the red box onto your face.',
        'Check the boxes below, adjust if needed, then Save.',
      ].join(' '));
      if (!face) update('face', META.face.fallback);
    } catch (e) { setMsg(`Detection failed: ${(e as Error).message}. You can still draw the boxes by hand.`); }
    setBusy(false);
  }

  async function save() {
    setBusy(true);
    try { const { layout: saved } = await api.putLayout(projectId, draft); onSaved(saved); setDirty(false); setMsg('Layout saved.'); }
    catch (e) { setMsg(`Could not save: ${(e as Error).message}`); }
    setBusy(false);
  }

  function drag(k: Key, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') {
    return (e: React.PointerEvent) => {
      e.stopPropagation(); e.preventDefault();
      const el = box.current!; const r0 = draft[k]!;
      const start = { x: e.clientX, y: e.clientY }; const b = el.getBoundingClientRect();
      const move = (ev: PointerEvent) => {
        const dx = (ev.clientX - start.x) / b.width, dy = (ev.clientY - start.y) / b.height;
        update(k, mode === 'move' ? moveRect(r0, dx, dy) : resizeRect(r0, mode, dx, dy));
      };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
  }

  return (
    <div className="layout-editor">
      <div className="row" style={{ margin: '6px 0' }}>
        <button className="ghost" disabled={busy} onClick={detect}>✨ Detect screen &amp; face</button>
        {times.length > 1 && (
          <span className="muted small">
            Frame <button className="ghost" onClick={() => setFrame((frame + times.length - 1) % times.length)}>‹</button>
            {frame + 1}/{times.length}
            <button className="ghost" onClick={() => setFrame((frame + 1) % times.length)}>›</button>
          </span>
        )}
        <button disabled={busy || !dirty} onClick={save} style={{ marginLeft: 'auto' }}>Save layout</button>
      </div>
      {msg && <div className="muted small" style={{ marginBottom: 6 }}>{msg}</div>}
      <div className="frame" ref={box}>
        <img src={api.frameUrl(projectId, t)} alt="Video frame" draggable={false} />
        {(Object.keys(META) as Key[]).map((k) => {
          const r = draft[k]; if (!r) return null;
          const on = k === active;
          return (
            <div key={k} className={`rect ${on ? 'on' : ''}`} onPointerDown={() => setActive(k)}
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%`, borderColor: META[k].color, borderStyle: k === 'facePanel' ? 'dashed' : 'solid' }}>
              <span className="tag" style={{ background: META[k].color }}>{META[k].label}</span>
              {on && <div className="move" onPointerDown={drag(k, 'move')} />}
              {on && (['nw', 'ne', 'sw', 'se'] as const).map((c) => <i key={c} className={`corner ${c}`} onPointerDown={drag(k, c)} style={{ borderColor: META[k].color }} />)}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {(Object.keys(META) as Key[]).map((k) => (
          <span key={k} className={`chip ${active === k ? 'on' : ''}`} style={{ borderColor: META[k].color }} title={META[k].hint}>
            <button className="ghost" onClick={() => setActive(k)}>{META[k].label}</button>
            {draft[k]
              ? <button className="ghost" title="Remove" onClick={() => update(k, null)}>✕</button>
              : <button className="ghost" onClick={() => { update(k, clampRect(META[k].fallback)); setActive(k); }}>+ add</button>}
          </span>
        ))}
      </div>
    </div>
  );
}
