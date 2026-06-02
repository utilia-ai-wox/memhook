import { describe, it, expect } from "vitest";
import { makeAnsi } from "../src/ansi.js";
import {
  parseLogLine,
  formatRow,
  formatTime,
  formatLatency,
  modelCell,
  emptyStats,
  accumulate,
  summarize,
  tailLines,
  type LogRow,
} from "../src/tail.js";

const plain = makeAnsi({ isTTY: false, env: {} });

function row(over: Partial<LogRow> = {}): LogRow {
  return {
    ts: "2026-06-02T12:04:01Z",
    promptPreview: "auth flow",
    selected: [],
    latencyMs: 142,
    tokensIn: 10,
    tokensOut: 5,
    status: "ok",
    model: "claude-haiku-4-5",
    ...over,
  };
}

describe("parseLogLine", () => {
  it("parses a full router log line", () => {
    const line = JSON.stringify({
      ts: "2026-06-02T12:04:01Z",
      prompt_preview: "hello",
      selected: ["feedback_x.md"],
      latency_ms: 99,
      tokens_in: 3,
      tokens_out: 1,
      status: "ok",
      model: "claude-haiku-4-5",
    });
    const r = parseLogLine(line)!;
    expect(r.status).toBe("ok");
    expect(r.selected).toEqual(["feedback_x.md"]);
    expect(r.latencyMs).toBe(99);
    expect(r.model).toBe("claude-haiku-4-5");
  });

  it("rejects malformed / non-object / status-less lines", () => {
    expect(parseLogLine("{bad json")).toBeNull();
    expect(parseLogLine("[]")).toBeNull();
    expect(parseLogLine("42")).toBeNull();
    expect(parseLogLine(JSON.stringify({ foo: 1 }))).toBeNull();
  });

  it("tolerates an old line with no model field", () => {
    const r = parseLogLine(JSON.stringify({ ts: "x", status: "ok" }))!;
    expect(r.model).toBeNull();
    expect(r.selected).toEqual([]);
    expect(r.latencyMs).toBe(0);
  });
});

describe("cell formatters", () => {
  it("formatTime extracts HH:MM:SS, falls back gracefully", () => {
    expect(formatTime("2026-06-02T12:04:01Z")).toBe("12:04:01");
    expect(formatTime("garbage").length).toBeGreaterThanOrEqual(7);
  });

  it("formatLatency is compact", () => {
    expect(formatLatency(142)).toBe("142ms");
    expect(formatLatency(2000)).toBe("2.0s");
    expect(formatLatency(0)).toBe("0ms");
  });

  it("modelCell mirrors the mockup semantics", () => {
    expect(modelCell(row({ status: "pre_filter_skip" }))).toBe("dropped");
    expect(modelCell(row({ status: "cache_hit" }))).toBe("—");
    expect(modelCell(row({ status: "no_api_key" }))).toBe("—");
    expect(modelCell(row({ status: "ok" }))).toBe("claude-haiku-4-5");
    expect(modelCell(row({ status: "ok", model: null }))).toBe("—");
  });
});

describe("formatRow", () => {
  it("renders the primary columns (colour disabled)", () => {
    const out = formatRow(row(), plain, 80);
    expect(out).toContain("12:04:01");
    expect(out).toContain("ok");
    expect(out).toContain('"auth flow"');
    expect(out).toContain("142ms");
    expect(out).toContain("claude-haiku-4-5");
    expect(out).not.toContain("\n"); // no second line without memories
  });

  it("adds a dim second line listing the injected memories (.md stripped)", () => {
    const out = formatRow(
      row({ selected: ["feedback_discuss_then_do.md", "cif-cgp-metier-definition.md"] }),
      plain,
      80,
    );
    expect(out).toContain("\n");
    expect(out).toContain("↳");
    expect(out).toContain("discuss_then_do");
    expect(out).toContain("cif-cgp-metier-definition");
    expect(out).not.toContain(".md");
  });
});

describe("stats", () => {
  it("counts, cache %, and percentiles", () => {
    const s = emptyStats();
    [
      row({ status: "ok", latencyMs: 100 }),
      row({ status: "cache_hit", latencyMs: 2 }),
      row({ status: "ok", latencyMs: 300 }),
      row({ status: "pre_filter_skip", latencyMs: 0 }),
    ].forEach((r) => accumulate(s, r));
    const sum = summarize(s);
    expect(sum.count).toBe(4);
    // delivered = ok(2) + cache(1) = 3; cache share = 1/3 ≈ 33%
    expect(sum.cachePct).toBe(33);
    expect(sum.okPct).toBe(75); // 3 of 4 delivered something
    // latencies (>0): [100, 2, 300] → sorted [2,100,300]; p50 → 100, p95 → 300
    expect(sum.p50).toBe(100);
    expect(sum.p95).toBe(300);
  });

  it("summarises an empty run without dividing by zero", () => {
    const sum = summarize(emptyStats());
    expect(sum).toEqual({ count: 0, cachePct: 0, okPct: 0, p50: 0, p95: 0 });
  });
});

describe("tailLines", () => {
  it("returns the last n non-empty lines", () => {
    const text = "a\nb\n\nc\n";
    expect(tailLines(text, 2)).toEqual(["b", "c"]);
    expect(tailLines(text, 10)).toEqual(["a", "b", "c"]);
    expect(tailLines("", 5)).toEqual([]);
  });
});
