import { describe, it, expect } from "vitest";
import { buildConfigObject, backupPath } from "../src/init.js";

describe("buildConfigObject", () => {
  it("writes nothing for the anthropic default", () => {
    expect(buildConfigObject({ provider: "anthropic" })).toBeNull();
    // The default key env for anthropic is omitted as redundant.
    expect(buildConfigObject({ provider: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY" })).toBeNull();
  });

  it("emits the provider type for non-default providers", () => {
    expect(buildConfigObject({ provider: "openai" })).toEqual({ provider: { type: "openai" } });
    expect(buildConfigObject({ provider: "ollama" })).toEqual({ provider: { type: "ollama" } });
  });

  it("includes a model override and a non-default key env", () => {
    expect(buildConfigObject({ provider: "anthropic", model: "claude-x" })).toEqual({
      provider: { model: "claude-x" },
    });
    expect(buildConfigObject({ provider: "openai", apiKeyEnv: "MY_KEY" })).toEqual({
      provider: { type: "openai", apiKeyEnv: "MY_KEY" },
    });
    // A key env that equals the provider default is dropped.
    expect(buildConfigObject({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" })).toEqual({
      provider: { type: "openai" },
    });
  });
});

describe("backupPath", () => {
  it("stamps the backup next to the original", () => {
    expect(backupPath("/a/settings.json", "2026-06-02T10-00-00Z")).toBe(
      "/a/settings.json.bak-2026-06-02T10-00-00Z",
    );
  });
});
