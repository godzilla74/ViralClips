export interface LlmProvider {
  listModels(): Promise<string[]>;
  /** Returns the raw model text, expected to contain JSON. */
  completeJSON(prompt: string, opts?: { signal?: AbortSignal }): Promise<string>;
}
