import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";

const root = mkdtempSync(join(tmpdir(), "memhook-config-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ABSENT = join(root, "absent.yaml");
let counter = 0;
function writeYaml(content: string): string {
  const p = join(root, `cfg-${counter++}.yaml`);
  writeFileSync(p, content, "utf8");
  return p;
}

describe("loadConfig precedence (env > yaml > defaults)", () => {
  it("env-only with no yaml file -> v0.1 anthropic defaults", () => {
    const cfg = loadConfig({ MEMHOOK_CONFIG: ABSENT });
    expect(cfg.provider.type).toBe("anthropic");
    expect(cfg.provider.model).toBe("claude-haiku-4-5");
    expect(cfg.provider.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    expect(cfg.selection.curlTimeoutMs).toBe(8000);
    expect(cfg.scriptVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("yaml provider.type=openai -> openai per-provider defaults when keys omitted", () => {
    const p = writeYaml("provider:\n  type: openai\n");
    const cfg = loadConfig({ MEMHOOK_CONFIG: p });
    expect(cfg.provider.type).toBe("openai");
    expect(cfg.provider.model).toBe("gpt-4o-mini");
    expect(cfg.provider.apiKeyEnv).toBe("OPENAI_API_KEY");
  });

  it("resolves model as env > yaml > default", () => {
    const p = writeYaml("provider:\n  model: yaml-model\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p, MEMHOOK_MODEL: "env-model" }).provider.model).toBe(
      "env-model",
    );
    expect(loadConfig({ MEMHOOK_CONFIG: p }).provider.model).toBe("yaml-model");
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT }).provider.model).toBe("claude-haiku-4-5");
  });

  it("malformed yaml -> defaults, never throws", () => {
    const p = writeYaml("provider: [unclosed flow");
    expect(() => loadConfig({ MEMHOOK_CONFIG: p })).not.toThrow();
    expect(loadConfig({ MEMHOOK_CONFIG: p }).provider.type).toBe("anthropic");
  });

  it("non-object yaml root (array / scalar) -> defaults", () => {
    expect(loadConfig({ MEMHOOK_CONFIG: writeYaml("- a\n- b\n") }).provider.type).toBe("anthropic");
    expect(loadConfig({ MEMHOOK_CONFIG: writeYaml("42\n") }).provider.type).toBe("anthropic");
  });

  it("provider.type=ollama -> no apiKeyEnv + generous default timeout", () => {
    const cfg = loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_PROVIDER: "ollama" });
    expect(cfg.provider.type).toBe("ollama");
    expect(cfg.provider.apiKeyEnv).toBeUndefined();
    expect(cfg.provider.model).toBe("llama3.1");
    expect(cfg.selection.curlTimeoutMs).toBe(30000);
  });

  it("unknown provider type (env or yaml) falls back to anthropic", () => {
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_PROVIDER: "gemini" }).provider.type).toBe(
      "anthropic",
    );
    const p = writeYaml("provider:\n  type: bogus\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p }).provider.type).toBe("anthropic");
  });

  it("applies yaml tuning values when env is absent", () => {
    const p = writeYaml("selection:\n  maxFiles: 9\ncache:\n  enabled: false\n");
    const cfg = loadConfig({ MEMHOOK_CONFIG: p });
    expect(cfg.selection.maxFiles).toBe(9);
    expect(cfg.cache.enabled).toBe(false);
  });

  it("env DISABLE flag overrides yaml enabled:true", () => {
    const p = writeYaml("cache:\n  enabled: true\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p, MEMHOOK_DISABLE_CACHE: "true" }).cache.enabled).toBe(
      false,
    );
  });

  it("ignores wrong-typed yaml values (string for number, quoted bool)", () => {
    const p = writeYaml("selection:\n  maxFiles: nine\ncache:\n  enabled: 'false'\n");
    const cfg = loadConfig({ MEMHOOK_CONFIG: p });
    expect(cfg.selection.maxFiles).toBe(5); // "nine" ignored -> default
    expect(cfg.cache.enabled).toBe(true); // quoted 'false' is a string -> default
  });

  it("coerces a non-array betaHeaders to [] (no crash downstream)", () => {
    const p = writeYaml("provider:\n  betaHeaders: oops\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p }).provider.betaHeaders).toEqual([]);
    const p2 = writeYaml("provider:\n  betaHeaders:\n    - a\n    - 1\n    - b\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p2 }).provider.betaHeaders).toEqual(["a", "b"]);
  });

  it("treats a present-but-empty env var as absent (falls through, never 0/empty)", () => {
    const p = writeYaml("selection:\n  maxFiles: 7\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p, MEMHOOK_MAX_FILES: "" }).selection.maxFiles).toBe(7);
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_MAX_FILES: "  " }).selection.maxFiles).toBe(
      5,
    );
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_MODEL: "" }).provider.model).toBe(
      "claude-haiku-4-5",
    );
  });

  it("rejects degenerate numeric values (negative, zero, NaN) -> default", () => {
    // 0ms timeout would abort every request; negative caps break comparisons.
    expect(
      loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_TIMEOUT_MS: "0" }).selection.curlTimeoutMs,
    ).toBe(8000);
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_MAX_FILES: "-1" }).selection.maxFiles).toBe(
      5,
    );
    expect(
      loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_MAX_FILES: "abc" }).selection.maxFiles,
    ).toBe(5);
    const p = writeYaml("selection:\n  maxFiles: 0\n");
    expect(loadConfig({ MEMHOOK_CONFIG: p }).selection.maxFiles).toBe(5);
  });

  it("floors a fractional numeric value", () => {
    expect(
      loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_MAX_FILES: "2.9" }).selection.maxFiles,
    ).toBe(2);
  });

  it("accepts a wider, case-insensitive boolean vocabulary (true/1/yes/on)", () => {
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_ENABLED: "yes" }).enabled).toBe(true);
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_ENABLED: "TRUE" }).enabled).toBe(true);
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_ENABLED: "off" }).enabled).toBe(false);
    // DISABLE flags honour the same vocabulary.
    expect(loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_DISABLE_CACHE: "on" }).cache.enabled).toBe(
      false,
    );
  });
});
