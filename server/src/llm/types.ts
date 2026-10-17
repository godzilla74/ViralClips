export interface LlmProvider {
  listModels(): Promise<string[]>;
  /** Optional richer listing (capabilities) used by the Settings picker. */
  describeModels?(): Promise<ModelInfo[]>;
  /** Returns the raw model text, expected to contain JSON. */
  completeJSON(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>;
}

export interface ModelInfo { name: string; reasoning: boolean; vision: boolean }
