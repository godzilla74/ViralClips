import type { Clip, Word } from '../api';
import { excerpt } from '../excerpt';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function ClipList(p: {
  clips: Clip[]; words: Word[]; activeId?: string; onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<Clip>) => void;
}) {
  return (
    <div className="clips">
      {p.clips.map((c) => {
        const ex = excerpt(p.words, c.start, c.end);
        return (
        <div key={c.id} className={`clip ${c.id === p.activeId ? 'active' : ''}`} onClick={() => p.onSelect(c.id)}>
          <input type="checkbox" checked={c.selected} title="Include in export"
            onClick={(e) => e.stopPropagation()} onChange={(e) => p.onChange(c.id, { selected: e.target.checked })} />
          <div className="clip-body">
            <input className="title" value={c.title} onClick={(e) => e.stopPropagation()}
              onChange={(e) => p.onChange(c.id, { title: e.target.value })} />
            <div className="muted small">{fmt(c.start)}–{fmt(c.end)} · {Math.round(c.end - c.start)}s</div>
            <div className="small why"><b>Why:</b> {c.reason}</div>
            {ex.head && (
              <div className="small said">
                <b>Says:</b> “{ex.head}{ex.truncated ? ' … ' : ''}{ex.tail}”
              </div>
            )}
          </div>
          <span className="score" style={{ ['--s' as string]: c.score }}>{Math.round(c.score)}</span>
        </div>
        );
      })}
    </div>
  );
}
