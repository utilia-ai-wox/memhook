/**
 * Memhook public API surface.
 *
 * Consumers typically don't import these directly — the package is invoked
 * as a Claude Code hook via `memhook run` or `node dist/router.js`. Exposed
 * here for programmatic embedding (tests, plugins, custom dashboards).
 */

export { loadConfig, type MemhookConfig, type ProviderType } from "./config.js";
export { loadYamlConfig, resolveConfigPath, type RawConfigFile } from "./configFile.js";
export { route, runHarness, type HookInput, type HookOutput } from "./router.js";
export { claudeCodeAdapter } from "./adapters/claudeCode.js";
export type { HarnessAdapter, HarnessInput, RouteResult } from "./adapters/types.js";
export { buildCatalog, type CatalogBuildOptions } from "./catalog.js";
export {
  resolveCustomSources,
  activeCustomSources,
  resolveSources,
  expandPresets,
  resolveActivePresetNames,
  resolvePresetNames,
  isPresetName,
  globToRegExp,
  listMatchingFiles,
  hasSourceExtension,
  expandHome,
  HOST_PRESETS,
  PRESET_NAMES,
  PRESET_AUTO,
  SOURCE_EXTENSIONS,
  type CustomSource,
  type SourceScope,
  type PresetDef,
} from "./sources.js";
export { LocalCache, type CacheKeyInput } from "./cache.js";
export { PreFilter } from "./preFilter.js";
export { MEMHOOK_VERSION } from "./version.js";
export { createProvider } from "./providers/factory.js";

// ── Internal building blocks (NOT part of the semver-stable surface) ─────────
// The install/init/skills/tail/ansi re-exports below back the CLI and tests.
// They are exposed for power users but may change between 0.x minor releases;
// the stable embedding API is the core above (route, loadConfig, buildCatalog,
// LocalCache, PreFilter, MEMHOOK_VERSION) plus the provider exports.
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
  COMPANION_SKILLS,
  SKILL_FILES,
  isCompanionSkill,
  diffSkill,
  planInstall,
  planUninstall,
  type CompanionSkill,
  type SkillSources,
  type InstalledFiles,
  type SkillStatus,
  type InstallAction,
  type SkillInstallPlan,
  type SkillUninstallPlan,
} from "./skills.js";
export {
  runSkills,
  installCompanionSkills,
  bundledSkillsDir,
  type RunSkillsOptions,
  type SkillsSubcommand,
  type InstallSkillsOptions,
  type SkillInstallResult,
} from "./skillsCmd.js";
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
