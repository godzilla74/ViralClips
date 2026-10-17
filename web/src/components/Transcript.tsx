import { useEffect, useRef } from 'react';
import type { Clip, Word } from '../api';

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function Transcript({ words, clip, onSeek }: { words: Word[]; clip?: Clip; onSeek: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const b = box.current, f = first.current;
    if (b && f) b.scrollTop = f.offsetTop - b.offsetTop - 40; // bring the clip start into view
  }, [clip?.id, clip?.start]);
  if (!clip) return null;
  const inClip = (w: Word) => w.start >= clip.start - 0.05 && w.end <= clip.end + 0.05;
  const shown = words.filter((w) => w.end > clip.start - 20 && w.start < clip.end + 20);
  const firstIdx = shown.findIndex(inClip);
  const lastIdx = shown.length - 1 - [...shown].reverse().findIndex(inClip);
  return (
    <div className="transcript" ref={box}>
      {shown.map((w, i) => (
        <span key={i}>
          {i === firstIdx && <span className="marker start" ref={first}>▶ clip starts {fmt(clip.start)}</span>}
          <span className={inClip(w) ? 'in' : ''} onClick={() => onSeek(w.start)}>{w.text} </span>
          {i === lastIdx && <span className="marker end">■ clip ends {fmt(clip.end)}</span>}
        </span>
      ))}
    </div>
  );
}
