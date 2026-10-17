import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDeps, findBinary, whisperBinary, installHint } from '../src/deps.js';

describe('checkDeps', () => {
  it('reports a missing binary with a hint', async () => {
    const r = await checkDeps({ ffmpeg: 'definitely-not-a-binary-xyz' });
    const f = r.find((d) => d.name === 'ffmpeg')!;
    expect(f.ok).toBe(false);
    expect(f.hint.length).toBeGreaterThan(0);
  });
});

describe('whisperBinary', () => {
  const dirWith = (rel: string) => {
    const d = mkdtempSync(join(tmpdir(), 'vc-bin-'));
    mkdirSync(join(d, 'bin', ...rel.split('/').slice(0, -1)), { recursive: true });
    writeFileSync(join(d, 'bin', rel), '');
    return d;
  };
  it('falls back to the bare name on PATH', () => {
    expect(whisperBinary({ dataDir: mkdtempSync(join(tmpdir(), 'vc-')), env: {}, platform: 'linux' })).toBe('whisper-cli');
    expect(whisperBinary({ dataDir: mkdtempSync(join(tmpdir(), 'vc-')), env: {}, platform: 'win32' })).toBe('whisper-cli.exe');
  });
  it('prefers a binary installed by setup into data/bin (even nested)', () => {
    const d = dirWith('Release/whisper-cli.exe');
    expect(whisperBinary({ dataDir: d, env: {}, platform: 'win32' })).toBe(join(d, 'bin', 'Release', 'whisper-cli.exe'));
    const l = dirWith('whisper-cli');
    expect(whisperBinary({ dataDir: l, env: {}, platform: 'linux' })).toBe(join(l, 'bin', 'whisper-cli'));
  });
  it('VC_WHISPER wins when the file exists, and is ignored when it does not', () => {
    const d = dirWith('whisper-cli');
    const custom = join(d, 'bin', 'whisper-cli');
    expect(whisperBinary({ dataDir: d, env: { VC_WHISPER: custom }, platform: 'linux' })).toBe(custom);
    expect(whisperBinary({ dataDir: mkdtempSync(join(tmpdir(), 'vc-')), env: { VC_WHISPER: '/nope/whisper' }, platform: 'linux' })).toBe('whisper-cli');
  });
  it('findBinary respects max depth', () => {
    const d = dirWith('a/b/c/d/whisper-cli');
    expect(findBinary(join(d, 'bin'), 'whisper-cli', 2)).toBeNull();
    expect(findBinary(join(d, 'bin'), 'whisper-cli', 5)).not.toBeNull();
  });
});

describe('installHint', () => {
  it('gives an OS-appropriate command, always mentioning npm run setup', () => {
    expect(installHint('ffmpeg', 'darwin')).toMatch(/brew install ffmpeg/);
    expect(installHint('ffmpeg', 'win32')).toMatch(/winget install/);
    expect(installHint('ffmpeg', 'linux')).toMatch(/apt|dnf|pacman/);
    expect(installHint('whisper', 'win32')).toMatch(/npm run setup/);
    expect(installHint('ollama', 'linux')).toMatch(/ollama\.com/);
  });
});
