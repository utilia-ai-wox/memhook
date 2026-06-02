/**
 * OpenAI provider — `gpt-4o-mini` default.
 *
 * Wire format:
 *   POST https://api.openai.com/v1/chat/completions
 *   Headers: Authorization: Bearer <key>
 *   Body: { model, messages: [{role:system},{role:user}], max_tokens, temperature }
 *
 * The static catalog is sent as the leading `system` message and the variable
 * user prompt last, so OpenAI's automatic prompt caching (exact-prefix match,
 * ≥1024 tokens) can engage on a large catalog with no per-request flag.
 *
 * We deliberately do NOT set `response_format`: the router's `extractJsonArray`
 * already tolerantly pulls the basename array out of the raw text (and the
 * shared system prompt asks for a bare JSON array, which JSON-object mode would
 * fight). This keeps the adapter symmetric with Anthropic/Ollama — every
 * provider returns `rawText` and the router owns parsing. `gpt-4o-mini` is a
 * non-reasoning model, so plain `max_tokens` + `temperature: 0` apply (reasoning
 * models would require `max_completion_tokens` and reject `temperature`).
 *
 * Retry: single retry on 429/5xx with 500ms backoff, via the shared transport.
 */

import type {
  Provider,
  ProviderConfig,
  SelectionRequest,
  SelectionResponse,
  UsageBreakdown,
} from "./types.js";
import { postJsonWithRetry } from "./http.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1/chat/completions";
const RETRY_BACKOFF_MS = 500;
const RETRY_STATUSES = [429, 500, 502, 503, 504] as const;

export class OpenAIProvider implements Provider {
  readonly name = "openai";
  private readonly apiKey: string;

  constructor(private readonly config: ProviderConfig) {
    if (!config.apiKey) throw new Error("OpenAIProvider: apiKey is required");
    if (!config.model) throw new Error("OpenAIProvider: model is required");
    this.apiKey = config.apiKey;
  }

  async select(req: SelectionRequest): Promise<SelectionResponse> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      max_tokens: req.maxOutputTokens,
      temperature: 0,
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    const { json, httpStatus, latencyMs } = await postJsonWithRetry({
      url: this.config.baseUrl ?? DEFAULT_BASE_URL,
      headers,
      body,
      timeoutMs: req.timeoutMs,
      retryStatuses: RETRY_STATUSES,
      backoffMs: RETRY_BACKOFF_MS,
    });

    return {
      rawText: extractText(json),
      usage: extractUsage(json),
      latencyMs,
      httpStatus,
    };
  }
}

function extractText(json: Record<string, unknown> | null): string {
  if (!json) return "";
  const choices = json["choices"];
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  return typeof content === "string" ? content : "";
}

function extractUsage(json: Record<string, unknown> | null): UsageBreakdown {
  const usage = (json?.["usage"] as Record<string, unknown> | undefined) ?? {};
  const num = (key: string): number => {
    const v = usage[key];
    return typeof v === "number" ? v : 0;
  };
  const details = (usage["prompt_tokens_details"] as Record<string, unknown> | undefined) ?? {};
  const cachedTokens = typeof details["cached_tokens"] === "number" ? details["cached_tokens"] : 0;
  return {
    inputTokens: num("prompt_tokens"),
    outputTokens: num("completion_tokens"),
    cacheCreateTokens: 0,
    cacheReadTokens: cachedTokens,
  };
}
