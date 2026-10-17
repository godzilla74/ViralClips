export const WHISPER_MODEL: { name: string; url: string; minBytes: number };
export function nodeVersionOk(version: string, min?: number): boolean;
export type Tool = 'ffmpeg' | 'whisper' | 'ollama';
export interface Ctx { platform: string; arch: string; have: Record<string, boolean> }
export type Plan =
  | { kind: 'command'; label: string; cmd: string; args: string[]; sudo?: boolean; note?: string }
  | { kind: 'download-whisper' }
  | { kind: 'build-whisper' }
  | { kind: 'manual'; text: string };
export function installPlan(tool: Tool, ctx: Ctx): Plan;
export function pickWhisperWindowsAsset(release: unknown, arch: string): { name: string; url: string } | null;
export function recommendOllamaModel(totalMemBytes: number): { name: string; size: string };
export function hasUsableModel(installed: string[]): boolean;
export function findBinary(dir: string, name: string, depth?: number): string | null;
export function downloadFile(url: string, dest: string, onProgress: (pct: number) => void, fetchFn?: typeof fetch): Promise<void>;
