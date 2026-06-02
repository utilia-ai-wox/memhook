import { describe, it, expect } from "vitest";
import { claudeCodeAdapter } from "../src/adapters/claudeCode.js";
import type { RouteResult } from "../src/adapters/types.js";

describe("claudeCodeAdapter.parseInput", () => {
  it("parses a well-formed hook envelope into {prompt, cwd}", () => {
    const input = claudeCodeAdapter.parseInput(
      JSON.stringify({ prompt: "hello", cwd: "/repo", hook_event_name: "UserPromptSubmit" }),
    );
    expect(input).toEqual({ prompt: "hello", cwd: "/repo" });
  });

  it("omits cwd when the host did not send one (exactOptionalPropertyTypes)", () => {
    const input = claudeCodeAdapter.parseInput(JSON.stringify({ prompt: "hello" }));
    expect(input).toEqual({ prompt: "hello" });
    expect(input && "cwd" in input).toBe(false);
  });

  it("omits a non-string cwd rather than passing it through", () => {
    const input = claudeCodeAdapter.parseInput(JSON.stringify({ prompt: "hi", cwd: 123 }));
    expect(input).toEqual({ prompt: "hi" });
  });

  it("keeps an empty-string prompt (the pipeline core rejects it, not the adapter)", () => {
    expect(claudeCodeAdapter.parseInput(JSON.stringify({ prompt: "" }))).toEqual({ prompt: "" });
  });

  it("returns null for unparseable JSON", () => {
    expect(claudeCodeAdapter.parseInput("not json")).toBeNull();
    expect(claudeCodeAdapter.parseInput("")).toBeNull();
  });

  it("returns null for non-object payloads (null, number, string, array)", () => {
    expect(claudeCodeAdapter.parseInput("null")).toBeNull();
    expect(claudeCodeAdapter.parseInput("42")).toBeNull();
    expect(claudeCodeAdapter.parseInput('"hi"')).toBeNull();
    expect(claudeCodeAdapter.parseInput("[]")).toBeNull();
  });

  it("returns null when prompt is missing or not a string", () => {
    expect(claudeCodeAdapter.parseInput(JSON.stringify({ cwd: "/x" }))).toBeNull();
    expect(claudeCodeAdapter.parseInput(JSON.stringify({ prompt: 5 }))).toBeNull();
  });
});

describe("claudeCodeAdapter.formatOutput", () => {
  it("wraps additionalContext in the Claude Code envelope, no systemMessage by default", () => {
    const out = claudeCodeAdapter.formatOutput({ additionalContext: "ctx" });
    expect(out).toEqual({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: "ctx" },
    });
    expect("systemMessage" in out).toBe(false);
  });

  it("an empty result serialises byte-identically to the legacy EMPTY shape", () => {
    const out = claudeCodeAdapter.formatOutput({ additionalContext: "" });
    // The exact JSON the hook emitted before the adapter refactor.
    expect(JSON.stringify(out)).toBe(
      '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":""}}',
    );
  });

  it("includes systemMessage only when the result carries one (the /curate nudge)", () => {
    const result: RouteResult = { additionalContext: "ctx", systemMessage: "📚 nudge" };
    const out = claudeCodeAdapter.formatOutput(result);
    expect(out.systemMessage).toBe("📚 nudge");
    expect(out.hookSpecificOutput.additionalContext).toBe("ctx");
  });
});

describe("claudeCodeAdapter identity", () => {
  it("has the stable id 'claude-code'", () => {
    expect(claudeCodeAdapter.id).toBe("claude-code");
  });
});
