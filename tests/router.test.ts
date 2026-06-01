import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route } from "../src/router.js";

const root = mkdtempSync(join(tmpdir(), "memhook-router-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const projectsDir = join(root, "projects", "myrepo", "memory");
const rulesDir = join(root, "rules");
const cacheDir = join(root, "cache");
const catalogPath = join(root, "memory-catalog.txt");
const logPath = join(root, "memhook.log");

mkdirSync(projectsDir, { recursive: true });
mkdirSync(rulesDir, { recursive: true });
mkdirSync(cacheDir, { recursive: true });
writeFileSync(join(projectsDir, "feedback_alpha.md"), "# Alpha feedback\n\nContent A");
writeFileSync(join(projectsDir, "project_beta.md"), "# Beta project\n\nContent B");
writeFileSync(
  catalogPath,
  "=== MEMORY FEEDBACKS ===\nfeedback_alpha.md: alpha desc\n=== MEMORY PROJECTS ===\nproject_beta.md: beta desc\n",
);

const env = {
  MEMHOOK_ENABLED: "true",
  ANTHROPIC_API_KEY: "sk-test-router",
  MEMHOOK_CATALOG_PATH: catalogPath,
  MEMHOOK_CACHE_DIR: cacheDir,
  MEMHOOK_LOG_PATH: logPath,
  MEMHOOK_TRIVIAL_FILE: join(root, "no-such-file.txt"),
  MEMHOOK_PROJECTS_ROOT: join(root, "projects"),
  MEMHOOK_GLOBAL_RULES_DIR: rulesDir,
} as NodeJS.ProcessEnv;

function mockFetch(
  textResponse: string,
  usage = {
    input_tokens: 10,
    output_tokens: 5,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  },
) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ content: [{ text: textResponse }], usage }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
}

describe("router", () => {
  beforeEach(() => {
    if (existsSync(logPath)) rmSync(logPath);
    for (const f of ["feedback_alpha.md.json", "project_beta.md.json"]) {
      const file = join(cacheDir, f);
      if (existsSync(file)) rmSync(file);
    }
  });

  it("returns empty when disabled", async () => {
    const result = await route('{"prompt":"x"}', {
      ...env,
      MEMHOOK_ENABLED: "false",
    });
    expect(result.hookSpecificOutput.additionalContext).toBe("");
  });

  it("returns empty + status pre_filter_skip for trivial prompt", async () => {
    const result = await route('{"prompt":"ok"}', env);
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain('"status":"pre_filter_skip"');
  });

  it("returns empty + status no_api_key when key absent", async () => {
    const { ANTHROPIC_API_KEY: _omit, ...envSansKey } = env;
    const result = await route('{"prompt":"real question"}', envSansKey);
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"no_api_key"');
  });

  it("returns empty + status no_catalog when catalog missing", async () => {
    const result = await route('{"prompt":"real question"}', {
      ...env,
      MEMHOOK_CATALOG_PATH: join(root, "absent.txt"),
    });
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"no_catalog"');
  });

  it("injects file content on successful Haiku selection", async () => {
    vi.stubGlobal("fetch", mockFetch('["feedback_alpha.md"]'));
    const result = await route(JSON.stringify({ prompt: "alpha", cwd: root }), env);
    expect(result.hookSpecificOutput.additionalContext).toContain("Content A");
    expect(result.hookSpecificOutput.additionalContext).toContain("feedback_alpha.md");
    const log = readFileSync(logPath, "utf8");
    expect(log).toContain('"status":"ok"');
    vi.unstubAllGlobals();
  });

  it("serves the second identical request from the local cache", async () => {
    const fetchSpy = mockFetch('["feedback_alpha.md"]');
    vi.stubGlobal("fetch", fetchSpy);
    const stdin = JSON.stringify({ prompt: "alpha-cache", cwd: root });
    await route(stdin, env);
    await route(stdin, env);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const lastLine = readFileSync(logPath, "utf8").trim().split("\n").pop()!;
    expect(lastLine).toContain('"status":"cache_hit"');
    vi.unstubAllGlobals();
  });

  it("returns empty + status all_unfound when Haiku invents a basename", async () => {
    vi.stubGlobal("fetch", mockFetch('["nonexistent.md"]'));
    const result = await route(JSON.stringify({ prompt: "unfound", cwd: root }), env);
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"all_unfound"');
    vi.unstubAllGlobals();
  });

  it("returns empty + status empty_selection when Haiku returns []", async () => {
    vi.stubGlobal("fetch", mockFetch("[]"));
    const result = await route(JSON.stringify({ prompt: "empty", cwd: root }), env);
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"empty_selection"');
    vi.unstubAllGlobals();
  });

  it("cap-A1: stops before injecting a file that would overflow maxAdditionalChars (always allows >=1)", async () => {
    const big = "x".repeat(2500);
    writeFileSync(join(projectsDir, "feedback_one.md"), big);
    writeFileSync(join(projectsDir, "feedback_two.md"), big);
    writeFileSync(join(projectsDir, "feedback_three.md"), big);
    vi.stubGlobal("fetch", mockFetch('["feedback_one.md","feedback_two.md","feedback_three.md"]'));
    const capEnv = { ...env, MEMHOOK_MAX_ADDITIONAL_CHARS: "3000" };
    const result = await route(JSON.stringify({ prompt: "cap-test", cwd: root }), capEnv);
    const add = result.hookSpecificOutput.additionalContext;
    expect(add.length).toBeGreaterThan(2500);
    expect(add.length).toBeLessThan(3000);
    expect(add).toContain("feedback_one.md");
    expect(add).not.toContain("feedback_two.md");
    vi.unstubAllGlobals();
  });
});
