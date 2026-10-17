import { forwardRef, useEffect } from 'react';
import type { Clip } from '../api';

/** Video that previews only the active clip's range, looping it. */
export const Player = forwardRef<HTMLVideoElement, { src: string; clip?: Clip }>(({ src, clip }, ref) => {
  useEffect(() => {
    const v = (ref as React.RefObject<HTMLVideoElement>)?.current;
    if (v && clip) v.currentTime = clip.start;
  }, [clip?.id]);
  return (
    <video
      ref={ref} src={src} controls preload="metadata" className="player"
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (clip && (v.currentTime >= clip.end || v.currentTime < clip.start - 0.5)) {
          v.currentTime = clip.start;
        }
      }}
    />
  );
});
