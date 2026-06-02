/**
 * Provider interface — memhook abstracts the LLM call behind a common shape.
 *
 * The contract is deliberately provider-agnostic: a provider takes a
 * `SelectionRequest` (system prompt + user prompt + caps) and returns a
 * normalised `SelectionResponse` (raw text + token usage + latency). The
 * router owns parsing the raw text into a basename array, so every provider
 * looks identical from the pipeline's point of view.
 *
 * Provider-specific concepts must NOT leak here. Anthropic's ephemeral cache
 * control and `anthropic-beta` headers live in `AnthropicProviderOptions`
 * (passed to the Anthropic adapter's constructor), never on this interface.
 *
 * v0.2 ships AnthropicProvider, OpenAIProvider and OllamaProvider, built via
 * `createProvider()` in `factory.ts`.
 */

export interface ProviderConfig {
  /** API key. Optional — local providers (Ollama) require none. */
  apiKey?: string;
  model: string;
  /** Override the provider's default API endpoint. */
  baseUrl?: string;
}

export interface SelectionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface UsageBreakdown {
  inputTokens: number;
  outputTokens: number;
  /** Cache-write tokens. 0 for providers without explicit cache control. */
  cacheCreateTokens: number;
  /** Cache-read tokens (Anthropic `cache_read`, OpenAI `cached_tokens`). */
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
