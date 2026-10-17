import type { ModelInfo } from './api';

/** Models to offer in the "Vision model" picker. Plain (non-reasoning) models come first. */
export function visionOptions(models: ModelInfo[], provider: 'ollama' | 'openai'): ModelInfo[] {
  // OpenAI's model list carries no capability info, so offer everything; Ollama reports `vision` per model.
  const list = provider === 'openai' ? models : models.filter((m) => m.vision);
  return [...list].sort((a, b) => Number(a.reasoning) - Number(b.reasoning));
}
