import { describe, it, expect, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybeCurateNudge, route } from "../src/router.js";
import { loadConfig } from "../src/config.js";

const root = mkdtempSync(join(tmpdir(), "memhook-nudge-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** Build an isolated config with its own cache dir + projects root. */
function makeConfig(extra: NodeJS.ProcessEnv = {}) {
  const id = `c${seq++}`;
  const cacheDir = join(root, id, "cache");
  const projectsRoot = join(root, id, "projects");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(projectsRoot, { recursive: true });
  const env = {
    MEMHOOK_CACHE_DIR: cacheDir,
    MEMHOOK_PROJECTS_ROOT: projectsRoot,
    MEMHOOK_GLOBAL_RULES_DIR: join(root, id, "rules"),
    MEMHOOK_CONFIG: join(root, "no-config.yaml"),
    ...extra,
  } as NodeJS.ProcessEnv;
  return { config: loadConfig(env), cacheDir, projectsRoot };
}

function addMemoryFiles(projectsRoot: string, project: string, count: number) {
  const dir = join(projectsRoot, project, "memory");
  mkdirSync(dir, { recursive: true });
  for (let i = 0; i < count; i++) {
    writeFileSync(join(dir, `feedback_${i}.md`), `# m${i}\n`);
  }
  return dir;
}

const NOW = 1_900_000_000_000; // fixed, deterministic clock

describe("maybeCurateNudge", () => {
  it("fires when the catalog exceeds the token threshold", () => {
    const { config } = makeConfig();
    const bigCatalog = "x".repeat(80_000); // ~20k tokens, over the 15k default
    const msg = maybeCurateNudge(config, bigCatalog, NOW);
    expect(msg).toBeDefined();
    expect(msg).toContain("/curate");
    expect(msg).toContain("tokens");
  });

  it("fires on file count when the catalog is small", () => {
    const { config, projectsRoot } = makeConfig({ MEMHOOK_CURATE_NUDGE_FILES: "3" });
    addMemoryFiles(projectsRoot, "proj", 4);
    const msg = maybeCurateNudge(config, "tiny catalog", NOW);
    expect(msg).toBeDefined();
    expect(msg).toContain("4 files");
  });

  it("excludes MEMORY.md and the journal/ subdir from the file count", () => {
    const { config, projectsRoot } = makeConfig({ MEMHOOK_CURATE_NUDGE_FILES: "2" });
    const dir = addMemoryFiles(projectsRoot, "proj", 2); // 2 topic files
    writeFileSync(join(dir, "MEMORY.md"), "# index\n"); // excluded
    mkdirSync(join(dir, "journal"), { recursive: true });
    writeFileSync(join(dir, "journal", "2026-06-02.md"), "# log\n"); // excluded (subdir)
    const msg = maybeCurateNudge(config, "tiny", NOW);
    // Exactly 2 topic files → fires with "2 files", proving the exclusions held.
    expect(msg).toContain("2 files");
  });

  it("stays silent below both thresholds", () => {
    const { config, projectsRoot } = makeConfig();
    addMemoryFiles(projectsRoot, "proj", 3); // well under 250
    expect(maybeCurateNudge(config, "small catalog", NOW)).toBeUndefined();
  });

  it("respects the cooldown after firing", () => {
    const { config } = makeConfig();
    const big = "x".repeat(80_000);
    expect(maybeCurateNudge(config, big, NOW)).toBeDefined(); // fires + stamps
    expect(maybeCurateNudge(config, big, NOW + 1000)).toBeUndefined(); // within cooldown
    const eightDays = 8 * 86_400_000;
    expect(maybeCurateNudge(config, big, NOW + eightDays)).toBeDefined(); // cooldown elapsed
  });

  it("writes the cooldown stamp on fire", () => {
    const { config, cacheDir } = makeConfig();
    maybeCurateNudge(config, "x".repeat(80_000), NOW);
    expect(existsSync(join(cacheDir, ".curate-nudge"))).toBe(true);
    expect(readFileSync(join(cacheDir, ".curate-nudge"), "utf8").trim()).toBe(String(NOW));
  });

  it("stays silent when disabled", () => {
    const { config } = makeConfig({ MEMHOOK_CURATE_NUDGE: "false" });
    expect(maybeCurateNudge(config, "x".repeat(80_000), NOW)).toBeUndefined();
  });

  it("never throws (fail-soft) even with a bogus projects root", () => {
    const { config } = makeConfig({ MEMHOOK_PROJECTS_ROOT: "/no/such/path/at/all" });
    expect(() => maybeCurateNudge(config, "x".repeat(80_000), NOW)).not.toThrow();
  });
});

// ── the nudge flows through route() as an additive systemMessage ─────────────

describe("route() systemMessage", () => {
  function routeEnv(catalog: string, extra: NodeJS.ProcessEnv = {}) {
    const id = `r${seq++}`;
    const base = join(root, id);
    const projectsDir = join(base, "projects", "myrepo", "memory");
    const cacheDir = join(base, "cache");
    const catalogPath = join(base, "memory-catalog.txt");
    const logPath = join(base, "memhook.log");
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(projectsDir, "feedback_alpha.md"), "# Alpha\n\nContent A");
    writeFileSync(catalogPath, catalog);
    return {
      env: {
        MEMHOOK_ENABLED: "true",
        ANTHROPIC_API_KEY: "sk-test",
        MEMHOOK_CATALOG_PATH: catalogPath,
        MEMHOOK_CACHE_DIR: cacheDir,
        MEMHOOK_LOG_PATH: logPath,
        MEMHOOK_TRIVIAL_FILE: join(base, "no-trivial.txt"),
        MEMHOOK_PROJECTS_ROOT: join(base, "projects"),
        MEMHOOK_GLOBAL_RULES_DIR: join(base, "rules"),
        MEMHOOK_CONFIG: join(base, "no-config.yaml"),
        ...extra,
      } as NodeJS.ProcessEnv,
      base,
    };
  }

  const mockFetch = (text: string) =>
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ text }],
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

  it("attaches systemMessage when the catalog is large", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    const big = "feedback_alpha.md: alpha\n" + "x".repeat(80_000);
    const { env, base } = routeEnv(big);
    const out = await route(JSON.stringify({ prompt: "alpha", cwd: base }), env);
    expect(out.systemMessage).toBeDefined();
    expect(out.systemMessage).toContain("/curate");
    // The injection contract is untouched.
    expect(out.hookSpecificOutput.additionalContext).toContain("Content A");
    vi.unstubAllGlobals();
  });

  it("omits systemMessage for a small catalog", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    const { env, base } = routeEnv("feedback_alpha.md: alpha\n");
    const out = await route(JSON.stringify({ prompt: "alpha", cwd: base }), env);
    expect(out.systemMessage).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("omits systemMessage when the nudge is disabled", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    const big = "feedback_alpha.md: alpha\n" + "x".repeat(80_000);
    const { env, base } = routeEnv(big, { MEMHOOK_CURATE_NUDGE: "false" });
    const out = await route(JSON.stringify({ prompt: "alpha", cwd: base }), env);
    expect(out.systemMessage).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
