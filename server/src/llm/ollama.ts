import type { LlmProvider, ModelInfo } from './types.js';

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

  async describeModels(): Promise<ModelInfo[]> {
    const names = await this.listModels();
    return Promise.all(names.map(async (name) => {
      try {
        const r = await this.fetchFn(`${BASE}/api/show`, { method: 'POST', body: JSON.stringify({ model: name }) });
        const caps = ((await r.json()) as { capabilities?: string[] }).capabilities ?? [];
        return { name, reasoning: caps.includes('thinking'), vision: caps.includes('vision') };
      } catch {
        return { name, reasoning: false, vision: false };
      }
    }));
  }

  async completeJSON(prompt: string, opts?: { signal?: AbortSignal }) {
    const r = await this.fetchFn(`${BASE}/api/chat`, {
      method: 'POST',
      signal: AbortSignal.any([AbortSignal.timeout(240_000), ...(opts?.signal ? [opts.signal] : [])]),
      body: JSON.stringify({
        model: this.model, stream: false, format: 'json', think: false,
        options: { temperature: 0.3, num_ctx: 16384 },
        messages: [{ role: 'user', content: prompt }],
      }),
    }).catch((e) => {
      if (e?.name === 'TimeoutError') throw new Error(`Ollama took over 4 minutes to answer with ${this.model} — try a smaller or non-reasoning model`);
      throw new Error('Cannot reach Ollama at 127.0.0.1:11434 — start it with `ollama serve`');
    });
    if (!r.ok) throw new Error(`Ollama error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { message?: { content?: string; thinking?: string } };
    const content = j.message?.content ?? '';
    if (!content.trim()) {
      throw new Error(j.message?.thinking
        ? `${this.model} is a reasoning model and returned no answer (it spent its output on hidden thinking). Pick a non-reasoning model such as qwen2.5:14b or llama3.1:8b in Settings.`
        : `${this.model} returned an empty answer`);
    }
    return content;
  }
}
