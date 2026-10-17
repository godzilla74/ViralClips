import { describe, it, expect, vi } from 'vitest';
import { putSettings } from './api';
import { clampTrim } from './trim';

describe('putSettings', () => {
  it('omits openaiKey unless the user typed one', async () => {
    const f = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', f);
    await putSettings({ clipCount: 5, openaiKey: '' });
    expect(JSON.parse((f.mock.calls[0] as any)[1].body)).toEqual({ clipCount: 5 });
    await putSettings({ openaiKey: 'sk-x' });
    expect(JSON.parse((f.mock.calls[1] as any)[1].body)).toEqual({ openaiKey: 'sk-x' });
  });
});

describe('clampTrim', () => {
  it('keeps within [0,duration] and enforces min length', () => {
    expect(clampTrim(-5, 30, 100)).toEqual({ start: 0, end: 30 });
    expect(clampTrim(10, 200, 100)).toEqual({ start: 10, end: 100 });
    expect(clampTrim(10, 12, 100)).toEqual({ start: 10, end: 15 });
    expect(clampTrim(98, 99, 100)).toEqual({ start: 95, end: 100 });
  });
  it('leaves valid ranges alone and fixes inverted input', () => {
    expect(clampTrim(10, 40, 100)).toEqual({ start: 10, end: 40 });
    expect(clampTrim(50, 20, 100)).toEqual({ start: 50, end: 55 });
  });
});
