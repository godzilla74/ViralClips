import { describe, it, expect } from 'vitest';
import { extractJson, completeParsed } from '../src/llm/json.js';
import { OllamaProvider } from '../src/llm/ollama.js';
import type { LlmProvider } from '../src/llm/types.js';

describe('extractJson', () => {
  it('handles fences, prose, think blocks and braces inside strings', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here: {"a":{"b":"x}y"}} thanks')).toEqual({ a: { b: 'x}y' } });
    expect(extractJson('<think>{"no":1}</think>\n[1,2]')).toEqual([1, 2]);
  });
  it('throws on garbage', () => {
    expect(() => extractJson('no json here')).toThrow(/invalid JSON/);
  });
});

describe('completeParsed', () => {
  const fake = (replies: string[]): LlmProvider & { calls: number } => ({
    calls: 0,
    listModels: async () => [],
    async completeJSON() { return replies[this.calls++] ?? 'bad'; },
  });
  const validate = (x: unknown) => {
    if (!x || typeof x !== 'object' || !('ok' in x)) throw new Error('shape');
    return x as { ok: boolean };
  };
  it('retries garbage then succeeds (3 calls)', async () => {
    const p = fake(['garbage', '{"nope":1}', '{"ok":true}']);
    expect(await completeParsed(p, 'q', validate)).toEqual({ ok: true });
    expect(p.calls).toBe(3);
  });
  it('throws after retries are exhausted', async () => {
    const p = fake([]);
    await expect(completeParsed(p, 'q', validate)).rejects.toThrow();
    expect(p.calls).toBe(3);
  });
});

describe('OllamaProvider', () => {
  it('lists models via /api/tags and sends json format chat', async () => {
    const seen: any[] = [];
    const f = (async (url: string, init?: any) => {
      seen.push([url, init?.body && JSON.parse(init.body)]);
      if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'a:1' }, { name: 'b:2' }] }));
      return new Response(JSON.stringify({ message: { content: '{"ok":1}' } }));
    }) as unknown as typeof fetch;
    const p = new OllamaProvider('a:1', f);
    expect(await p.listModels()).toEqual(['a:1', 'b:2']);
    expect(await p.completeJSON('hi')).toBe('{"ok":1}');
    expect(seen[1][1]).toMatchObject({ model: 'a:1', format: 'json', stream: false, think: false });
  });
  it('explains empty answers from reasoning models instead of returning ""', async () => {
    const f = (async () => new Response(JSON.stringify({ message: { content: '', thinking: 'hmm let me think…' } }))) as unknown as typeof fetch;
    await expect(new OllamaProvider('qwen3-vl:8b', f).completeJSON('hi')).rejects.toThrow(/qwen3-vl:8b is a reasoning model.*non-reasoning model/s);
  });
  it('describes models with reasoning/vision capabilities from /api/show', async () => {
    const caps: Record<string, string[]> = { 'a:1': ['completion', 'tools'], 'b:2': ['completion', 'vision', 'thinking'] };
    const f = (async (url: string, init?: any) => {
      if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'a:1' }, { name: 'b:2' }] }));
      return new Response(JSON.stringify({ capabilities: caps[JSON.parse(init.body).model] }));
    }) as unknown as typeof fetch;
    expect(await new OllamaProvider('a:1', f).describeModels()).toEqual([
      { name: 'a:1', reasoning: false, vision: false },
      { name: 'b:2', reasoning: true, vision: true },
    ]);
  });
});
