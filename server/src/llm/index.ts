import type { Settings } from '../types.js';
import { OllamaProvider } from './ollama.js';
import { OpenAIProvider } from './openai.js';
import type { LlmProvider } from './types.js';

export function makeProvider(s: Settings): LlmProvider {
  return s.provider === 'openai' ? new OpenAIProvider(s.openaiModel, s.openaiKey) : new OllamaProvider(s.ollamaModel);
}
