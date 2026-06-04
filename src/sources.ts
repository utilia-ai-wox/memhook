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
  /**
   * Whether autoload is decided PER FILE by frontmatter rather than for the whole
   * directory. When true, each file is tested with `isHostAutoloadedFile` and the
   * always-applied ones (Cursor `alwaysApply: true`, Windsurf `trigger:
   * always_on`) are skipped at catalog + router time — unless `resurfaceHostLoaded`
   * is on (same gate as `hostAutoLoaded`, applied per file). Lets a single
   * directory mix host-autoloaded rules (skip) and manual/agent-requested ones
   * (route) — the Cursor `.cursor/rules` shape. Orthogonal to `hostAutoLoaded`:
   * the source as a whole is still gated by that boolean first.
   */
  perFileAutoload: boolean;
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
 * Extensions memhook will catalog + inject from a source directory. This is the
 * single source of truth, kept in lockstep with the router's injection guard
 * (`SAFE_BASENAME_RE` is built from it) so the catalog can never list a file the
 * router would refuse to inject. `md` is the native memhook format; `mdc`
 * (Cursor) and `txt` (Cline) let presets/customSources cable onto other tools'
 * atomic rule files. Claude Code's own rule zones stay `.md`-only (catalog.ts).
 */
export const SOURCE_EXTENSIONS = ["md", "mdc", "txt"] as const;

const SOURCE_EXT_RE = new RegExp(`\\.(${SOURCE_EXTENSIONS.join("|")})$`);

/** Whether a basename ends in an allowed source extension (case-sensitive). */
export function hasSourceExtension(name: string): boolean {
  return SOURCE_EXT_RE.test(name);
}

/**
 * From a raw directory listing, the allowed-extension files matching `glob`,
 * sorted. Pure and total. The extension gate is an independent safety floor on
 * top of the glob (a glob like `*` still only yields the allowed extensions),
 * mirroring the router's injection guard. The catalog builder and preset
 * detection both filter through this so they can never disagree on a match.
 */
export function listMatchingFiles(entries: readonly string[], glob: string): string[] {
  const re = globToRegExp(glob);
  return entries.filter((e) => hasSourceExtension(e) && re.test(e)).sort();
}

/**
 * Whether a rule file declares itself ALWAYS-APPLIED by its host — i.e. the host
 * already injects it in full on every turn, so memhook routing it again would
 * double-inject (the same contract as the source-level `hostAutoLoaded`, decided
 * per file instead of per directory). Recognises the two documented per-file
 * always-on markers in YAML frontmatter: Cursor `alwaysApply: true` and Windsurf
 * `trigger: always_on` (docs/private/host-source-presets-SPEC-2026-06-02.md
 * footnotes 5–6). Only the frontmatter block is scanned (never the body), so body
 * prose can't false-positive. Pure + total: no frontmatter, an unterminated block,
 * or any other value → false (the conservative direction — a missed marker routes
 * the file, it never wrongly hides one). Drives a source's `perFileAutoload` skip.
 */
export function isHostAutoloadedFile(content: string): boolean {
  if (!content.startsWith("---")) return false;
  const end = content.indexOf("\n---", 3);
  if (end < 0) return false;
  const fm = content.slice(3, end);
  return (
    /^alwaysApply:[ \t]*true[ \t]*$/m.test(fm) || // Cursor always-applied rule
    /^trigger:[ \t]*always_on[ \t]*$/m.test(fm) // Windsurf always_on trigger
  );
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
      perFileAutoload: e["perFileAutoload"] === true,
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
  /** Per-file autoload skip (see `CustomSource.perFileAutoload`); default false. */
  readonly perFileAutoload?: boolean;
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
  cursor: {
    experimental: true,
    summary: "Cursor — .cursor/rules/*.mdc (project; always-applied rules skipped)",
    sources: [
      // Cursor decides autoload per RULE: `alwaysApply: true` is host-loaded every
      // turn (skip), while manual (`@`-mention) and agent-requested rules are not
      // (route). So the source is NOT host-autoloaded as a whole — it is
      // per-file-autoload. Plain `.md` here is IGNORED by Cursor, so the glob is
      // `*.mdc`; nested `.cursor/rules/**` is top-level-only (globToRegExp is
      // basename-only — see host-source-presets-SPEC footnotes 6–7).
      {
        base: "cwd",
        rel: join(".cursor", "rules"),
        glob: "*.mdc",
        scope: "rules",
        hostAutoLoaded: false,
        perFileAutoload: true,
      },
    ],
  },
  windsurf: {
    experimental: true,
    summary: "Windsurf — .windsurf/rules/ (project; always_on rules skipped)",
    sources: [
      // Windsurf `trigger:` is per file: `always_on` is host-loaded (skip), while
      // `model_decision`/`glob`/`manual` are not (route) — so per-file-autoload,
      // not a directory-wide host-autoload (host-source-presets-SPEC footnote 5).
      {
        base: "cwd",
        rel: join(".windsurf", "rules"),
        glob: "*.md",
        scope: "rules",
        hostAutoLoaded: false,
        perFileAutoload: true,
      },
    ],
  },
};

/** All known preset names. */
export const PRESET_NAMES: string[] = Object.keys(HOST_PRESETS);

/**
 * Special `presets:` token: instead of naming presets, the user opts in once and
 * memhook routes every preset it detects on disk. Explicit opt-in (never the
 * default), so the cardinal opt-in design (D31/D32) holds; the routed presets are
 * still experimental (§24). See `resolveActivePresetNames`.
 */
export const PRESET_AUTO = "auto";

export function isPresetName(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(HOST_PRESETS, name);
}

/**
 * Keep only valid preset entries from untrusted YAML: known names plus the
 * special `auto` token. Never throws.
 */
export function resolvePresetNames(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is string => typeof x === "string" && (isPresetName(x) || x === PRESET_AUTO),
  );
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
        perFileAutoload: s.perFileAutoload ?? false,
      });
    }
  }
  return out;
}

/**
 * Resolve the effective preset names. Without the `auto` token, this is just the
 * known names as given. With `auto` (explicit opt-in), it expands to every preset
 * detected on disk (via `readDir`), unioned with any explicitly-named presets and
 * de-duplicated. `readDir` is consulted ONLY when `auto` is present, so a config
 * without `auto` pays zero detection I/O. Pure-of-I/O (the reader is a seam) and
 * total (`detectPresets` swallows reader errors).
 */
export function resolveActivePresetNames(
  names: readonly string[],
  cwd: string,
  home: string,
  readDir: (dir: string) => string[],
): string[] {
  const known = names.filter(isPresetName); // drops `auto` + any unknown token
  if (!names.includes(PRESET_AUTO)) return known;
  const detected = detectPresets(cwd, home, readDir)
    .filter((d) => d.matched)
    .map((d) => d.name);
  return [...new Set([...known, ...detected])];
}

/**
 * The full set of user-declared sources: explicit `customSources` plus the
 * expanded built-in `presets` (with `auto` resolved to the detected presets via
 * `readDir`). The single place catalog + router agree on what "the custom
 * sources" are, so they never diverge — including how `auto` expands.
 */
export function resolveSources(
  customSources: readonly CustomSource[],
  presets: readonly string[],
  cwd: string,
  home: string,
  readDir: (dir: string) => string[],
): CustomSource[] {
  const names = resolveActivePresetNames(presets, cwd, home, readDir);
  return [...customSources, ...expandPresets(names, cwd, home)];
}

// ── Preset detection (`memhook presets detect`) ──────────────────────────────
//
// Discovery layer that makes the presets zero-friction: instead of knowing a
// preset's name and hand-writing `presets: [continue]`, the user runs `memhook
// presets detect`, memhook scans each preset's directories, and reports which
// ones actually hold matching `.md` files (plus the YAML snippet to enable them).
// The orchestration is pure: the real `readdirSync` is injected as `readDir`, so
// the whole detection is unit-testable with a fake reader and never throws (a
// reader error is treated as an absent directory).

/** One resolved preset directory and what it matched. */
export interface PresetDirMatch {
  /** Absolute directory the preset points at (cwd/home already resolved). */
  dir: string;
  /** The basename glob applied to that directory. */
  glob: string;
  /** Matching `.md` basenames (sorted); empty if the dir is absent or has none. */
  files: string[];
  /** Whether the directory was readable at all (distinguishes empty from missing). */
  exists: boolean;
}

/** Detection result for one built-in preset. */
export interface PresetDetection {
  name: string;
  summary: string;
  /** Mirrors `PresetDef.experimental` — every built-in preset is experimental. */
  experimental: true;
  /** True when at least one of the preset's directories matched ≥1 `.md` file. */
  matched: boolean;
  dirs: PresetDirMatch[];
}

/**
 * Scan every built-in preset against the filesystem (via the injected `readDir`)
 * and report which ones hold matching memory. Pure of real I/O (the reader is a
 * seam) and total: a `readDir` that throws on a missing/denied directory is
 * caught and recorded as `exists: false`, never propagated. Presets are returned
 * in `PRESET_NAMES` order so the output is deterministic.
 */
export function detectPresets(
  cwd: string,
  home: string,
  readDir: (dir: string) => string[],
): PresetDetection[] {
  const out: PresetDetection[] = [];
  for (const name of PRESET_NAMES) {
    const def = HOST_PRESETS[name];
    if (!def) continue;
    const dirs: PresetDirMatch[] = [];
    for (const s of def.sources) {
      const dir = join(s.base === "cwd" ? cwd : home, s.rel);
      let entries: string[] | null = null;
      try {
        entries = readDir(dir);
      } catch {
        entries = null;
      }
      const files = entries === null ? [] : listMatchingFiles(entries, s.glob);
      dirs.push({ dir, glob: s.glob, files, exists: entries !== null });
    }
    out.push({
      name,
      summary: def.summary,
      experimental: def.experimental,
      matched: dirs.some((d) => d.files.length > 0),
      dirs,
    });
  }
  return out;
}
