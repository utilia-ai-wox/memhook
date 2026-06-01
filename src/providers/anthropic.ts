/**
 * Anthropic provider — Haiku 4.5 default for memhook v0.1.
 *
 * Wire format:
 *   POST https://api.anthropic.com/v1/messages
 *   Headers: x-api-key, anthropic-version
 *   Body: { model, max_tokens, system: [{type, text, cache_control}], messages }
 *
 * Cache control TTL "1h" is GA in 2026 — no beta header required. `betaHeaders`
 * defaults to `[]`; a non-empty list still maps to the `anthropic-beta` header
 * for forward-compat with future beta features.
 *
 * Retry: single retry on 429/503 with 500ms backoff (max 2 attempts).
 */

import type {
  Provider,
  ProviderConfig,
  SelectionRequest,
  SelectionResponse,
  UsageBreakdown,
} from "./types.js";

const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1/messages";
const RETRY_BACKOFF_MS = 500;

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";

  constructor(private readonly config: ProviderConfig) {
    if (!config.apiKey) throw new Error("AnthropicProvider: apiKey is required");
    if (!config.model) throw new Error("AnthropicProvider: model is required");
  }

  async select(req: SelectionRequest): Promise<SelectionResponse> {
    const body = JSON.stringify({
      model: this.config.model,
      max_tokens: req.maxOutputTokens,
      system: [
        {
          type: "text",
          text: req.systemPrompt,
          cache_control: req.cacheControlTtl
            ? { type: "ephemeral", ttl: req.cacheControlTtl }
            : { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: req.userPrompt }],
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": this.config.apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    };
    const betas = this.config.betaHeaders ?? [];
    if (betas.length > 0) headers["anthropic-beta"] = betas.join(",");

    const url = this.config.baseUrl ?? DEFAULT_BASE_URL;

    let lastResponse: SelectionResponse | null = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const started = Date.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      let resp: Response;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (attempt === 1) {
          await sleep(RETRY_BACKOFF_MS);
          continue;
        }
        throw err;
      }
      clearTimeout(timer);
      const latencyMs = Date.now() - started;
      const status = resp.status;

      if (attempt === 1 && (status === 429 || status === 503)) {
        await sleep(RETRY_BACKOFF_MS);
        continue;
      }

      const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
      lastResponse = {
        rawText: extractText(json),
        usage: extractUsage(json),
        latencyMs,
        httpStatus: status,
      };
      break;
    }
    if (!lastResponse) {
      throw new Error("AnthropicProvider: no response after retries");
    }
    return lastResponse;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const num = (key: string) => {
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
