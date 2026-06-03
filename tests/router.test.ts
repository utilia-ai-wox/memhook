import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { route, SAFE_BASENAME_RE } from "../src/router.js";

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
  // Pin to an absent path so loadConfig never reads the real user config.yaml.
  MEMHOOK_CONFIG: join(root, "no-config.yaml"),
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

  it("ollama provider path injects with NO api key set (no no_api_key)", async () => {
    const ollamaFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            message: { content: '["feedback_alpha.md"]' },
            prompt_eval_count: 3,
            eval_count: 2,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", ollamaFetch);
    const { ANTHROPIC_API_KEY: _omit, ...noKey } = env;
    const result = await route(JSON.stringify({ prompt: "ollama-route", cwd: root }), {
      ...noKey,
      MEMHOOK_PROVIDER: "ollama",
    });
    expect(result.hookSpecificOutput.additionalContext).toContain("Content A");
    expect(ollamaFetch).toHaveBeenCalledTimes(1);
    expect(String(ollamaFetch.mock.calls[0]?.[0])).toContain("11434/api/chat");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"ok"');
    vi.unstubAllGlobals();
  });

  it("injects a file from a YAML-declared custom source dir", async () => {
    const customDir = join(root, "custom-notes");
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, "note_custom.md"), "Custom note content Z");
    const cfgPath = join(root, "custom-src.yaml");
    writeFileSync(cfgPath, `customSources:\n  - dir: ${customDir}\n    glob: "*.md"\n`);
    vi.stubGlobal("fetch", mockFetch('["note_custom.md"]'));
    const result = await route(JSON.stringify({ prompt: "custom-src", cwd: root }), {
      ...env,
      MEMHOOK_CONFIG: cfgPath,
    });
    expect(result.hookSpecificOutput.additionalContext).toContain("Custom note content Z");
    expect(result.hookSpecificOutput.additionalContext).toContain("note_custom.md");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"ok"');
    vi.unstubAllGlobals();
  });

  it("injects a file from an enabled host preset (continue)", async () => {
    const dir = join(root, ".continue", "rules");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "note_preset.md"), "Preset note content Q");
    const cfgPath = join(root, "preset.yaml");
    writeFileSync(cfgPath, `presets:\n  - continue\n`);
    vi.stubGlobal("fetch", mockFetch('["note_preset.md"]'));
    const result = await route(JSON.stringify({ prompt: "preset-src", cwd: root }), {
      ...env,
      MEMHOOK_CONFIG: cfgPath,
    });
    expect(result.hookSpecificOutput.additionalContext).toContain("Preset note content Q");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"ok"');
    vi.unstubAllGlobals();
  });

  it("injects a .mdc file from a custom source (PRE-A: widened extension flows through the guard)", async () => {
    const customDir = join(root, "cursor-rules");
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, "style.mdc"), "Cursor rule content MDC");
    const cfgPath = join(root, "mdc-src.yaml");
    writeFileSync(cfgPath, `customSources:\n  - dir: ${customDir}\n    glob: "*.mdc"\n`);
    vi.stubGlobal("fetch", mockFetch('["style.mdc"]'));
    const result = await route(JSON.stringify({ prompt: "mdc-src", cwd: root }), {
      ...env,
      MEMHOOK_CONFIG: cfgPath,
    });
    expect(result.hookSpecificOutput.additionalContext).toContain("Cursor rule content MDC");
    expect(result.hookSpecificOutput.additionalContext).toContain("style.mdc");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"ok"');
    vi.unstubAllGlobals();
  });

  it("still rejects a path-traversal basename after the extension widening (guard intact)", async () => {
    vi.stubGlobal("fetch", mockFetch('["../feedback_alpha.md"]'));
    const result = await route(JSON.stringify({ prompt: "traversal", cwd: root }), env);
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"all_unfound"');
    vi.unstubAllGlobals();
  });

  it("SAFE_BASENAME_RE: accepts clean allowed-extension basenames, rejects separators/control chars/bad ext", () => {
    // Control chars built from char codes so no literal NUL/newline lands in source.
    const NL = String.fromCharCode(10);
    const NUL = String.fromCharCode(0);
    for (const ok of ["feedback_x.md", "rule.mdc", "note.txt", "a.b-c_1.md"]) {
      expect(SAFE_BASENAME_RE.test(ok)).toBe(true);
    }
    for (const bad of [
      "../feedback.md", // traversal
      "a/b.md", // POSIX separator
      "a\\b.md", // Windows separator
      `ok.md${NL}`, // trailing newline (guard has no `m` flag)
      `evil.sh${NL}ok.md`, // smuggled newline
      `foo${NUL}.md`, // null byte
      "x.md.sh", // real extension is .sh
      "script.sh", // disallowed extension
      "data.json", // disallowed extension
      "noext", // no extension
      "", // empty
    ]) {
      expect(SAFE_BASENAME_RE.test(bad)).toBe(false);
    }
  });

  it("returns empty + status provider_init_failed when construction throws", async () => {
    // A YAML config with an empty model forces the Anthropic constructor to
    // throw; the router must catch it and fail-soft rather than crash the hook.
    const badCfg = join(root, "bad-model.yaml");
    writeFileSync(badCfg, 'provider:\n  model: ""\n');
    const result = await route(JSON.stringify({ prompt: "init-fail-unique", cwd: root }), {
      ...env,
      MEMHOOK_CONFIG: badCfg,
    });
    expect(result.hookSpecificOutput.additionalContext).toBe("");
    expect(readFileSync(logPath, "utf8")).toContain('"status":"provider_init_failed"');
  });
});
