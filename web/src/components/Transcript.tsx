import type { Clip, Word } from '../api';

export function Transcript({ words, clip, onSeek }: { words: Word[]; clip?: Clip; onSeek: (t: number) => void }) {
  if (!clip) return null;
  const shown = words.filter((w) => w.end > clip.start - 20 && w.start < clip.end + 20);
  return (
    <div className="transcript">
      {shown.map((w, i) => (
        <span key={i} className={w.start >= clip.start - 0.05 && w.end <= clip.end + 0.05 ? 'in' : ''} onClick={() => onSeek(w.start)}>{w.text} </span>
      ))}
    </div>
  );
}
