import { describe, it, expect } from 'vitest';
import { pickVideoFile, PICK_SCRIPT } from '../src/picker.js';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { makeVideo } from './helpers.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('pickVideoFile', () => {
  it('returns the chosen POSIX path, trimmed (spaces and unicode intact)', async () => {
    const run = async () => ({ stdout: '/Users/me/My Movies/café talk.mp4\n' });
    expect(await pickVideoFile(run)).toBe('/Users/me/My Movies/café talk.mp4');
  });
  it('returns null when the user cancels (osascript error -128)', async () => {
    const run = async () => { throw Object.assign(new Error('fail'), { stderr: 'execution error: User canceled. (-128)' }); };
    expect(await pickVideoFile(run)).toBeNull();
  });
  it('throws a readable error for other failures', async () => {
    const run = async () => { throw Object.assign(new Error('fail'), { stderr: 'boom' }); };
    await expect(pickVideoFile(run)).rejects.toThrow(/file chooser/i);
  });
  it('uses an AppleScript that compiles', () => {
    execFileSync('osacompile', ['-o', join(mkdtempSync(join(tmpdir(), 'vc-')), 'x.scpt'), '-e', PICK_SCRIPT]);
  });
});

describe('POST /api/pick-file', () => {
  it('returns the picked path, or null on cancel', async () => {
    const v = makeVideo();
    let answer: string | null = '/a/b.mp4';
    const app = buildApp({ db: openDb(':memory:'), dataDir: v.dir, pickFile: async () => answer });
    expect((await app.inject({ method: 'POST', url: '/api/pick-file' })).json()).toEqual({ path: '/a/b.mp4' });
    answer = null;
    expect((await app.inject({ method: 'POST', url: '/api/pick-file' })).json()).toEqual({ path: null });
  });
  it('is refused for cross-site requests', async () => {
    const app = buildApp({ db: openDb(':memory:'), dataDir: makeVideo().dir, pickFile: async () => '/x' });
    const r = await app.inject({ method: 'POST', url: '/api/pick-file', headers: { origin: 'https://evil.example' } });
    expect(r.statusCode).toBe(403);
  });
});
