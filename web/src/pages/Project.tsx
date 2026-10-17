import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import type { Clip, JobEvent, Project as P, Settings, Transcript as T } from '../api';
import { ClipList } from '../components/ClipList';
import { Player } from '../components/Player';
import { Trimmer } from '../components/Trimmer';
import { Transcript } from '../components/Transcript';
import { ExportOptions } from './Settings';

export function Project({ id }: { id: string }) {
  const [project, setProject] = useState<P | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [transcript, setTranscript] = useState<T | null>(null);
  const [exports, setExports] = useState<{ file: string; url: string; size: number }[]>([]);
  const [active, setActive] = useState<string>();
  const [job, setJob] = useState<JobEvent | null>(null);
  const [error, setError] = useState('');
  const [opts, setOpts] = useState<Pick<Settings, 'framing' | 'captions' | 'captionStyle'> | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const timers = useRef<Record<string, number>>({});

  const load = async () => {
    const p = await api.getProject(id);
    setProject(p);
    if (p.status === 'ready' || clips.length) {
      const cs = await api.getClips(id);
      setClips(cs);
      setActive((a) => a ?? cs[0]?.id);
      api.getTranscript(id).then(setTranscript).catch(() => {});
    }
    api.listExports(id).then(setExports).catch(() => {});
  };
  useEffect(() => {
    load().catch((e) => setError(e.message));
    api.getSettings().then((s) => setOpts({ framing: s.framing, captions: s.captions, captionStyle: s.captionStyle }));
    return api.subscribeEvents(id, (e) => {
      if (e.connected) { if (e.running) setJob(e); return; }
      setJob(e.done ? null : e);
      if (e.done) { if (e.error) setError(e.error); load().catch(() => {}); }
    });
  }, [id]);

  const activeClip = clips.find((c) => c.id === active);
  const running = !!job || project?.status === 'transcribing' || project?.status === 'analyzing';
  const selected = clips.filter((c) => c.selected);
  const duration = project?.duration ?? 0;

  const pending = useRef<Record<string, Partial<Clip>>>({});
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
            <Player ref={video} src={`/api/projects/${id}/video`} clip={activeClip} />
            {activeClip && <Trimmer clip={activeClip} duration={duration} onTrim={(start, end) => edit(activeClip.id, { start, end })} />}
            <Transcript words={transcript?.words ?? []} clip={activeClip} onSeek={(t) => { if (video.current) video.current.currentTime = t; }} />
          </div>
          <div>
            <h3>{clips.length} suggested clips <span className="muted small">(ranked by AI score)</span></h3>
            <ClipList clips={clips} activeId={active} onSelect={setActive} onChange={edit} />
            <section className="panel">
              <h3>Export {selected.length} clip{selected.length === 1 ? '' : 's'} · 1080×1920</h3>
              {opts && <ExportOptions s={opts} set={(k, v) => setOpts({ ...opts, [k]: v })} />}
              <button disabled={running || !selected.length} onClick={() => {
                setError('');
                api.exportClips(id, opts ?? {}).then(() => setJob({ stage: 'export', pct: 0, message: 'Starting export…' })).catch((e) => setError(e.message));
              }}>Export selected clips</button>
              {exports.length > 0 && (
                <ul className="exports">
                  {exports.map((x) => <li key={x.file}><a href={x.url}>{x.file}</a> <span className="muted small">{(x.size / 1e6).toFixed(1)} MB</span></li>)}
                </ul>
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
