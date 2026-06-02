import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, type ProviderType } from "../src/config.js";
import { createProvider } from "../src/providers/factory.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { OllamaProvider } from "../src/providers/ollama.js";

const root = mkdtempSync(join(tmpdir(), "memhook-factory-test-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
// Guaranteed-absent config so loadConfig never picks up a real user file.
const ABSENT = join(root, "absent.yaml");

describe("createProvider", () => {
  it("builds AnthropicProvider for type anthropic", () => {
    const p = createProvider(loadConfig({ MEMHOOK_CONFIG: ABSENT }), "sk-key");
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.name).toBe("anthropic");
  });

  it("builds OpenAIProvider for type openai", () => {
    const cfg = loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_PROVIDER: "openai" });
    const p = createProvider(cfg, "sk-key");
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p.name).toBe("openai");
  });

  it("builds OllamaProvider with no apiKey (does not throw)", () => {
    const cfg = loadConfig({ MEMHOOK_CONFIG: ABSENT, MEMHOOK_PROVIDER: "ollama" });
    const p = createProvider(cfg, undefined);
    expect(p).toBeInstanceOf(OllamaProvider);
    expect(p.name).toBe("ollama");
  });

  it("throws on an unknown provider type (router catches -> fail-soft)", () => {
    const cfg = loadConfig({ MEMHOOK_CONFIG: ABSENT });
    const bad = {
      ...cfg,
      provider: { ...cfg.provider, type: "bogus" as ProviderType },
    };
    expect(() => createProvider(bad, "k")).toThrow();
  });
});
