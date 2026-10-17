import { useState } from 'react';
import { pickFolder } from '../api';

/** "Save exports to" control: native macOS folder chooser, empty = the app's own folder. */
export function ExportFolder({ value, onChange }: { value: string; onChange: (dir: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const choose = async () => {
    setErr(''); setBusy(true);
    try {
      const { path } = await pickFolder();
      if (path) onChange(path);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className="folder">
      <div className="muted small">Save exports to</div>
      <div className="row folder-row">
        <code title={value || 'App folder'}>{value || 'App folder (ViralClips/data/exports)'}</code>
        <button className="ghost" disabled={busy} onClick={choose}>{busy ? 'Choose in the dialog window…' : '📁 Change…'}</button>
        {value && <button className="ghost" onClick={() => onChange('')}>Use default</button>}
      </div>
      {err && <div className="banner err">{err}</div>}
    </div>
  );
}
