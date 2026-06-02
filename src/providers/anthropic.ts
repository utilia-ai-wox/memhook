/**
 * Anthropic provider — Haiku 4.5 default for memhook.
 *
 * Wire format:
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key, anthropic-version
 *   Body: { model, max_tokens, system: [{type, text, cache_control}], messages }
 *
 * Anthropic-specific concepts (ephemeral prompt caching, `anthropic-beta`
 * headers) are passed via `AnthropicProviderOptions` at construction time, NOT
 * through the shared `SelectionRequest` — so the OpenAI and Ollama adapters
 * never see them. Cache control TTL "1h" is GA in 2026; no beta header is
 * required, but a non-empty `betaHeaders` list still maps to `anthropic-beta`
 * for forward-compat.
 *
 * Retry: single retry on 429/503 with 500ms backoff (max 2 attempts), via the
 * shared `postJsonWithRetry` transport.
 */

import type {
  Provider,
  ProviderConfig,
  SelectionRequest,
  SelectionResponse,
  UsageBreakdown,
} from "./types.js";
import { postJsonWithRetry } from "./http.js";

/** Anthropic-only knobs, kept off the shared provider interface. */
export interface AnthropicProviderOptions {
  betaHeaders?: string[];
  cacheControlTtl?: "5m" | "1h";
}

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";
const RETRY_BACKOFF_MS = 500;
const RETRY_STATUSES = [429, 503] as const;

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private readonly apiKey: string;

  constructor(
    private readonly config: ProviderConfig,
    private readonly options: AnthropicProviderOptions = {},
  ) {
    if (!config.apiKey) throw new Error("AnthropicProvider: apiKey is required");
    if (!config.model) throw new Error("AnthropicProvider: model is required");
    this.apiKey = config.apiKey;
  }

  async select(req: SelectionRequest): Promise<SelectionResponse> {
    const ttl = this.options.cacheControlTtl;
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: req.maxOutputTokens,
      system: [
        {
          type: "text",
          text: req.systemPrompt,
          cache_control: ttl ? { type: "ephemeral", ttl } : { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: req.userPrompt }],
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    const betas = this.options.betaHeaders ?? [];
    if (betas.length > 0) headers["anthropic-beta"] = betas.join(",");

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
  const content = json["content"];
  if (!Array.isArray(content)) return "";
  const first = content[0] as { text?: unknown } | undefined;
  return typeof first?.text === "string" ? first.text : "";
}

function extractUsage(json: Record<string, unknown> | null): UsageBreakdown {
  const usage = (json?.["usage"] as Record<string, unknown> | undefined) ?? {};
  const num = (key: string): number => {
    const v = usage[key];
    return typeof v === "number" ? v : 0;
  };
  return {
    inputTokens: num("input_tokens"),
    outputTokens: num("output_tokens"),
    cacheCreateTokens: num("cache_creation_input_tokens"),
    cacheReadTokens: num("cache_read_input_tokens"),
  };
}
