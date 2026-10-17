import type { LlmProvider } from './types.js';

const BASE = 'http://127.0.0.1:11434';

export class OllamaProvider implements LlmProvider {
  constructor(private model: string, private fetchFn: typeof fetch = fetch) {}

  async listModels() {
    const r = await this.fetchFn(`${BASE}/api/tags`).catch(() => {
      throw new Error('Cannot reach Ollama at 127.0.0.1:11434 — start it with `ollama serve`');
    });
    const j = (await r.json()) as { models: { name: string }[] };
    return j.models.map((m) => m.name);
  }

  async completeJSON(prompt: string, opts?: { signal?: AbortSignal }) {
    const r = await this.fetchFn(`${BASE}/api/chat`, {
      method: 'POST',
      signal: opts?.signal,
      body: JSON.stringify({
        model: this.model, stream: false, format: 'json', think: false,
        options: { temperature: 0.3, num_ctx: 16384 },
        messages: [{ role: 'user', content: prompt }],
      }),
    }).catch(() => {
      throw new Error('Cannot reach Ollama at 127.0.0.1:11434 — start it with `ollama serve`');
    });
    if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { message?: { content?: string } };
    return j.message?.content ?? '';
  }
}
