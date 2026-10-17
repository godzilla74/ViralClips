import type { LlmProvider } from './types.js';

export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/gi, '');
  for (let i = 0; i < cleaned.length; i++) {
    const open = cleaned[i];
    if (open !== '{' && open !== '[') continue;
    const close = open === '{' ? '}' : ']';
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < cleaned.length; j++) {
      const ch = cleaned[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === open) depth++;
      else if (ch === close && --depth === 0) {
        try { return JSON.parse(cleaned.slice(i, j + 1)) as T; } catch { break; }
      }
    }
  }
  throw new Error('invalid JSON');
}

export async function completeParsed<T>(
  p: LlmProvider, prompt: string, validate: (x: unknown) => T, retries = 2,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return validate(extractJson(await p.completeJSON(prompt)));
    } catch (e) {
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('LLM failed');
}
