import type { LlmProvider } from './types.js';

const BASE = 'https://api.openai.com/v1';

export class OpenAIProvider implements LlmProvider {
  constructor(private model: string, private key: string | undefined, private fetchFn: typeof fetch = fetch) {}

  private headers() {
    if (!this.key) throw new Error('OpenAI API key not set — add it in Settings');
    return { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' };
  }

  async listModels() {
    const r = await this.fetchFn(`${BASE}/models`, { headers: this.headers() });
    if (!r.ok) throw new Error(`OpenAI error ${r.status}`);
    const j = (await r.json()) as { data: { id: string }[] };
    return j.data.map((m) => m.id).filter((id) => /^(gpt|o\d)/.test(id)).sort();
  }

  async completeJSON(prompt: string, opts?: { signal?: AbortSignal }) {
    const r = await this.fetchFn(`${BASE}/chat/completions`, {
      method: 'POST', headers: this.headers(), signal: opts?.signal,
      body: JSON.stringify({
        model: this.model, response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { choices: { message: { content: string } }[] };
    return j.choices[0]?.message?.content ?? '';
  }
}
