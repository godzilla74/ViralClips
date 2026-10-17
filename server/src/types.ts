export interface Word { text: string; start: number; end: number }
export interface Transcript { language: string; duration: number; words: Word[] }
export interface Clip {
  id: string; projectId: string; start: number; end: number;
  title: string; score: number; reason: string; selected: boolean;
}
export interface Settings {
  provider: 'ollama' | 'openai';
  ollamaModel: string;
  openaiModel: string;
  /** Vision-capable model for layout detection ('' = not set). Uses the selected provider. */
  visionModel: string;
  openaiKey?: string;
  clipMinSec: number;
  clipMaxSec: number;
  clipCount: number;
  captions: boolean;
  framing: 'crop' | 'blur' | 'original';
  captionStyle: 'bold' | 'clean' | 'karaoke';
  /** Absolute folder for exported clips; '' = the app's own data/exports folder. */
  exportDir: string;
}
export type Project = {
  id: string; name: string; videoPath: string; duration: number;
  status: 'new' | 'transcribing' | 'analyzing' | 'ready' | 'error';
  error?: string;
};
