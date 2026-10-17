import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { Clip, JobEvent, Project as P, Settings, Transcript as T } from '../api';
import { ClipList } from '../components/ClipList';
import { Player } from '../components/Player';
import { Trimmer } from '../components/Trimmer';
import { Transcript } from '../components/Transcript';
import { ExportFolder } from '../components/ExportFolder';
import { ExportOptions } from './Settings';

const fmtT = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Project({ id }: { id: string }) {
  const [project, setProject] = useState<P | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [transcript, setTranscript] = useState<T | null>(null);
  const [exports, setExports] = useState<api.ExportFile[]>([]);
  const [exportDir, setExportDir] = useState('');
  const [active, setActive] = useState<string>();
  const [job, setJob] = useState<JobEvent | null>(null);
  const [error, setError] = useState('');
  const [opts, setOpts] = useState<Pick<Settings, 'framing' | 'captions' | 'captionStyle'> | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const timers = useRef<Record<string, number>>({});

  const load = async () => {
    const p = await api.getProject(id);
    setProject(p);
    const cs = await api.getClips(id);
    setClips(cs);
    setActive((a) => (a && cs.some((c) => c.id === a) ? a : cs[0]?.id));
    if (cs.length) api.getTranscript(id).then(setTranscript).catch(() => {});
    api.listExports(id).then(setExports).catch(() => {});
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api.getSettings().then((s) => { setOpts({ framing: s.framing, captions: s.captions, captionStyle: s.captionStyle }); setExportDir(s.exportDir ?? ''); });
    return api.subscribeEvents(id, (e) => {
      if (e.connected) { setJob(e.running ? e : null); if (!e.running) load().catch(() => {}); return; }
      setJob(e.done ? null : e);
      if (e.done) { if (e.error) setError(e.error); load().catch(() => {}); }
    });
  }, [id]);

  const activeClip = clips.find((c) => c.id === active);
  const running = !!job || project?.status === 'transcribing' || project?.status === 'analyzing';
  const selected = clips.filter((c) => c.selected);
  const duration = project?.duration ?? 0;

  const pending = useRef<Record<string, Partial<Clip>>>({});
  async function flushEdits() {
    const todo = Object.entries(pending.current);
    pending.current = {};
    todo.forEach(([cid]) => clearTimeout(timers.current[cid]));
    await Promise.all(todo.map(([cid, body]) => api.patchClip(cid, body)));
  }
  function edit(cid: string, patch: Partial<Clip>) {
    setClips((cs) => cs.map((c) => (c.id === cid ? { ...c, ...patch } : c)));
    pending.current[cid] = { ...pending.current[cid], ...patch };
    clearTimeout(timers.current[cid]);
    timers.current[cid] = window.setTimeout(() => {
      const body = pending.current[cid];
      delete pending.current[cid];
      api.patchClip(cid, body).catch((e) => setError(e.message));
    }, 350);
  }

  if (!project) return error ? <div className="banner err">{error}</div> : <p className="muted">Loading…</p>;

  return (
    <>
      <p><a href="#/">← Projects</a></p>
      <h1>{project.name}</h1>
      <div className="row">
        <button disabled={running} onClick={() => { setError(''); api.analyze(id).then(() => setJob({ stage: 'transcribe', pct: 0, message: 'Starting…' })).catch((e) => setError(e.message)); }}>
          {clips.length ? 'Re-run clip finder' : '✨ Find best clips'}
        </button>
        {job && (
          <div className="progress">
            <div style={{ width: `${job.pct}%` }} />
            <span>{job.message ?? job.stage} {job.pct}%</span>
          </div>
        )}
      </div>
      {(error || project.status === 'error') && <div className="banner err">{error || project.error}</div>}

      {clips.length > 0 && (
        <div className="split">
          <div>
            {activeClip && (
              <div className="now">
                <div className="now-top">
                  <span className="now-label">Now playing</span>
                  <span className="muted small">{fmtT(activeClip.start)}–{fmtT(activeClip.end)} · {Math.round(activeClip.end - activeClip.start)}s</span>
                  <span className="pill ready">AI score {Math.round(activeClip.score)}</span>
                </div>
                <div className="now-title">{activeClip.title}</div>
                <div className="small"><b>Why the AI picked it:</b> {activeClip.reason}</div>
              </div>
            )}
            <Player ref={video} src={`/api/projects/${id}/video`} clip={activeClip} />
            {activeClip && <Trimmer clip={activeClip} duration={duration} onTrim={(start, end) => edit(activeClip.id, { start, end })} />}
            <Transcript words={transcript?.words ?? []} clip={activeClip} onSeek={(t) => { if (video.current) video.current.currentTime = t; }} />
          </div>
          <div>
            <h3>{clips.length} suggested clips <span className="muted small">(ranked by AI score)</span></h3>
            <ClipList clips={clips} words={transcript?.words ?? []} activeId={active} onSelect={setActive} onChange={edit} />
            <section className="panel">
              <h3>Export {selected.length} clip{selected.length === 1 ? '' : 's'} · 1080×1920</h3>
              {opts && <ExportOptions s={opts} set={(k, v) => setOpts({ ...opts, [k]: v })} />}
              <ExportFolder value={exportDir} onChange={(d) => { setExportDir(d); api.putSettings({ exportDir: d }).catch((e) => setError(e.message)); }} />
              <button disabled={running || !selected.length} onClick={() => {
                setError('');
                flushEdits().then(() => api.exportClips(id, opts ?? {})).then(() => setJob({ stage: 'export', pct: 0, message: 'Starting export…' })).catch((e) => setError(e.message));
              }}>Export selected clips</button>
              {exports.length > 0 && (
                <>
                  <div className="muted small" style={{ marginTop: 12 }}>Exported clips · {exports[0].folder}</div>
                  <ul className="exports">
                    {exports.map((x) => (
                      <li key={x.file}>
                        <a href={x.url}>{x.file}</a> <span className="muted small">{(x.size / 1e6).toFixed(1)} MB</span>{' '}
                        <button className="ghost" onClick={() => api.revealExport(x.url).catch((e) => setError(e.message))}>Show in folder</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>
      )}
      {!clips.length && !running && project.status !== 'error' && (
        <p className="muted">Click “Find best clips” — it transcribes the video locally, then asks your AI model to pick the most shareable moments.</p>
      )}
    </>
  );
}
