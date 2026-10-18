import { useEffect, useState } from 'react';
import { previewUrl, type PreviewOptions, type Settings } from '../api';

/** Fetches a rendered still; shows the server's error (e.g. "set up the layout first") instead of a broken image. */
function Still({ url, label, aspect }: { url: string; label: string; aspect: string }) {
  const [state, setState] = useState<{ src?: string; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let cancelled = false, objectUrl = '';
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => { // debounce while options are being changed
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Preview failed (${res.status})`);
        objectUrl = URL.createObjectURL(await res.blob());
        if (!cancelled) setState({ src: objectUrl, loading: false });
      } catch (e) { if (!cancelled) setState({ error: (e as Error).message, loading: false }); }
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return (
    <figure className="still">
      <div className="still-box" style={{ aspectRatio: aspect }}>
        {state.src && <img src={state.src} alt={`${label} preview`} style={{ opacity: state.loading ? 0.5 : 1 }} />}
        {state.error && <div className="still-error small">{state.error}</div>}
        {state.loading && !state.src && !state.error && <div className="still-error muted small">Rendering…</div>}
      </div>
      <figcaption className="muted small">{label}</figcaption>
    </figure>
  );
}

/** What the export will look like — the same filter graph as the export, rendered as a single frame. */
export function PreviewPanel({ projectId, clipId, clipLength, opts, outputs, version }: {
  projectId: string; clipId: string; clipLength: number; opts: PreviewOptions; outputs: Settings['outputs']; version: number;
}) {
  const [t, setT] = useState(clipLength / 2);
  useEffect(() => setT(clipLength / 2), [clipId, clipLength]);
  const kinds: ('vertical' | 'wide')[] = outputs === 'both' ? ['vertical', 'wide'] : [outputs];
  return (
    <div className="preview">
      <div className="muted small" style={{ marginBottom: 6 }}>Preview of the export (this clip, at {t.toFixed(1)} s)</div>
      <div className="stills">
        {kinds.map((k) => (
          <Still key={k} label={k === 'vertical' ? 'Vertical 9:16' : 'Widescreen 16:9'} aspect={k === 'vertical' ? '9 / 16' : '16 / 9'}
            url={previewUrl(projectId, clipId, k, +t.toFixed(2), opts, version)} />
        ))}
      </div>
      <input type="range" min={0} max={Math.max(0.1, clipLength)} step={0.1} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Preview time" />
    </div>
  );
}
