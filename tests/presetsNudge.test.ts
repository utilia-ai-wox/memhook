import { describe, it, expect, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { maybePresetsNudge, route } from "../src/router.js";
import { loadConfig } from "../src/config.js";

const root = mkdtempSync(join(tmpdir(), "memhook-presets-nudge-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let seq = 0;
/** Isolated config with its own cache dir, plus a fresh empty cwd + home pair. */
function makeCase(extra: NodeJS.ProcessEnv = {}) {
  const id = `c${seq++}`;
  const cacheDir = join(root, id, "cache");
  const cwd = join(root, id, "cwd");
  const home = join(root, id, "home");
  mkdirSync(cacheDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(home, { recursive: true });
  const env = {
    MEMHOOK_CACHE_DIR: cacheDir,
    MEMHOOK_PROJECTS_ROOT: join(root, id, "projects"),
    MEMHOOK_GLOBAL_RULES_DIR: join(root, id, "rules"),
    MEMHOOK_CONFIG: join(root, "no-config.yaml"),
    ...extra,
  } as NodeJS.ProcessEnv;
  return { config: loadConfig(env), cacheDir, cwd, home };
}

/** Create the `continue` preset's project memory dir (`.continue/rules/*.md`). */
function addContinueMemory(cwd: string): void {
  const dir = join(cwd, ".continue", "rules");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "style.md"), "# style\n");
}

const NOW = 1_900_000_000_000; // fixed, deterministic clock

describe("maybePresetsNudge", () => {
  it("fires when a known host's memory exists in the project and isn't routed", () => {
    const { config, cwd, home } = makeCase();
    addContinueMemory(cwd);
    const msg = maybePresetsNudge(config, cwd, home, NOW);
    expect(msg).toBeDefined();
    expect(msg).toContain("continue");
    expect(msg).toContain("memhook presets detect");
  });

  it("stays silent when the preset is already routed by config.presets", () => {
    const { config, cwd, home } = makeCase();
    addContinueMemory(cwd);
    config.presets = ["continue"]; // user already enabled it → nothing to suggest
    expect(maybePresetsNudge(config, cwd, home, NOW)).toBeUndefined();
  });

  it("stays silent when the dir is already routed via customSources", () => {
    const { config, cwd, home } = makeCase();
    addContinueMemory(cwd);
    // User cabled the exact dir by hand instead of using the `continue` name —
    // `presets:` is just sugar over `customSources`, so the memory IS routed.
    config.customSources = [
      { dir: join(cwd, ".continue", "rules"), glob: "*.md", scope: "rules", hostAutoLoaded: false },
    ];
    expect(maybePresetsNudge(config, cwd, home, NOW)).toBeUndefined();
  });

  it("fires on a home-only match without claiming a project scope", () => {
    const { config, cwd, home } = makeCase();
    // Memory lives in the global home dir, not the project cwd.
    const dir = join(home, ".continue", "rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "global.md"), "# global\n");
    const msg = maybePresetsNudge(config, cwd, home, NOW);
    expect(msg).toBeDefined();
    expect(msg).toContain("continue");
    expect(msg).not.toContain("in this project");
  });

  it("stays silent when no known host memory exists", () => {
    const { config, cwd, home } = makeCase();
    expect(maybePresetsNudge(config, cwd, home, NOW)).toBeUndefined();
  });

  it("respects the cooldown after firing", () => {
    const { config, cwd, home } = makeCase();
    addContinueMemory(cwd);
    expect(maybePresetsNudge(config, cwd, home, NOW)).toBeDefined(); // fires + stamps
    expect(maybePresetsNudge(config, cwd, home, NOW + 1000)).toBeUndefined(); // within cooldown
    const eightDays = 8 * 86_400_000;
    expect(maybePresetsNudge(config, cwd, home, NOW + eightDays)).toBeDefined(); // elapsed
  });

  it("writes a per-cwd cooldown stamp on fire", () => {
    const { config, cacheDir, cwd, home } = makeCase();
    addContinueMemory(cwd);
    maybePresetsNudge(config, cwd, home, NOW);
    const stamp = readdirSync(cacheDir).find((f) => f.startsWith(".presets-nudge-"));
    expect(stamp).toBeDefined();
    expect(readFileSync(join(cacheDir, stamp as string), "utf8").trim()).toBe(String(NOW));
  });

  it("stays silent when disabled", () => {
    const { config, cwd, home } = makeCase({ MEMHOOK_PRESETS_NUDGE: "false" });
    addContinueMemory(cwd);
    expect(maybePresetsNudge(config, cwd, home, NOW)).toBeUndefined();
  });

  it("never throws (fail-soft) even with bogus cwd/home", () => {
    const { config } = makeCase();
    expect(() => maybePresetsNudge(config, "/no/such/cwd", "/no/such/home", NOW)).not.toThrow();
  });
});

// ── the nudge flows through route() as an additive systemMessage ─────────────

describe("route() presets nudge", () => {
  function routeEnv(extra: NodeJS.ProcessEnv = {}) {
    const id = `r${seq++}`;
    const base = join(root, id);
    const projectsDir = join(base, "projects", "myrepo", "memory");
    const cacheDir = join(base, "cache");
    const catalogPath = join(base, "memory-catalog.txt");
    const logPath = join(base, "memhook.log");
    mkdirSync(projectsDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(projectsDir, "feedback_alpha.md"), "# Alpha\n\nContent A");
    writeFileSync(catalogPath, "feedback_alpha.md: alpha\n"); // small → /curate stays quiet
    addContinueMemory(base); // base is the cwd we pass below
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

  it("attaches the presets nudge when unrouted host memory is in the cwd", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    const { env, base } = routeEnv();
    const out = await route(JSON.stringify({ prompt: "alpha", cwd: base }), env);
    expect(out.systemMessage).toBeDefined();
    expect(out.systemMessage).toContain("continue");
    expect(out.systemMessage).toContain("memhook presets detect");
    // The injection contract is untouched.
    expect(out.hookSpecificOutput.additionalContext).toContain("Content A");
    vi.unstubAllGlobals();
  });

  it("omits the presets nudge when disabled", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    const { env, base } = routeEnv({ MEMHOOK_PRESETS_NUDGE: "false" });
    const out = await route(JSON.stringify({ prompt: "alpha", cwd: base }), env);
    expect(out.systemMessage).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("lets the /curate nudge win when both would fire (single channel)", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    // Large catalog → /curate fires; preset memory is also present, but the
    // curate nudge takes the single systemMessage channel.
    const { env, base } = routeEnv();
    const big = join(base, "memory-catalog.txt");
    writeFileSync(big, "feedback_alpha.md: alpha\n" + "x".repeat(80_000));
    const out = await route(JSON.stringify({ prompt: "alpha", cwd: base }), env);
    expect(out.systemMessage).toContain("/curate");
    expect(out.systemMessage).not.toContain("presets detect");
    vi.unstubAllGlobals();
  });
});
