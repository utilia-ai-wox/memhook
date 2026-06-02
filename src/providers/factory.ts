/**
 * Provider factory — builds the configured provider from `MemhookConfig`.
 *
 * The router imports only this factory, never the concrete adapter classes, so
 * provider selection lives in exactly one place. The `never` default arm gives
 * a compile error if a new `provider.type` union member is added without a
 * matching case here.
 *
 * Construction may throw (e.g. a required field missing) — the router wraps the
 * call in try/catch and falls back to empty `additionalContext` (fail-soft).
 */

import type { Provider, ProviderConfig } from "./types.js";
import type { MemhookConfig } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { OllamaProvider } from "./ollama.js";

export function createProvider(cfg: MemhookConfig, apiKey: string | undefined): Provider {
  const base: ProviderConfig = {
    model: cfg.provider.model,
    ...(apiKey !== undefined && { apiKey }),
    ...(cfg.provider.baseUrl !== undefined && { baseUrl: cfg.provider.baseUrl }),
  };

  switch (cfg.provider.type) {
    case "anthropic":
      return new AnthropicProvider(base, {
        betaHeaders: cfg.provider.betaHeaders,
        cacheControlTtl: cfg.selection.cacheControlTtl,
      });
    case "openai":
      return new OpenAIProvider(base);
    case "ollama":
      return new OllamaProvider(base);
    default: {
      const exhaustive: never = cfg.provider.type;
      throw new Error(`createProvider: unknown provider type ${String(exhaustive)}`);
    }
  }
}
