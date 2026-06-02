/**
 * Optional YAML config file loader.
 *
 * Resolution: `$MEMHOOK_CONFIG`, else `~/.config/memhook/config.yaml`. The file
 * is entirely opt-in — when it is absent, `loadYamlConfig` returns null and the
 * config layer collapses to exactly the env-var-or-default behaviour of v0.1.
 *
 * This module is the ONLY place YAML I/O happens, and it must NEVER throw: any
 * error (missing file, unreadable, malformed YAML, non-object root) resolves to
 * null so `loadConfig` stays total and the hook stays fail-soft. The `yaml`
 * parser is lenient (it can return a partial object for malformed input), so
 * callers must still treat the returned shape as untrusted and narrow each
 * field — see `config.ts`.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

/** A YAML config mirrors a subset of MemhookConfig. Every key is optional. */
export interface RawConfigFile {
  enabled?: boolean;
  provider?: {
    type?: string;
    model?: string;
    apiKeyEnv?: string;
    baseUrl?: string;
    betaHeaders?: string[];
  };
  selection?: {
    maxFiles?: number;
    maxAdditionalChars?: number;
    maxOutputTokens?: number;
    timeoutMs?: number;
  };
  cache?: {
    enabled?: boolean;
    ttlMin?: number;
    dir?: string;
    evictionDays?: number;
  };
  preFilter?: {
    enabled?: boolean;
    trivialWordsFile?: string;
  };
  catalog?: {
    path?: string;
  };
  searchDirs?: {
    projectsRoot?: string;
    globalRulesDir?: string;
  };
  resurfaceHostLoaded?: boolean;
  /** Extra `.md` source dirs; validated + narrowed by `resolveCustomSources`. */
  customSources?: unknown;
  logging?: {
    jsonlPath?: string;
  };
  curateNudge?: {
    enabled?: boolean;
    thresholdTokens?: number;
    thresholdFiles?: number;
    cooldownDays?: number;
  };
}

export function resolveConfigPath(env: NodeJS.ProcessEnv): string {
  return env["MEMHOOK_CONFIG"] ?? join(homedir(), ".config", "memhook", "config.yaml");
}

export function loadYamlConfig(env: NodeJS.ProcessEnv): RawConfigFile | null {
  const path = resolveConfigPath(env);
  if (!existsSync(path)) return null;

  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    // logLevel "error" keeps stray parser warnings off stderr (the hook must
    // never emit noise). Malformed YAML throws YAMLParseError -> caught -> null.
    parsed = parse(text, { logLevel: "error" });
  } catch {
    if (env["MEMHOOK_DEBUG"] === "true") {
      process.stderr.write(`memhook: ignoring unparseable config at ${path}\n`);
    }
    return null;
  }

  // The parser is lenient and may return scalars/arrays/null — only trust a
  // plain object root.
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as RawConfigFile;
}
