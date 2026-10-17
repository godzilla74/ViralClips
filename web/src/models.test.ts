import { describe, it, expect } from 'vitest';
import { visionOptions } from './models';

const models = [
  { name: 'qwen2.5:14b', reasoning: false, vision: false },
  { name: 'gemma3:12b', reasoning: false, vision: true },
  { name: 'qwen3.5:9b', reasoning: true, vision: true },
];

describe('visionOptions', () => {
  it('Ollama: only vision-capable models, non-reasoning first', () => {
    expect(visionOptions(models, 'ollama').map((m) => m.name)).toEqual(['gemma3:12b', 'qwen3.5:9b']);
  });
  it('OpenAI: no capability info is available, so every model is offered', () => {
    expect(visionOptions(models, 'openai')).toHaveLength(3);
  });
  it('is empty when nothing qualifies', () => {
    expect(visionOptions([models[0]], 'ollama')).toEqual([]);
  });
});
