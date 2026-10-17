import { describe, it, expect } from 'vitest';
import { checkDeps } from '../src/deps.js';

describe('checkDeps', () => {
  it('reports a missing binary with a hint', async () => {
    const r = await checkDeps({ ffmpeg: 'definitely-not-a-binary-xyz' });
    const f = r.find((d) => d.name === 'ffmpeg')!;
    expect(f.ok).toBe(false);
    expect(f.hint.length).toBeGreaterThan(0);
  });
});
