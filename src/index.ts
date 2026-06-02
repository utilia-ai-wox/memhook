/**
 * Memhook public API surface.
 *
 * Consumers typically don't import these directly — the package is invoked
 * as a Claude Code hook via `memhook run` or `node dist/router.js`. Exposed
 * here for programmatic embedding (tests, plugins, custom dashboards).
 */

export { loadConfig, type MemhookConfig, type ProviderType } from "./config.js";
export { loadYamlConfig, resolveConfigPath, type RawConfigFile } from "./configFile.js";
export { route, type HookInput, type HookOutput } from "./router.js";
export { buildCatalog, type CatalogBuildOptions } from "./catalog.js";
export { LocalCache, type CacheKeyInput } from "./cache.js";
export { PreFilter } from "./preFilter.js";
export { MEMHOOK_VERSION } from "./version.js";
export { createProvider } from "./providers/factory.js";
export {
  addHooks,
  removeHooks,
  memhookSubcommand,
  MEMHOOK_HOOKS,
  type Settings,
  type HookEvent,
  type AddResult,
  type RemoveResult,
} from "./install.js";
export {
  runInit,
  runUninstall,
  buildConfigObject,
  backupPath,
  type InitOptions,
  type UninstallOptions,
} from "./init.js";
export {
  runTail,
  parseLogLine,
  formatRow,
  formatHeader,
  formatFooter,
  summarize,
  emptyStats,
  accumulate,
  tailLines,
  type LogRow,
  type Stats,
  type TailOptions,
} from "./tail.js";
export { makeAnsi, colorEnabled, visibleWidth, type Ansi, type AnsiOptions } from "./ansi.js";
export { AnthropicProvider, type AnthropicProviderOptions } from "./providers/anthropic.js";
export { OpenAIProvider } from "./providers/openai.js";
export { OllamaProvider } from "./providers/ollama.js";
export type {
  Provider,
  ProviderConfig,
  SelectionRequest,
  SelectionResponse,
  UsageBreakdown,
} from "./providers/types.js";
