// Copies MediaPipe's WASM runtime from node_modules into public/ so the face detector works offline.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const candidates = [`${root}node_modules/@mediapipe/tasks-vision/wasm`, `${root}../node_modules/@mediapipe/tasks-vision/wasm`];
const src = candidates.find(existsSync);
if (!src) { console.error('copy-mediapipe: @mediapipe/tasks-vision not installed — run `npm install`'); process.exit(1); }
mkdirSync(`${root}public/mediapipe`, { recursive: true });
cpSync(src, `${root}public/mediapipe`, { recursive: true });
