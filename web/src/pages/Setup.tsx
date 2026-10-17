import type { Dep } from '../api';

export function Setup({ deps }: { deps: Dep[] }) {
  return (
    <>
      <h1>Setup checklist</h1>
      <p className="muted">ViralClips uses a few local tools. Anything unchecked below needs installing once.</p>
      {deps.map((d) => (
        <div key={d.name} className={`dep ${d.ok ? 'ok' : 'bad'}`}>
          <span>{d.ok ? '✓' : '✗'} <b>{d.name}</b></span>
          {!d.ok && (
            <div className="cmd">
              <code>{d.hint}</code>
              <button className="ghost" onClick={() => navigator.clipboard?.writeText(d.hint)}>Copy</button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}
