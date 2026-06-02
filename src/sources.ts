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
