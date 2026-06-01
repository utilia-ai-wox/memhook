/**
 * Memhook public API surface.
 *
 * Consumers typically don't import these directly — the package is invoked
 * as a Claude Code hook via `memhook run` or `node dist/router.js`. Exposed
 * here for programmatic embedding (tests, plugins, custom dashboards).
 */

export { loadConfig, type MemhookConfig } from "./config.js";
export { route, type HookInput, type HookOutput } from "./router.js";
export { buildCatalog, type CatalogBuildOptions } from "./catalog.js";
export { LocalCache, type CacheKeyInput } from "./cache.js";
export { PreFilter } from "./preFilter.js";
export { AnthropicProvider } from "./providers/anthropic.js";
export type {
  Provider,
  ProviderConfig,
  SelectionRequest,
  SelectionResponse,
  UsageBreakdown,
} from "./providers/types.js";
