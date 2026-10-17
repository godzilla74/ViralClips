import { useEffect, useState } from 'react';
import { ExportFolder } from '../components/ExportFolder';
import { getSettings, listModels, putSettings, type ModelInfo, type Settings as S } from '../api';

export function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelErr, setModelErr] = useState('');
  const [key, setKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => { getSettings().then(setS); }, []);
  useEffect(() => {
    if (!s) return;
    setModelErr('');
    // models are listed for the *saved* provider, so save first when switching
    listModels().then(setModels).catch((e) => { setModels([]); setModelErr(e.message); });
  }, [s?.provider, s?.hasKey]);

  if (!s) return <p className="muted">Loading…</p>;
  const set = <K extends keyof S>(k: K, v: S[K]) => { setSaved(false); setS({ ...s, [k]: v }); };
  const save = async () => {
    const { hasKey, openaiKey, ...rest } = s;
    setS(await putSettings({ ...rest, openaiKey: key })); setKey(''); setSaved(true);
  };
  const switchProvider = async (provider: S['provider']) => {
    setS({ ...s, provider }); setSaved(false);
    setS(await putSettings({ provider }).then((r) => ({ ...s, ...r })));
  };
  const modelKey = s.provider === 'ollama' ? 'ollamaModel' : 'openaiModel';

  return (
    <>
      <h1>Settings</h1>
      <section className="panel">
        <h3>AI provider</h3>
        <label className="radio"><input type="radio" checked={s.provider === 'ollama'} onChange={() => switchProvider('ollama')} /> Ollama <span className="muted">(local, free, private)</span></label>
        <label className="radio"><input type="radio" checked={s.provider === 'openai'} onChange={() => switchProvider('openai')} /> OpenAI <span className="muted">(API key, better quality)</span></label>
        <label>Model
          {models.length > 0 ? (
            <select value={s[modelKey]} onChange={(e) => set(modelKey, e.target.value)}>
              {!models.some((m) => m.name === s[modelKey]) && <option value={s[modelKey]}>{s[modelKey]} (not installed)</option>}
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}{m.reasoning ? '  ⚠ reasoning (slow/unreliable)' : m.vision ? '  (vision — extra size unused)' : '  ✓ recommended type'}
                </option>
              ))}
            </select>
          ) : (
            <input value={s[modelKey]} placeholder="Model name" onChange={(e) => set(modelKey, e.target.value)} />
          )}
        </label>
        {models.find((m) => m.name === s[modelKey])?.reasoning && (
          <div className="banner warn">
            This is a reasoning model. It can take minutes per section or return nothing. For clip-finding, a plain text model
            works much better (e.g. qwen2.5:14b, llama3.1:8b, mistral-nemo, phi4, gemma3:12b).
          </div>
        )}
        {modelErr && <div className="banner warn">{modelErr}</div>}
        {s.provider === 'openai' && (
          <label>OpenAI API key {s.hasKey && <span className="pill ready">saved</span>}
            <input type="password" placeholder={s.hasKey ? '•••••••• (leave blank to keep)' : 'sk-…'} value={key} onChange={(e) => { setSaved(false); setKey(e.target.value); }} />
            <span className="muted">Only the transcript text is sent to OpenAI — never the video.</span>
          </label>
        )}
      </section>
      <section className="panel">
        <h3>Clips</h3>
        <div className="row3">
          <label>Min length (s)<input type="number" min={5} value={s.clipMinSec} onChange={(e) => set('clipMinSec', Number(e.target.value))} /></label>
          <label>Max length (s)<input type="number" min={10} value={s.clipMaxSec} onChange={(e) => set('clipMaxSec', Number(e.target.value))} /></label>
          <label>How many<input type="number" min={1} max={30} value={s.clipCount} onChange={(e) => set('clipCount', Number(e.target.value))} /></label>
        </div>
        <ExportOptions s={s} set={set} />
        <ExportFolder value={s.exportDir ?? ''} onChange={(d) => set('exportDir', d)} />
      </section>
      <button onClick={save}>Save settings</button> {saved && <span className="muted">Saved ✓</span>}
    </>
  );
}

export function ExportOptions({ s, set }: { s: Pick<S, 'framing' | 'captions' | 'captionStyle'>; set: <K extends 'framing' | 'captions' | 'captionStyle'>(k: K, v: S[K]) => void }) {
  return (
    <div className="row3">
      <label>Framing
        <select value={s.framing} onChange={(e) => set('framing', e.target.value as S['framing'])}>
          <option value="crop">Fill (center crop)</option>
          <option value="blur">Fit on blurred background</option>
          <option value="original">Fit with black bars</option>
        </select>
      </label>
      <label>Captions
        <select value={s.captions ? 'on' : 'off'} onChange={(e) => set('captions', e.target.value === 'on')}>
          <option value="on">On</option><option value="off">Off</option>
        </select>
      </label>
      <label>Caption style
        <select value={s.captionStyle} disabled={!s.captions} onChange={(e) => set('captionStyle', e.target.value as S['captionStyle'])}>
          <option value="karaoke">Word highlight</option><option value="bold">Bold</option><option value="clean">Clean</option>
        </select>
      </label>
    </div>
  );
}
