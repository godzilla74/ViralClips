import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, saveSettings, publicSettings } from '../src/config.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'vc-'));

describe('settings', () => {
  it('defaults match the spec', () => {
    const s = loadSettings(tmp());
    expect(s.provider).toBe('ollama');
    expect([s.clipMinSec, s.clipMaxSec, s.clipCount]).toEqual([30, 60, 10]);
    expect(s.captions).toBe(true);
    expect(s.framing).toBe('crop');
  });
  it('persists with mode 0600 (POSIX) and hides the key publicly', () => {
    const d = tmp();
    saveSettings({ openaiKey: 'sk-secret', clipCount: 3 }, d);
    expect(loadSettings(d).clipCount).toBe(3);
    if (process.platform !== 'win32') expect(statSync(join(d, 'config.json')).mode & 0o777).toBe(0o600); // Windows has no POSIX modes
    const p = publicSettings(loadSettings(d)) as Record<string, unknown>;
    expect(p.hasKey).toBe(true);
    expect('openaiKey' in p).toBe(false);
  });
  it('sanitizes invalid values and unknown fields', () => {
    const d = tmp();
    const s = saveSettings({ framing: 'zzz', clipCount: 'abc', clipMinSec: 60, clipMaxSec: 45, evil: 1 } as any, d);
    expect(s.framing).toBe('crop');
    expect(s.clipCount).toBe(10);
    expect(s.clipMaxSec).toBeGreaterThanOrEqual(s.clipMinSec);
    expect('evil' in s).toBe(false);
    expect(saveSettings({ clipCount: 0 } as any, d).clipCount).toBeGreaterThanOrEqual(1);
  });
  it('accepts an absolute export folder (or empty = default) and rejects relative paths', () => {
    const d = tmp();
    expect(saveSettings({ exportDir: '/Users/me/Movies/Shorts' }, d).exportDir).toBe('/Users/me/Movies/Shorts');
    expect(saveSettings({ exportDir: 'relative/path' }, d).exportDir).toBe('/Users/me/Movies/Shorts'); // rejected, previous kept
    expect(saveSettings({ exportDir: '' }, d).exportDir).toBe('');
    expect(loadSettings(tmp()).exportDir).toBe('');
  });
  it('stores a vision model (default none) and exposes it publicly', () => {
    const d = tmp();
    expect(loadSettings(d).visionModel).toBe('');
    saveSettings({ visionModel: '  gemma3:12b ' }, d);
    expect(loadSettings(d).visionModel).toBe('gemma3:12b');
    expect((publicSettings(loadSettings(d)) as Record<string, unknown>).visionModel).toBe('gemma3:12b');
    expect(saveSettings({ visionModel: 42 } as any, d).visionModel).toBe('gemma3:12b'); // invalid ignored
    expect(saveSettings({ visionModel: '' }, d).visionModel).toBe(''); // can be cleared
  });
});
