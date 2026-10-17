import { buildApp } from './app.js';

const app = buildApp();
await app.listen({ host: '127.0.0.1', port: 4777 });
console.log('ViralClips server on http://127.0.0.1:4777');
