import { useEffect, useRef, useState } from 'react';
import { createProjectFromFile, createProjectFromPath, deleteProject, listProjects, pickFile, type Project } from '../api';

const label: Record<Project['status'], string> = {
  new: 'Ready to analyze', transcribing: 'Transcribing…', analyzing: 'Finding clips…', ready: 'Clips ready', error: 'Error',
};
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = () => listProjects().then(setProjects).catch((e) => setErr(e.message));
  useEffect(() => { refresh(); const t = setInterval(refresh, 4000); return () => clearInterval(t); }, []);

  async function add(fn: () => Promise<Project>, what: string) {
    setErr(''); setBusy(what);
    try { location.hash = `#/p/${(await fn()).id}`; } catch (e) { setErr((e as Error).message); }
    setBusy('');
  }

  return (
    <>
      <h1>Turn long videos into viral shorts</h1>
      <p className="muted">Drop a video. The AI finds the best moments, you trim and export 9:16 clips with captions. Everything runs on this Mac.</p>
      <div
        className={`drop ${drag ? 'drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) add(() => createProjectFromFile(f), `Uploading ${f.name}…`); }}
        onClick={() => input.current?.click()}
      >
        <input ref={input} type="file" accept="video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) add(() => createProjectFromFile(f), `Uploading ${f.name}…`); }} />
        {busy || 'Drop a video here, or click to choose a file'}
      </div>
      <div className="row">
        <button disabled={!!busy} onClick={() => {
          setErr(''); setBusy('Choose a video in the macOS window…');
          pickFile()
            .then(({ path }) => { if (path) return createProjectFromPath(path).then((p) => { location.hash = `#/p/${p.id}`; }); })
            .catch((e) => setErr(e.message))
            .finally(() => setBusy(''));
        }}>📁 Choose a video file… <span className="small">(recommended — no copy)</span></button>
        <span className="muted small">Opens the macOS file picker and uses the file where it is.</span>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (path.trim()) add(() => createProjectFromPath(path.trim()), 'Reading file…'); }}>
        <input placeholder="…or paste a file path, e.g. /Users/you/Movies/podcast.mp4" value={path} onChange={(e) => setPath(e.target.value)} />
        <button disabled={!path.trim() || !!busy}>Open</button>
      </form>
      {err && <div className="banner err">{err}</div>}
      <div className="grid">
        {projects.map((p) => (
          <a key={p.id} className="card" href={`#/p/${p.id}`}>
            <b>{p.name}</b>
            <span className="muted">{fmt(p.duration)} · <span className={`pill ${p.status}`}>{label[p.status]}</span></span>
            <button className="ghost" onClick={(e) => { e.preventDefault(); if (confirm(`Delete “${p.name}” from ViralClips? (The video file is kept.)`)) deleteProject(p.id).then(refresh); }}>Remove</button>
          </a>
        ))}
      </div>
    </>
  );
}
