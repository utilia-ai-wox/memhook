/**
 * Configuration resolution — env vars > config.yaml > defaults.
 *
 * Each key is resolved in exactly one place by a precedence-aware reader
 * (`str`/`num`/`bool`): it reads the env var first, then the YAML file value
 * (opt-in, loaded by `configFile.ts`), then a default. With no env vars and no
 * `~/.config/memhook/config.yaml`, resolution collapses to the same defaults
 * memhook shipped in v0.1, so existing Anthropic setups are unchanged.
 *
 * `loadConfig` is total — it must NEVER throw (it runs before the router's
 * try-boundaries on some paths). All YAML I/O is isolated in `loadYamlConfig`,
 * which swallows every error to null.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { loadYamlConfig } from "./configFile.js";
import { resolveCustomSources, resolvePresetNames, type CustomSource } from "./sources.js";
import { MEMHOOK_VERSION } from "./version.js";

export type ProviderType = "anthropic" | "openai" | "ollama";

export interface MemhookConfig {
  enabled: boolean;
  provider: {
    type: ProviderType;
    model: string;
    /** Env var name holding the API key. `undefined` for keyless providers. */
    apiKeyEnv: string | undefined;
    baseUrl?: string | undefined;
    /** Anthropic-only; forwarded to AnthropicProvider, ignored otherwise. */
    betaHeaders: string[];
  };
  selection: {
    maxFiles: number;
    maxAdditionalChars: number;
    maxOutputTokens: number;
    curlTimeoutMs: number;
    /** Anthropic-only ephemeral cache TTL; forwarded by the factory. */
    cacheControlTtl: "5m" | "1h";
  };
  cache: {
    enabled: boolean;
    ttlMin: number;
    dir: string;
    evictionDays: number;
  };
  preFilter: {
    enabled: boolean;
    trivialWordsFile: string | undefined;
    defaultWords: string[];
  };
  retry: {
    enabled: boolean;
    maxAttempts: number;
    backoffMs: number;
  };
  catalog: {
    path: string;
  };
  searchDirs: string[];
  /**
   * Whether to route memory the HOST already auto-loads at launch. Claude Code
   * loads `~/.claude/rules/*.md` and `<cwd>/.claude/rules/*.md` in full at
   * startup, so routing them again is positional re-surfacing, not new recall.
   *
   * OFF by default (the clean public behaviour): the catalog omits those
   * host-autoloaded rule zones, so memhook routes only memory the host does NOT
   * load (the `feedback_` / `project_` zones) — no double-injection. Measured: on
   * a real 4.8k-prompt corpus, ~20% of injecting prompts re-injected a rule the
   * host had already loaded in full (docs/private POC, 2026-06-02).
   *
   * Turn ON (`MEMHOOK_RESURFACE_HOST_LOADED=true`) for **long sessions / long
   * context** — launch-loaded rules drift far from the current prompt, so
   * re-surfacing the relevant ones near it restores their salience — or a
   * **complex project that tolerates no drift**, where the redundant re-injection
   * is a deliberate guard-rail.
   */
  resurfaceHostLoaded: boolean;
  /**
   * Extra memory sources beyond the built-in `~/.claude` zones — directories of
   * `.md` files (any naming, via a glob) that memhook catalogs + routes like its
   * own zones. This is how memhook cables onto memory that already exists in a
   * project. YAML-only (`customSources:`), default empty. See `src/sources.ts`.
   */
  customSources: CustomSource[];
  /**
   * Enabled built-in host presets (e.g. `continue`, `cline`) — named bundles of
   * sources for a known tool's `.md` convention, expanded against cwd/home at
   * catalog/router time. YAML-only (`presets:`), default empty. All presets are
   * experimental (doc-verified, not live-tested). See `src/sources.ts`.
   */
  presets: string[];
  logging: {
    jsonlPath: string;
  };
  /**
   * Optional proactive nudge: when the memory catalog grows past a threshold,
   * the router attaches a one-line `systemMessage` suggesting `/curate`. This
   * is local-only (no outbound call) and best-effort (never affects fail-soft).
   */
  curateNudge: {
    enabled: boolean;
    thresholdTokens: number;
    thresholdFiles: number;
    cooldownDays: number;
  };
  scriptVersion: string;
}

/** Per-provider defaults applied once the provider type is known. */
const PROVIDER_DEFAULTS: Record<
  ProviderType,
  { model: string; apiKeyEnv: string | undefined; timeoutMs: number }
> = {
  anthropic: { model: "claude-haiku-4-5", apiKeyEnv: "ANTHROPIC_API_KEY", timeoutMs: 8000 },
  openai: { model: "gpt-4o-mini", apiKeyEnv: "OPENAI_API_KEY", timeoutMs: 8000 },
  // Local models can be slow to cold-load into RAM/VRAM on the first call, so
  // Ollama gets a more generous default timeout to avoid aborting every cold start.
  ollama: { model: "llama3.1", apiKeyEnv: undefined, timeoutMs: 30000 },
};

const DEFAULT_TRIVIAL_WORDS = [
  "ok",
  "okay",
  "oui",
  "non",
  "no",
  "yes",
  "yeah",
  "yep",
  "ouais",
  "ouep",
  "nope",
  "merci",
  "thanks",
  "thx",
  "stop",
  "next",
  "bien",
  "nickel",
  "parfait",
  "hmm",
  "hmmm",
  "hmmmm",
  "k",
  "go",
  "vasy",
  "tupeux",
  "lance",
  "fais",
  "continue",
  "continu",
  "allez",
  "sure",
  "sur",
  "certain",
];

function isProviderType(v: string | undefined): v is ProviderType {
  return v === "anthropic" || v === "openai" || v === "ollama";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MemhookConfig {
  const home = homedir();
  const yaml = loadYamlConfig(env);

  // Precedence-aware readers: env > yaml > default. One call names each key once.
  //
  // Two robustness rules baked in here:
  //   1. A present-but-empty/whitespace env var is treated as ABSENT (matches
  //      v0.1's `if (!v)` numeric handling), so `MEMHOOK_MAX_FILES=` falls
  //      through to yaml/default instead of coercing to 0/"".
  //   2. The YAML value is parsed leniently and untrusted, so each reader
  //      type-narrows it at runtime — a wrong-typed key (string for a number,
  //      number for a bool) is ignored rather than leaking into typed config.
  const envVal = (envKey: string): string | undefined => {
    const v = env[envKey];
    return v !== undefined && v.trim() !== "" ? v : undefined;
  };
  const str = (envKey: string, yamlVal: unknown, def: string): string =>
    envVal(envKey) ?? (typeof yamlVal === "string" ? yamlVal : undefined) ?? def;
  const strOpt = (envKey: string, yamlVal: unknown, def: string | undefined): string | undefined =>
    envVal(envKey) ?? (typeof yamlVal === "string" ? yamlVal : undefined) ?? def;
  // Every numeric knob is a positive-integer count or duration, so a candidate
  // is only accepted if it is a finite integer >= 1. This rejects degenerate
  // values (negative caps, a 0ms timeout that aborts every request, NaN) by
  // falling through to yaml/default instead of passing them on; fractions are
  // floored. Defaults are trusted constants and pass through unchecked.
  const posInt = (n: number): number | undefined =>
    Number.isFinite(n) && n >= 1 ? Math.floor(n) : undefined;
  const num = (envKey: string, yamlVal: unknown, def: number): number => {
    const v = envVal(envKey);
    if (v !== undefined) {
      const fromEnv = posInt(Number(v));
      if (fromEnv !== undefined) return fromEnv;
    }
    const fromYaml = typeof yamlVal === "number" ? posInt(yamlVal) : undefined;
    return fromYaml ?? def;
  };
  // Accepted truthy tokens, case-insensitive: true / 1 / yes / on.
  const truthy = (v: string): boolean => {
    const t = v.trim().toLowerCase();
    return t === "true" || t === "1" || t === "yes" || t === "on";
  };
  // Positive boolean (env wins, then yaml, then default).
  const bool = (envKey: string, yamlVal: unknown, def: boolean): boolean => {
    const v = envVal(envKey);
    if (v !== undefined) return truthy(v);
    return typeof yamlVal === "boolean" ? yamlVal : def;
  };
  // Inverted `MEMHOOK_DISABLE_*` env flag mapped onto a positive enabled value.
  const enabledFromDisable = (
    disableEnvKey: string,
    yamlEnabled: unknown,
    def: boolean,
  ): boolean => {
    const v = envVal(disableEnvKey);
    if (v !== undefined) return !truthy(v);
    return typeof yamlEnabled === "boolean" ? yamlEnabled : def;
  };

  // Provider type first; its per-provider defaults seed model/apiKeyEnv/timeout.
  const rawType = envVal("MEMHOOK_PROVIDER") ?? yaml?.provider?.type;
  const type: ProviderType = isProviderType(rawType) ? rawType : "anthropic";
  const pdef = PROVIDER_DEFAULTS[type];
  // betaHeaders is the one list-typed key; narrow to a string[] (Anthropic-only).
  const yamlBetas = yaml?.provider?.betaHeaders;
  const betaHeaders = Array.isArray(yamlBetas)
    ? yamlBetas.filter((h): h is string => typeof h === "string")
    : [];

  return {
    enabled: bool("MEMHOOK_ENABLED", yaml?.enabled, true),
    provider: {
      type,
      model: str("MEMHOOK_MODEL", yaml?.provider?.model, pdef.model),
      apiKeyEnv: strOpt("MEMHOOK_API_KEY_ENV", yaml?.provider?.apiKeyEnv, pdef.apiKeyEnv),
      baseUrl: strOpt("MEMHOOK_BASE_URL", yaml?.provider?.baseUrl, undefined),
      betaHeaders,
    },
    selection: {
      maxFiles: num("MEMHOOK_MAX_FILES", yaml?.selection?.maxFiles, 5),
      maxAdditionalChars: num(
        "MEMHOOK_MAX_ADDITIONAL_CHARS",
        yaml?.selection?.maxAdditionalChars,
        9500,
      ),
      maxOutputTokens: num("MEMHOOK_MAX_OUTPUT_TOKENS", yaml?.selection?.maxOutputTokens, 200),
      curlTimeoutMs: num("MEMHOOK_TIMEOUT_MS", yaml?.selection?.timeoutMs, pdef.timeoutMs),
      cacheControlTtl: "1h",
    },
    cache: {
      enabled: enabledFromDisable("MEMHOOK_DISABLE_CACHE", yaml?.cache?.enabled, true),
      ttlMin: num("MEMHOOK_CACHE_TTL_MIN", yaml?.cache?.ttlMin, 60),
      dir: str("MEMHOOK_CACHE_DIR", yaml?.cache?.dir, join(home, ".cache", "memhook")),
      evictionDays: num("MEMHOOK_CACHE_EVICT_DAYS", yaml?.cache?.evictionDays, 7),
    },
    preFilter: {
      enabled: enabledFromDisable("MEMHOOK_DISABLE_PREFILTER", yaml?.preFilter?.enabled, true),
      trivialWordsFile: strOpt(
        "MEMHOOK_TRIVIAL_FILE",
        yaml?.preFilter?.trivialWordsFile,
        join(home, ".config", "memhook", "trivial-words.txt"),
      ),
      defaultWords: DEFAULT_TRIVIAL_WORDS,
    },
    retry: {
      enabled: true,
      maxAttempts: 2,
      backoffMs: 500,
    },
    catalog: {
      path: str(
        "MEMHOOK_CATALOG_PATH",
        yaml?.catalog?.path,
        join(home, ".claude", "cache", "memory-catalog.txt"),
      ),
    },
    searchDirs: [
      str(
        "MEMHOOK_PROJECTS_ROOT",
        yaml?.searchDirs?.projectsRoot,
        join(home, ".claude", "projects"),
      ),
      str(
        "MEMHOOK_GLOBAL_RULES_DIR",
        yaml?.searchDirs?.globalRulesDir,
        join(home, ".claude", "rules"),
      ),
    ],
    resurfaceHostLoaded: bool("MEMHOOK_RESURFACE_HOST_LOADED", yaml?.resurfaceHostLoaded, false),
    customSources: resolveCustomSources(yaml?.customSources, home),
    presets: resolvePresetNames(yaml?.presets),
    logging: {
      jsonlPath: str(
        "MEMHOOK_LOG_PATH",
        yaml?.logging?.jsonlPath,
        join(home, ".claude", "logs", "memhook.log"),
      ),
    },
    curateNudge: {
      enabled: bool("MEMHOOK_CURATE_NUDGE", yaml?.curateNudge?.enabled, true),
      thresholdTokens: num(
        "MEMHOOK_CURATE_NUDGE_TOKENS",
        yaml?.curateNudge?.thresholdTokens,
        15000,
      ),
      thresholdFiles: num("MEMHOOK_CURATE_NUDGE_FILES", yaml?.curateNudge?.thresholdFiles, 250),
      cooldownDays: num("MEMHOOK_CURATE_NUDGE_COOLDOWN_DAYS", yaml?.curateNudge?.cooldownDays, 7),
    },
    scriptVersion: MEMHOOK_VERSION,
  };
}
