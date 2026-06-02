import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { buildCatalog } from "../src/catalog.js";

const isWindows = process.platform === "win32";

// Mirror of catalog.ts cwdToSlug — `~/.claude/projects` encodes `/a/b/c` as `-a-b-c`.
function slugify(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/^\//, "-").replace(/\//g, "-");
}

describe("buildCatalog", () => {
  let root: string;
  let projectsRoot: string;
  let globalRulesDir: string;
  let cwd: string;
  let outputPath: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "memhook-catalog-"));
    projectsRoot = join(root, "projects");
    globalRulesDir = join(root, "rules");
    cwd = join(root, "work", "my-project");
    outputPath = join(root, "catalog.txt");

    // A non-CWD project zone (legal dir name on every OS).
    const other = join(projectsRoot, "other-project", "memory");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "feedback_other.md"), "---\ndescription: other\n---\n");
    writeFileSync(join(other, "project_other.md"), "# other project\n");

    // Global rules — description extraction (frontmatter + H1 fallback) is
    // exercised here, which works on every OS.
    mkdirSync(globalRulesDir, { recursive: true });
    writeFileSync(join(globalRulesDir, "rule-fm.md"), "---\ndescription: a global rule\n---\n");
    writeFileSync(join(globalRulesDir, "rule-h1.md"), "# H1 fallback title\nbody\n");

    // CWD zone: its directory name is cwdToSlug(cwd), which embeds the drive
    // colon on Windows (an illegal filename char), so create it only off-Windows.
    if (!isWindows) {
      const cwdZone = join(projectsRoot, slugify(cwd), "memory");
      mkdirSync(cwdZone, { recursive: true });
      writeFileSync(join(cwdZone, "feedback_cwd.md"), "---\ndescription: CWD feedback desc\n---\n");
      writeFileSync(join(cwdZone, "MEMORY.md"), "index\n");
    }
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function build(globalDir = globalRulesDir, resurfaceHostLoaded = false): string {
    const res = buildCatalog({
      cwd,
      projectsRoot,
      globalRulesDir: globalDir,
      outputPath,
      resurfaceHostLoaded,
    });
    expect(res.lines).toBeGreaterThan(0);
    expect(res.bytes).toBeGreaterThan(0);
    return readFileSync(outputPath, "utf8");
  }

  it("emits all four sections with the right headers (resurfaceHostLoaded)", () => {
    const out = build(globalRulesDir, true);
    expect(out).toContain("=== MEMORY FEEDBACKS ===");
    expect(out).toContain("=== MEMORY PROJECTS ===");
    expect(out).toContain("=== GLOBAL RULES ===");
    expect(out).toContain(`=== PROJECT RULES (${basename(cwd)}) ===`);
  });

  it("omits the host-autoloaded rule sections by default (no double-injection)", () => {
    const out = build(); // default resurfaceHostLoaded === false
    expect(out).toContain("=== MEMORY FEEDBACKS ===");
    expect(out).toContain("=== MEMORY PROJECTS ===");
    expect(out).not.toContain("=== GLOBAL RULES ===");
    expect(out).not.toContain("=== PROJECT RULES");
  });

  it("lists non-CWD zones as bare basenames (title-only, no description)", () => {
    const out = build();
    expect(out).toContain("feedback_other.md");
    expect(out).not.toContain("feedback_other.md: other");
  });

  it("derives a rule description from frontmatter, falling back to the first H1", () => {
    const out = build(globalRulesDir, true);
    expect(out).toContain("rule-fm.md: a global rule"); // frontmatter description
    expect(out).toContain("rule-h1.md: H1 fallback title"); // H1 fallback (no frontmatter)
  });

  it("emits a '(directory not found)' line for a missing rules dir instead of throwing", () => {
    const missing = join(root, "does-not-exist");
    const out = build(missing, true);
    expect(out).toContain(`(directory not found: ${missing})`);
  });

  // The CWD zone's directory name is the path slug (with a Windows drive colon),
  // so these assertions run off-Windows where that name is a legal filename.
  it.skipIf(isWindows)(
    "marks the CWD zone [CWD], lists it first, and shows its description",
    () => {
      const out = build();
      expect(out).toContain(`--- ${slugify(cwd)} [CWD] ---`);
      expect(out).toContain("feedback_cwd.md: CWD feedback desc");
      expect(out.indexOf(slugify(cwd))).toBeLessThan(out.indexOf("other-project"));
    },
  );

  it.skipIf(isWindows)("does not list MEMORY.md as a memory entry", () => {
    expect(build()).not.toContain("MEMORY.md");
  });

  it("catalogs a custom source dir (glob-matched .md only)", () => {
    const custom = join(root, "notes");
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, "note-a.md"), "---\ndescription: note A desc\n---\n");
    writeFileSync(join(custom, "skip.txt"), "not markdown\n");
    buildCatalog({
      cwd,
      projectsRoot,
      globalRulesDir,
      outputPath,
      customSources: [{ dir: custom, glob: "*.md", scope: "memory", hostAutoLoaded: false }],
    });
    const out = readFileSync(outputPath, "utf8");
    expect(out).toContain("=== CUSTOM SOURCES ===");
    expect(out).toContain(`--- ${custom} ---`);
    expect(out).toContain("note-a.md: note A desc");
    expect(out).not.toContain("skip.txt");
  });

  it("skips a host-autoloaded custom source unless resurfaceHostLoaded", () => {
    const custom = join(root, "host-notes");
    mkdirSync(custom, { recursive: true });
    writeFileSync(join(custom, "h.md"), "# host note\n");
    const opts = {
      cwd,
      projectsRoot,
      globalRulesDir,
      outputPath,
      customSources: [{ dir: custom, glob: "*.md", scope: "rules" as const, hostAutoLoaded: true }],
    };
    buildCatalog(opts);
    expect(readFileSync(outputPath, "utf8")).not.toContain("=== CUSTOM SOURCES ===");
    buildCatalog({ ...opts, resurfaceHostLoaded: true });
    expect(readFileSync(outputPath, "utf8")).toContain("h.md");
  });
});
