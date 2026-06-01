/**
 * Provider interface — memhook abstracts the LLM call behind a common shape.
 *
 * V0.1 ships only AnthropicProvider. OpenAI, Mistral, Ollama, Bedrock, Vertex
 * are documented stubs to be implemented as the adapter pattern proves.
 */

export interface ProviderConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
  betaHeaders?: string[];
}

export interface SelectionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  cacheControlTtl?: "5m" | "1h";
  timeoutMs: number;
}

export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreateTokens: number;
  cacheReadTokens: number;
}

export interface SelectionResponse {
  rawText: string;
  usage: UsageBreakdown;
  latencyMs: number;
  httpStatus: number;
}

export interface Provider {
  readonly name: string;
  select(req: SelectionRequest): Promise<SelectionResponse>;
}
