export interface Project { id: string; name: string; duration: number; status: 'new' | 'transcribing' | 'analyzing' | 'ready' | 'error'; error?: string }
export interface Clip { id: string; projectId: string; start: number; end: number; title: string; score: number; reason: string; selected: boolean }
export interface Word { text: string; start: number; end: number }
export interface Transcript { language: string; duration: number; words: Word[] }
export interface Settings {
  provider: 'ollama' | 'openai'; ollamaModel: string; openaiModel: string; openaiKey?: string; hasKey?: boolean;
  clipMinSec: number; clipMaxSec: number; clipCount: number; captions: boolean;
  framing: 'crop' | 'blur' | 'original'; captionStyle: 'bold' | 'clean' | 'karaoke';
}
export interface Dep { name: string; ok: boolean; hint: string }
export interface JobEvent { stage: 'transcribe' | 'analyze' | 'export'; pct: number; message?: string; done?: boolean; error?: string; connected?: boolean; running?: boolean }

async function j<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as any).error ?? `Request failed (${res.status})`);
  return body as T;
}
const post = (url: string, body?: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

export const getSetup = () => fetch('/api/setup').then(j<Dep[]>);
export const getSettings = () => fetch('/api/settings').then(j<Settings>);
export function putSettings(s: Partial<Settings>) {
  const body = { ...s };
  if (!body.openaiKey) delete body.openaiKey;
  return fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j<Settings>);
}
export interface ModelInfo { name: string; reasoning: boolean; vision: boolean }
export const listModels = () => fetch('/api/llm/models').then(j<ModelInfo[]>);
export const listProjects = () => fetch('/api/projects').then(j<Project[]>);
export const getProject = (id: string) => fetch(`/api/projects/${id}`).then(j<Project>);
export const deleteProject = (id: string) => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then(j);
export const createProjectFromPath = (path: string) => post('/api/projects', { path }).then(j<Project>);
export function createProjectFromFile(file: File) {
  const fd = new FormData();
  fd.append('file', file);
  return fetch('/api/projects', { method: 'POST', body: fd }).then(j<Project>);
}
export const analyze = (id: string) => post(`/api/projects/${id}/analyze`).then(j);
export const getClips = (id: string) => fetch(`/api/projects/${id}/clips`).then(j<Clip[]>);
export const getTranscript = (id: string) => fetch(`/api/projects/${id}/transcript`).then(j<Transcript>);
export const patchClip = (id: string, p: Partial<Pick<Clip, 'start' | 'end' | 'title' | 'selected'>>) =>
  fetch(`/api/clips/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) }).then(j<Clip>);
export const exportClips = (id: string, settings: Partial<Settings>) => post(`/api/projects/${id}/export`, { settings }).then(j);
export const listExports = (id: string) => fetch(`/api/projects/${id}/exports`).then(j<{ file: string; size: number; url: string }[]>);

export function subscribeEvents(id: string, cb: (e: JobEvent) => void) {
  const es = new EventSource(`/api/projects/${id}/events`);
  es.onmessage = (m) => cb(JSON.parse(m.data));
  return () => es.close();
}
