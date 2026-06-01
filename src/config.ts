/**
 * Configuration resolution — env vars > config.yaml > defaults.
 *
 * V0.1 reads only env vars (no YAML parser yet to keep deps zero).
 * YAML support deferred to v0.2 with `js-yaml` or `yaml`.
 */

import { homedir } from "node:os";
import { join } from "node:path";

export interface MemhookConfig {
  enabled: boolean;
  provider: {
    type: "anthropic";
    model: string;
    apiKeyEnv: string;
    baseUrl?: string | undefined;
    betaHeaders: string[];
  };
  selection: {
    maxFiles: number;
    maxAdditionalChars: number;
    maxOutputTokens: number;
    curlTimeoutMs: number;
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
  logging: {
    jsonlPath: string;
  };
  scriptVersion: string;
}

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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MemhookConfig {
  const home = homedir();
  const get = (k: string, fallback: string): string => env[k] ?? fallback;
  const getNum = (k: string, fallback: number): number => {
    const v = env[k];
    if (!v) return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const getBool = (k: string, fallback: boolean): boolean => {
    const v = env[k];
    if (v === undefined) return fallback;
    return v === "true" || v === "1";
  };

  return {
    enabled: getBool("MEMHOOK_ENABLED", true),
    provider: {
      type: "anthropic",
      model: get("MEMHOOK_MODEL", "claude-haiku-4-5"),
      apiKeyEnv: get("MEMHOOK_API_KEY_ENV", "ANTHROPIC_API_KEY"),
      baseUrl: env["MEMHOOK_BASE_URL"],
      betaHeaders: [],
    },
    selection: {
      maxFiles: getNum("MEMHOOK_MAX_FILES", 5),
      maxAdditionalChars: getNum("MEMHOOK_MAX_ADDITIONAL_CHARS", 9500),
      maxOutputTokens: getNum("MEMHOOK_MAX_OUTPUT_TOKENS", 200),
      curlTimeoutMs: getNum("MEMHOOK_TIMEOUT_MS", 8000),
      cacheControlTtl: "1h",
    },
    cache: {
      enabled: !getBool("MEMHOOK_DISABLE_CACHE", false),
      ttlMin: getNum("MEMHOOK_CACHE_TTL_MIN", 60),
      dir: get("MEMHOOK_CACHE_DIR", join(home, ".cache", "memhook")),
      evictionDays: getNum("MEMHOOK_CACHE_EVICT_DAYS", 7),
    },
    preFilter: {
      enabled: !getBool("MEMHOOK_DISABLE_PREFILTER", false),
      trivialWordsFile:
        env["MEMHOOK_TRIVIAL_FILE"] ?? join(home, ".config", "memhook", "trivial-words.txt"),
      defaultWords: DEFAULT_TRIVIAL_WORDS,
    },
    retry: {
      enabled: true,
      maxAttempts: 2,
      backoffMs: 500,
    },
    catalog: {
      path: get("MEMHOOK_CATALOG_PATH", join(home, ".claude", "cache", "memory-catalog.txt")),
    },
    searchDirs: [
      get("MEMHOOK_PROJECTS_ROOT", join(home, ".claude", "projects")),
      get("MEMHOOK_GLOBAL_RULES_DIR", join(home, ".claude", "rules")),
    ],
    logging: {
      jsonlPath: get("MEMHOOK_LOG_PATH", join(home, ".claude", "logs", "memhook.log")),
    },
    scriptVersion: "0.1.0-preview.0",
  };
}
