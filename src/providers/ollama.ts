/**
 * Ollama provider — local models, `llama3.1` default.
 *
 * Wire format (native chat endpoint, NOT the OpenAI-compat layer):
 *   POST http://localhost:11434/api/chat
 *   No Authorization header (local Ollama needs no key).
 *   Body: { model, messages, stream:false, format:"json", options:{temperature,num_predict} }
 *
 * The native `/api/chat` is preferred over `/v1/chat/completions` because it
 * exposes deterministic `options` first-class, returns a flat
 * `message.content` + top-level token counts (matching memhook's response
 * shape), and requires no dummy `api_key` the OpenAI-compat clients demand.
 * `stream:false` forces a single JSON body (otherwise the response is
 * newline-delimited chunks that would break parsing). `format:"json"` nudges
 * weaker local models toward parseable output; the router's `extractJsonArray`
 * still pulls the basename array out tolerantly.
 *
 * Fail-soft notes: a missing model (404 `model 'x' not found`) or a stopped
 * daemon (ECONNREFUSED) surfaces as empty `rawText` / a thrown fetch, both of
 * which the router treats as an empty selection. Cold model load can be slow,
 * so the config layer gives Ollama a more generous default timeout.
 */

import type {
  Provider,
  ProviderConfig,
  SelectionRequest,
  SelectionResponse,
  UsageBreakdown,
} from "./types.js";
import { postJsonWithRetry } from "./http.js";

const DEFAULT_BASE_URL = "http://localhost:11434/api/chat";
const RETRY_BACKOFF_MS = 500;
// No HTTP status is worth retrying for a local daemon (404 model-not-found /
// 400 won't fix on retry); the shared transport still retries once on a thrown
// network error, covering a transient connection blip.
const RETRY_STATUSES = [] as const;

export class OllamaProvider implements Provider {
  readonly name = "ollama";

  constructor(private readonly config: ProviderConfig) {
    if (!config.model) throw new Error("OllamaProvider: model is required");
  }

  async select(req: SelectionRequest): Promise<SelectionResponse> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: [
        { role: "system", content: req.systemPrompt },
        { role: "user", content: req.userPrompt },
      ],
      stream: false,
      format: "json",
      options: {
        temperature: 0,
        num_predict: req.maxOutputTokens,
      },
    });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
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
  const message = json["message"] as { content?: unknown } | undefined;
  return typeof message?.content === "string" ? message.content : "";
}

function extractUsage(json: Record<string, unknown> | null): UsageBreakdown {
  const num = (key: string): number => {
    const v = json?.[key];
    return typeof v === "number" ? v : 0;
  };
  return {
    inputTokens: num("prompt_eval_count"),
    outputTokens: num("eval_count"),
    cacheCreateTokens: 0,
    cacheReadTokens: 0,
  };
}
