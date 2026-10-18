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
  framing: 'crop' | 'blur' | 'original' | 'stack';
  captionStyle: 'bold' | 'clean' | 'karaoke';
  /** 'stack' framing: full-width face strip or a smaller centred face card. */
  faceStyle: 'card' | 'full';
  /** Which formats to export for every clip. */
  outputs: 'vertical' | 'wide' | 'both';
  /** Absolute folder for exported clips; '' = the app's own data/exports folder. */
  exportDir: string;
}
export type Project = {
  id: string; name: string; videoPath: string; duration: number;
  status: 'new' | 'transcribing' | 'analyzing' | 'ready' | 'error';
  error?: string;
};

/** Rectangle in normalized (0..1) source-frame coordinates. */
export interface Rect { x: number; y: number; w: number; h: number }
/** Where things are in a recording that has a screen share and a webcam. */
export interface Layout { screen: Rect | null; face: Rect | null; facePanel: Rect | null }
