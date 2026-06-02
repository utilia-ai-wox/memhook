/**
 * Custom memory sources — let memhook cable onto memory that already exists in a
 * project, wherever it lives and however its files are named, instead of only
 * the built-in `~/.claude` zones.
 *
 * A user declares extra sources in the YAML config (`customSources:`); each is a
 * directory of `.md` files plus a filename glob, a scope, and whether the host
 * already auto-loads them at launch. The router catalogs + injects from these
 * exactly like the built-in zones. Everything here is pure (no I/O) and total
 * (never throws): malformed entries are dropped, not fatal — the hook stays
 * fail-soft.
 */

import { join } from "node:path";

export type SourceScope = "memory" | "rules";

/** A resolved, fully-typed custom source (every field present). */
export interface CustomSource {
  /** Absolute directory to scan (`~` already expanded). */
  dir: string;
  /** Basename glob (`*`, `?`); defaults to `*.md`. */
  glob: string;
  /** `memory` (default) or `rules` — drives the catalog section + display. */
  scope: SourceScope;
  /**
   * Whether the host loads these files in full at launch. When true they are
   * skipped unless `resurfaceHostLoaded` is on (same contract as the built-in
   * `~/.claude/rules` zones — see `MemhookConfig.resurfaceHostLoaded`).
   */
  hostAutoLoaded: boolean;
}

/** Expand a leading `~` / `~/` against the given home directory. */
export function expandHome(p: string, home: string): string {
  if (p === "~") return home;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home, p.slice(2));
  return p;
}

/**
 * Compile a basename glob into an anchored RegExp. Only `*` (any run) and `?`
 * (one char) are special; every other character is matched literally. Operates
 * on basenames only — never a path separator.
 */
export function globToRegExp(glob: string): RegExp {
  let body = "";
  for (const ch of glob) {
    if (ch === "*") body += ".*";
    else if (ch === "?") body += ".";
    else body += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${body}$`);
}

/**
 * Resolve untrusted YAML `customSources` into typed `CustomSource[]`. Anything
 * that isn't a usable entry (not an object, missing/blank `dir`) is dropped.
 * Never throws.
 */
export function resolveCustomSources(raw: unknown, home: string): CustomSource[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomSource[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e["dir"] !== "string" || e["dir"].trim() === "") continue;
    const glob = typeof e["glob"] === "string" && e["glob"].trim() !== "" ? e["glob"] : "*.md";
    const scope: SourceScope = e["scope"] === "rules" ? "rules" : "memory";
    out.push({
      dir: expandHome(e["dir"], home),
      glob,
      scope,
      hostAutoLoaded: e["hostAutoLoaded"] === true,
    });
  }
  return out;
}

/**
 * The custom sources that should actually be catalogued + scanned: a
 * host-autoloaded source is active only when re-surfacing is requested. Both the
 * catalog builder and the router filter through this so they never disagree.
 */
export function activeCustomSources(
  sources: readonly CustomSource[],
  resurfaceHostLoaded: boolean,
): CustomSource[] {
  return sources.filter((s) => !s.hostAutoLoaded || resurfaceHostLoaded);
}

// ── Built-in per-host presets ────────────────────────────────────────────────
//
// A preset is a named bundle of CustomSource templates for a known tool's
// memory/instruction convention, so a user cables onto it with `presets:
// [continue]` instead of hand-writing the paths. EVERY preset is doc-verified
// against the tool's official docs but NOT live-tested by us, so it is shipped
// EXPERIMENTAL (docs/SPECIFICATION.md §24 "supported = tested"); a live echo-test
// promotes it. Convention sources: docs/private/host-source-presets-SPEC-2026-06-02.md.
//
// Only ATOMIC `.md` conventions are presets here — monolithic files (AGENTS.md,
// GEMINI.md, ~/.codex/AGENTS.md, …) are `/import` migration targets, not sources
// (routing one big file whole is a no-op for relevance selection).

interface PresetSourceDef {
  /** Resolve `rel` against the project cwd or the home directory. */
  readonly base: "cwd" | "home";
  readonly rel: string;
  readonly glob: string;
  readonly scope: SourceScope;
  readonly hostAutoLoaded: boolean;
}

export interface PresetDef {
  /** Doc-verified, not live-tested → always experimental until an echo-test. */
  readonly experimental: true;
  readonly summary: string;
  readonly sources: readonly PresetSourceDef[];
}

/** Built-in presets keyed by name. Atomic `.md` conventions only. */
export const HOST_PRESETS: Record<string, PresetDef> = {
  cline: {
    experimental: true,
    summary: "Cline — .clinerules/ (project) + ~/Documents/Cline/Rules/ (global)",
    sources: [
      { base: "cwd", rel: ".clinerules", glob: "*.md", scope: "rules", hostAutoLoaded: true },
      {
        base: "home",
        rel: join("Documents", "Cline", "Rules"),
        glob: "*.md",
        scope: "rules",
        hostAutoLoaded: true,
      },
    ],
  },
  continue: {
    experimental: true,
    summary: "Continue.dev — .continue/rules/ (project + ~)",
    sources: [
      {
        base: "cwd",
        rel: join(".continue", "rules"),
        glob: "*.md",
        scope: "rules",
        hostAutoLoaded: false,
      },
      {
        base: "home",
        rel: join(".continue", "rules"),
        glob: "*.md",
        scope: "rules",
        hostAutoLoaded: false,
      },
    ],
  },
  copilot: {
    experimental: true,
    summary: "GitHub Copilot — .github/instructions/*.instructions.md (project)",
    sources: [
      {
        base: "cwd",
        rel: join(".github", "instructions"),
        glob: "*.instructions.md",
        scope: "rules",
        hostAutoLoaded: false,
      },
    ],
  },
  windsurf: {
    experimental: true,
    summary: "Windsurf — .windsurf/rules/ (project)",
    sources: [
      {
        base: "cwd",
        rel: join(".windsurf", "rules"),
        glob: "*.md",
        scope: "rules",
        hostAutoLoaded: false,
      },
    ],
  },
};

/** All known preset names. */
export const PRESET_NAMES: string[] = Object.keys(HOST_PRESETS);

export function isPresetName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOST_PRESETS, name);
}

/** Keep only valid, known preset names from untrusted YAML. Never throws. */
export function resolvePresetNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && isPresetName(x));
}

/**
 * Expand preset names into concrete `CustomSource[]`, resolving each template's
 * `cwd`/`home` base. Unknown names are skipped. Pure + total.
 */
export function expandPresets(names: readonly string[], cwd: string, home: string): CustomSource[] {
  const out: CustomSource[] = [];
  for (const name of names) {
    const def = HOST_PRESETS[name];
    if (!def) continue;
    for (const s of def.sources) {
      out.push({
        dir: join(s.base === "cwd" ? cwd : home, s.rel),
        glob: s.glob,
        scope: s.scope,
        hostAutoLoaded: s.hostAutoLoaded,
      });
    }
  }
  return out;
}

/**
 * The full set of user-declared sources: explicit `customSources` plus the
 * expanded built-in `presets`. The single place catalog + router agree on what
 * "the custom sources" are, so they never diverge.
 */
export function resolveSources(
  customSources: readonly CustomSource[],
  presets: readonly string[],
  cwd: string,
  home: string,
): CustomSource[] {
  return [...customSources, ...expandPresets(presets, cwd, home)];
}
