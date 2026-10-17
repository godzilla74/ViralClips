import { defineConfig } from 'vitest/config';

// Many tests shell out to ffmpeg; parallel files make them slow, so allow generous time.
export default defineConfig({ test: { testTimeout: 60_000 } });
