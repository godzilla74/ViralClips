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
  it('persists with mode 0600 and hides the key publicly', () => {
    const d = tmp();
    saveSettings({ openaiKey: 'sk-secret', clipCount: 3 }, d);
    expect(loadSettings(d).clipCount).toBe(3);
    expect(statSync(join(d, 'config.json')).mode & 0o777).toBe(0o600);
    const p = publicSettings(loadSettings(d)) as Record<string, unknown>;
    expect(p.hasKey).toBe(true);
    expect('openaiKey' in p).toBe(false);
  });
});
