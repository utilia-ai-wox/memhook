import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { buildCatalog } from "../src/catalog.js";

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

    // CWD project zone — its dir name must equal cwdToSlug(cwd) to be marked [CWD].
    const cwdZone = join(projectsRoot, slugify(cwd), "memory");
    mkdirSync(cwdZone, { recursive: true });
    writeFileSync(
      join(cwdZone, "feedback_cwd.md"),
      "---\ndescription: CWD feedback desc\n---\nbody\n",
    );
    writeFileSync(join(cwdZone, "project_cwd.md"), "# CWD project H1 title\nbody\n");
    writeFileSync(join(cwdZone, "MEMORY.md"), "index\n");

    // A second, non-CWD project zone.
    const other = join(projectsRoot, "other-project", "memory");
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, "feedback_other.md"), "---\ndescription: other\n---\n");
    writeFileSync(join(other, "project_other.md"), "# other project\n");

    // Global rules.
    mkdirSync(globalRulesDir, { recursive: true });
    writeFileSync(join(globalRulesDir, "rule-global.md"), "---\ndescription: a global rule\n---\n");

    // CWD project rules.
    const projRules = join(cwd, ".claude", "rules");
    mkdirSync(projRules, { recursive: true });
    writeFileSync(join(projRules, "rule-proj.md"), "# Project rule title\n");
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function build(globalDir = globalRulesDir): string {
    const res = buildCatalog({ cwd, projectsRoot, globalRulesDir: globalDir, outputPath });
    expect(res.lines).toBeGreaterThan(0);
    expect(res.bytes).toBeGreaterThan(0);
    return readFileSync(outputPath, "utf8");
  }

  it("emits all four sections with the right headers", () => {
    const out = build();
    expect(out).toContain("=== MEMORY FEEDBACKS ===");
    expect(out).toContain("=== MEMORY PROJECTS ===");
    expect(out).toContain("=== GLOBAL RULES ===");
    expect(out).toContain(`=== PROJECT RULES (${basename(cwd)}) ===`);
  });

  it("marks the CWD zone [CWD], lists it first, and shows descriptions for CWD entries only", () => {
    const out = build();
    expect(out).toContain(`--- ${slugify(cwd)} [CWD] ---`);
    expect(out).toContain("feedback_cwd.md: CWD feedback desc");
    // Non-CWD entries are bare basenames (title-only, ~50% size reduction).
    expect(out).toContain("feedback_other.md");
    expect(out).not.toContain("feedback_other.md: other");
    // CWD-first ordering.
    expect(out.indexOf(slugify(cwd))).toBeLessThan(out.indexOf("other-project"));
  });

  it("derives a description from frontmatter, falling back to the first H1", () => {
    const out = build();
    expect(out).toContain("project_cwd.md: CWD project H1 title"); // H1 fallback (no frontmatter)
    expect(out).toContain("rule-global.md: a global rule"); // global rules carry descriptions
  });

  it("does not list MEMORY.md as a memory entry", () => {
    expect(build()).not.toContain("MEMORY.md");
  });

  it("emits a '(directory not found)' line for a missing rules dir instead of throwing", () => {
    const missing = join(root, "does-not-exist");
    const out = build(missing);
    expect(out).toContain(`(directory not found: ${missing})`);
  });
});
