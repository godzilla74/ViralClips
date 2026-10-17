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
  openaiKey?: string;
  clipMinSec: number;
  clipMaxSec: number;
  clipCount: number;
  captions: boolean;
  framing: 'crop' | 'blur' | 'original';
  captionStyle: 'bold' | 'clean' | 'karaoke';
}
export type Project = {
  id: string; name: string; videoPath: string; duration: number;
  status: 'new' | 'transcribing' | 'analyzing' | 'ready' | 'error';
  error?: string;
};
