import { describe, it, expect } from 'vitest';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nodeVersionOk, installPlan, pickWhisperWindowsAsset, recommendOllamaModel, hasUsableModel, downloadFile, WHISPER_MODEL,
} from '../../scripts/setup-lib.mjs';

const have = (...names: string[]) => Object.fromEntries(names.map((n) => [n, true]));

describe('nodeVersionOk', () => {
  it('requires Node 22+', () => {
    expect(nodeVersionOk('v22.1.0')).toBe(true);
    expect(nodeVersionOk('v24.0.0')).toBe(true);
    expect(nodeVersionOk('v20.11.1')).toBe(false);
    expect(nodeVersionOk('garbage')).toBe(false);
  });
});

describe('installPlan', () => {
  it('macOS uses Homebrew, else explains how to get it', () => {
    expect(installPlan('ffmpeg', { platform: 'darwin', arch: 'arm64', have: have('brew') })).toMatchObject({ kind: 'command', cmd: 'brew', args: ['install', 'ffmpeg'] });
    expect(installPlan('whisper', { platform: 'darwin', arch: 'arm64', have: have('brew') })).toMatchObject({ kind: 'command', args: ['install', 'whisper-cpp'] });
    expect(installPlan('ffmpeg', { platform: 'darwin', arch: 'arm64', have: {} })).toMatchObject({ kind: 'manual' });
  });
  it('Windows: winget for ffmpeg, release download for whisper', () => {
    const p = installPlan('ffmpeg', { platform: 'win32', arch: 'x64', have: have('winget') });
    expect(p).toMatchObject({ kind: 'command', cmd: 'winget' });
    expect((p as any).args).toContain('Gyan.FFmpeg');
    expect(installPlan('whisper', { platform: 'win32', arch: 'x64', have: {} })).toEqual({ kind: 'download-whisper' });
    expect(installPlan('ffmpeg', { platform: 'win32', arch: 'x64', have: {} })).toMatchObject({ kind: 'manual' });
  });
  it('Linux: distro package manager with sudo; whisper via brew, else source build, else manual', () => {
    expect(installPlan('ffmpeg', { platform: 'linux', arch: 'x64', have: have('apt-get') })).toMatchObject({ cmd: 'sudo', args: ['apt-get', 'install', '-y', 'ffmpeg'] });
    expect(installPlan('ffmpeg', { platform: 'linux', arch: 'x64', have: have('dnf') })).toMatchObject({ cmd: 'sudo', args: expect.arrayContaining(['dnf', 'ffmpeg']) });
    expect(installPlan('ffmpeg', { platform: 'linux', arch: 'x64', have: have('pacman') })).toMatchObject({ cmd: 'sudo', args: expect.arrayContaining(['pacman', 'ffmpeg']) });
    expect(installPlan('ffmpeg', { platform: 'linux', arch: 'x64', have: {} })).toMatchObject({ kind: 'manual' });
    expect(installPlan('whisper', { platform: 'linux', arch: 'x64', have: have('brew') })).toMatchObject({ kind: 'command', cmd: 'brew' });
    expect(installPlan('whisper', { platform: 'linux', arch: 'x64', have: have('git', 'cmake', 'g++') })).toEqual({ kind: 'build-whisper' });
    expect(installPlan('whisper', { platform: 'linux', arch: 'x64', have: have('git') })).toMatchObject({ kind: 'manual' });
  });
  it('ollama: brew cask on macOS, winget on Windows, never curl|sh on Linux', () => {
    expect(installPlan('ollama', { platform: 'darwin', arch: 'arm64', have: have('brew') })).toMatchObject({ cmd: 'brew', args: ['install', '--cask', 'ollama'] });
    expect(installPlan('ollama', { platform: 'win32', arch: 'x64', have: have('winget') })).toMatchObject({ cmd: 'winget' });
    const l = installPlan('ollama', { platform: 'linux', arch: 'x64', have: have('apt-get') });
    expect(l).toMatchObject({ kind: 'manual' });
    expect((l as any).text).toContain('ollama.com');
  });
});

describe('pickWhisperWindowsAsset', () => {
  const release = { assets: [
    { name: 'whisper-bin-Win32.zip', browser_download_url: 'https://x/win32.zip' },
    { name: 'whisper-bin-x64.zip', browser_download_url: 'https://x/x64.zip' },
    { name: 'whisper-cublas-12.4.0-bin-x64.zip', browser_download_url: 'https://x/cublas.zip' },
    { name: 'whisper-blas-bin-x64.zip', browser_download_url: 'https://x/blas.zip' },
  ] };
  it('picks the plain CPU build for the architecture', () => {
    expect(pickWhisperWindowsAsset(release, 'x64')).toEqual({ name: 'whisper-bin-x64.zip', url: 'https://x/x64.zip' });
    expect(pickWhisperWindowsAsset(release, 'arm64')?.name).toBe('whisper-bin-x64.zip'); // runs under emulation
    expect(pickWhisperWindowsAsset(release, 'ia32')?.name).toBe('whisper-bin-Win32.zip');
  });
  it('returns null when the release has no matching asset', () => {
    expect(pickWhisperWindowsAsset({ assets: [] }, 'x64')).toBeNull();
    expect(pickWhisperWindowsAsset({}, 'x64')).toBeNull();
  });
});

describe('Ollama model recommendation', () => {
  const GB = 1024 ** 3;
  it('sizes the model to RAM', () => {
    expect(recommendOllamaModel(16 * GB).name).toBe('qwen2.5:14b');
    expect(recommendOllamaModel(32 * GB).name).toBe('qwen2.5:14b');
    expect(recommendOllamaModel(8 * GB).name).toBe('llama3.1:8b');
    expect(recommendOllamaModel(4 * GB).name).toBe('llama3.2:3b');
  });
  it('recognises already-installed plain text models, rejects reasoning/vision/coder ones', () => {
    expect(hasUsableModel(['qwen2.5:14b'])).toBe(true);
    expect(hasUsableModel(['gemma3:12b', 'foo'])).toBe(true);
    expect(hasUsableModel(['qwen3-vl:8b', 'qwen3.5:9b', 'qwen2.5-coder:7b', 'gemma4:e4b'])).toBe(false);
    expect(hasUsableModel([])).toBe(false);
  });
});

describe('downloadFile', () => {
  it('streams to a .part file then renames, reporting progress', async () => {
    const body = Buffer.alloc(300_000, 7);
    const srv = createServer((_q, r) => { r.writeHead(200, { 'content-length': body.length }); r.end(body); });
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const port = (srv.address() as any).port;
    const dest = join(mkdtempSync(join(tmpdir(), 'vc-dl-')), 'sub dir', 'f.bin');
    const seen: number[] = [];
    await downloadFile(`http://127.0.0.1:${port}/f`, dest, (pct: number) => seen.push(pct));
    srv.close();
    expect(readFileSync(dest).length).toBe(300_000);
    expect(existsSync(dest + '.part')).toBe(false);
    expect(seen.at(-1)).toBe(100);
  });
  it('fails on HTTP errors without leaving files behind', async () => {
    const srv = createServer((_q, r) => { r.writeHead(404); r.end('no'); });
    await new Promise<void>((res) => srv.listen(0, '127.0.0.1', res));
    const port = (srv.address() as any).port;
    const dest = join(mkdtempSync(join(tmpdir(), 'vc-dl-')), 'f.bin');
    await expect(downloadFile(`http://127.0.0.1:${port}/f`, dest, () => {})).rejects.toThrow(/404/);
    srv.close();
    expect(existsSync(dest) || existsSync(dest + '.part')).toBe(false);
  });
  it('knows the whisper model it needs', () => {
    expect(WHISPER_MODEL.name).toBe('ggml-small.en.bin');
    expect(WHISPER_MODEL.url).toContain('huggingface.co/ggerganov/whisper.cpp');
    expect(WHISPER_MODEL.minBytes).toBeGreaterThan(400_000_000);
  });
});
