import { describe, it, expect } from "vitest";
import { PreFilter } from "../src/preFilter.js";

describe("PreFilter", () => {
  const filter = new PreFilter(undefined, ["ok", "oui", "vasy", "merci"]);

  it("matches exact trivial words", () => {
    expect(filter.isTrivial("ok")).toBe(true);
    expect(filter.isTrivial("oui")).toBe(true);
    expect(filter.isTrivial("merci")).toBe(true);
  });

  it("strips punctuation and whitespace before matching", () => {
    expect(filter.isTrivial("OK!")).toBe(true);
    expect(filter.isTrivial("  oui.")).toBe(true);
    expect(filter.isTrivial("vas-y")).toBe(true);
  });

  it("returns false on multi-word non-trivial prompts", () => {
    expect(filter.isTrivial("continue le job")).toBe(false);
    expect(filter.isTrivial("fix the bug")).toBe(false);
  });

  it("returns true on empty/whitespace-only prompts", () => {
    expect(filter.isTrivial("")).toBe(true);
    expect(filter.isTrivial("   ")).toBe(true);
  });
});
