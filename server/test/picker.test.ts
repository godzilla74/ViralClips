import { describe, it, expect } from 'vitest';
import { pickVideoFile, pickFolder, PICK_SCRIPT, PICK_FOLDER_SCRIPT } from '../src/picker.js';
import { buildApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { makeVideo } from './helpers.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mac = process.platform === 'darwin';

describe('pickVideoFile (macOS)', () => {
  it('returns the chosen POSIX path, trimmed (spaces and unicode intact)', async () => {
    const run = async () => ({ stdout: '/Users/me/My Movies/café talk.mp4\n' });
    expect(await pickVideoFile(run, 'darwin')).toBe('/Users/me/My Movies/café talk.mp4');
  });
  it('returns null when the user cancels (osascript error -128)', async () => {
    const run = async () => { throw Object.assign(new Error('fail'), { stderr: 'execution error: User canceled. (-128)' }); };
    expect(await pickVideoFile(run, 'darwin')).toBeNull();
  });
  it('throws a readable error for other failures', async () => {
    const run = async () => { throw Object.assign(new Error('fail'), { stderr: 'boom' }); };
    await expect(pickVideoFile(run, 'darwin')).rejects.toThrow(/file chooser/i);
  });
  it.skipIf(!mac)('uses an AppleScript that compiles', () => {
    execFileSync('osacompile', ['-o', join(mkdtempSync(join(tmpdir(), 'vc-')), 'x.scpt'), '-e', PICK_SCRIPT]);
  });
});

describe('pickFolder', () => {
  it('returns the folder path without a trailing slash; null on cancel', async () => {
    expect(await pickFolder(async () => ({ stdout: '/Users/me/Movies/My Shorts/\n' }), 'darwin')).toBe('/Users/me/Movies/My Shorts');
    const cancel = async () => { throw Object.assign(new Error('x'), { stderr: 'User canceled. (-128)' }); };
    expect(await pickFolder(cancel, 'darwin')).toBeNull();
  });
  it.skipIf(!mac)('uses an AppleScript that compiles', () => {
    execFileSync('osacompile', ['-o', join(mkdtempSync(join(tmpdir(), 'vc-')), 'y.scpt'), '-e', PICK_FOLDER_SCRIPT]);
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
  it('POST /api/pick-folder returns the picked folder', async () => {
    const app = buildApp({ db: openDb(':memory:'), dataDir: makeVideo().dir, pickFolder: async () => '/Users/me/Shorts' });
    expect((await app.inject({ method: 'POST', url: '/api/pick-folder' })).json()).toEqual({ path: '/Users/me/Shorts' });
  });
});
