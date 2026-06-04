/**
 * Memhook catalog builder — TS port of build-memory-catalog.sh.
 *
 * Discovers feedbacks & projects in `~/.claude/projects/* /memory/`. Global
 * rules (`~/.claude/rules/`) and project rules (`<cwd>/.claude/rules/`) are
 * host-autoloaded and included ONLY when `resurfaceHostLoaded` is set (default
 * off), so memhook does not re-catalogue what Claude Code already loads at
 * launch.
 *
 * Phase 0.5 Q4: title-only for non-CWD zones (~50% catalog size reduction).
 * The CWD zone gets full `basename: description`; others list just basenames.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  statSync,
  renameSync,
} from "node:fs";
import { join, basename as pathBasename } from "node:path";
import { homedir } from "node:os";
import {
  activeCustomSources,
  isHostAutoloadedFile,
  listMatchingFiles,
  type CustomSource,
} from "./sources.js";

export interface CatalogBuildOptions {
  cwd: string;
  projectsRoot?: string;
  globalRulesDir?: string;
  outputPath: string;
  /**
   * Include the host-autoloaded rule zones (`~/.claude/rules`,
   * `<cwd>/.claude/rules`) in the catalog. Default `false`: those files are
   * loaded in full by Claude Code at launch, so cataloguing them would let the
   * router re-inject what the host already has (double-injection). See
   * `MemhookConfig.resurfaceHostLoaded`.
   */
  resurfaceHostLoaded?: boolean;
  /** Extra `.md` source dirs to catalog alongside the built-in zones. */
  customSources?: CustomSource[];
}

interface MemoryDir {
  zoneSlug: string;
  path: string;
  isCwd: boolean;
}

export function buildCatalog(opts: CatalogBuildOptions): {
  lines: number;
  bytes: number;
} {
  const home = homedir();
  const projectsRoot = opts.projectsRoot ?? join(home, ".claude", "projects");
  const globalRulesDir = opts.globalRulesDir ?? join(home, ".claude", "rules");

  const memoryDirs = discoverMemoryDirs(projectsRoot, opts.cwd);

  const sections: string[] = [];
  sections.push(emitMemorySection("feedback", "MEMORY FEEDBACKS", memoryDirs));
  sections.push(emitMemorySection("project", "MEMORY PROJECTS", memoryDirs));
  // Global + project rules are host-autoloaded: Claude Code reads
  // `~/.claude/rules/*.md` and `<cwd>/.claude/rules/*.md` in full at launch. By
  // default memhook leaves them OUT of the catalog so the router never re-routes
  // what the host already loaded (no double-injection — it routes only the
  // not-autoloaded `feedback_*/project_*` memory). `resurfaceHostLoaded` adds
  // them back for positional re-surfacing (long sessions / no-drift projects).
  if (opts.resurfaceHostLoaded) {
    sections.push(emitRulesSection("GLOBAL RULES", globalRulesDir, true));
    sections.push(
      emitRulesSection(
        `PROJECT RULES (${pathBasename(opts.cwd)})`,
        join(opts.cwd, ".claude", "rules"),
        true,
      ),
    );
  }
  // User-declared extra sources (cable onto existing project memory). Skipped
  // when host-autoloaded unless resurfaceHostLoaded — same gate as the rules.
  const resurface = opts.resurfaceHostLoaded ?? false;
  const custom = activeCustomSources(opts.customSources ?? [], resurface);
  if (custom.length > 0) {
    sections.push(emitCustomSourcesSection(custom, resurface));
  }

  const content = sections.join("\n");
  const tmp = `${opts.outputPath}.tmp.${process.pid}`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, opts.outputPath);

  const lines = content.split("\n").length;
  const bytes = Buffer.byteLength(content, "utf8");
  return { lines, bytes };
}

function discoverMemoryDirs(projectsRoot: string, cwd: string): MemoryDir[] {
  if (!existsSync(projectsRoot)) return [];
  const out: MemoryDir[] = [];
  const cwdSlug = cwdToSlug(cwd);
  for (const entry of readdirSync(projectsRoot)) {
    const dir = join(projectsRoot, entry, "memory");
    if (!existsSync(dir)) continue;
    out.push({ zoneSlug: entry, path: dir, isCwd: entry === cwdSlug });
  }
  // CWD first for Haiku priority
  out.sort((a, b) =>
    a.isCwd === b.isCwd ? a.zoneSlug.localeCompare(b.zoneSlug) : a.isCwd ? -1 : 1,
  );
  return out;
}

function cwdToSlug(cwd: string): string {
  // ~/.claude/projects encodes a POSIX path like `/Users/you/dev/app` as
  // `-Users-you-dev-app`. On Windows, normalise backslashes first so a path
  // like `C:\Users\you\dev\app` slugifies consistently (drive-letter matching
  // is best-effort — Claude Code's Windows encoding is unverified).
  return cwd.replace(/\\/g, "/").replace(/^\//, "-").replace(/\//g, "-");
}

function emitMemorySection(
  prefix: "feedback" | "project",
  label: string,
  dirs: MemoryDir[],
): string {
  const lines: string[] = [`=== ${label} ===`];
  let total = 0;
  for (const dir of dirs) {
    const files = listMemoryFiles(dir.path, prefix);
    if (files.length === 0) continue;
    const marker = dir.isCwd ? " [CWD]" : "";
    lines.push(`--- ${dir.zoneSlug}${marker} ---`);
    for (const file of files) {
      const bn = pathBasename(file);
      if (dir.isCwd) {
        lines.push(`${bn}: ${extractDescription(file)}`);
      } else {
        lines.push(bn);
      }
    }
    total += files.length;
  }
  lines.push(`(${total} entries)`);
  lines.push("");
  return lines.join("\n");
}

function emitRulesSection(label: string, dir: string, isCwdZone: boolean): string {
  const lines: string[] = [`=== ${label} ===`];
  if (!existsSync(dir)) {
    lines.push(`(directory not found: ${dir})`);
    lines.push("");
    return lines.join("\n");
  }
  let count = 0;
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const full = join(dir, entry);
    try {
      const s = statSync(full);
      if (!s.isFile()) continue;
    } catch {
      continue;
    }
    if (isCwdZone) {
      lines.push(`${entry}: ${extractDescription(full)}`);
    } else {
      lines.push(entry);
    }
    count++;
  }
  lines.push(`(${count} entries)`);
  lines.push("");
  return lines.join("\n");
}

function emitCustomSourcesSection(sources: CustomSource[], resurfaceHostLoaded: boolean): string {
  const lines: string[] = ["=== CUSTOM SOURCES ==="];
  let total = 0;
  for (const src of sources) {
    let entries: string[];
    try {
      entries = readdirSync(src.dir);
    } catch {
      lines.push(`--- ${src.dir} (directory not found) ---`);
      continue;
    }
    // Only allowed-extension files can be injected (router SAFE_BASENAME_RE), so
    // the catalog lists only those. Shared with preset detection via
    // listMatchingFiles so the two never disagree on what a source matches.
    const files = listMatchingFiles(entries, src.glob);
    // Read each file ONCE; the content feeds both the per-file autoload skip and
    // the description (no double read). For a `perFileAutoload` source, files the
    // host already loads in full (Cursor `alwaysApply`, Windsurf `always_on`) are
    // omitted so the router can't re-inject them — unless `resurfaceHostLoaded`,
    // which re-includes them just like the source-level `hostAutoLoaded` gate.
    const emitted: { name: string; desc: string }[] = [];
    for (const f of files) {
      let content = "";
      try {
        content = readFileSync(join(src.dir, f), "utf8");
      } catch {
        content = "";
      }
      if (src.perFileAutoload && !resurfaceHostLoaded && isHostAutoloadedFile(content)) continue;
      emitted.push({ name: f, desc: extractDescriptionFromContent(content) });
    }
    if (emitted.length === 0) continue;
    lines.push(`--- ${src.dir} ---`);
    for (const e of emitted) {
      lines.push(`${e.name}: ${e.desc}`);
    }
    total += emitted.length;
  }
  lines.push(`(${total} entries)`);
  lines.push("");
  return lines.join("\n");
}

function listMemoryFiles(dir: string, prefix: "feedback" | "project"): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${prefix}_.*\\.md$`);
  return entries
    .filter((e) => re.test(e))
    .map((e) => join(dir, e))
    .sort();
}

function extractDescription(file: string): string {
  let content = "";
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return "";
  }
  return extractDescriptionFromContent(content);
}

/** Pure description extraction from file content (frontmatter `description:` else first H1). */
function extractDescriptionFromContent(content: string): string {
  // YAML frontmatter description
  if (content.startsWith("---")) {
    const end = content.indexOf("\n---", 3);
    if (end > 0) {
      const fm = content.slice(3, end);
      const descMatch = fm.match(/^description:\s*(.+?)$/m);
      if (descMatch?.[1]) {
        return descMatch[1]
          .trim()
          .replace(/^["']|["']$/g, "")
          .slice(0, 200)
          .replace(/\s+/g, " ");
      }
    }
  }
  // Fallback: first H1
  const h1 = content.match(/^# (.+)$/m);
  if (h1?.[1]) return h1[1].slice(0, 200).replace(/\s+/g, " ");
  return "";
}
