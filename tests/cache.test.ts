import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { LocalCache } from "../src/cache.js";
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "memhook-cache-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("LocalCache", () => {
  let cache: LocalCache;
  beforeEach(() => {
    cache = new LocalCache(dir, 60, 7);
  });

  it("derives a stable hex key from inputs", () => {
    const a = cache.key({
      prompt: "x",
      catalogMtimeMs: 1,
      cwd: "/y",
      scriptVersion: "v1",
      provider: "anthropic:m",
    });
    const b = cache.key({
      prompt: "x",
      catalogMtimeMs: 1,
      cwd: "/y",
      scriptVersion: "v1",
      provider: "anthropic:m",
    });
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the key when any input changes", () => {
    const base = {
      prompt: "x",
      catalogMtimeMs: 1,
      cwd: "/y",
      scriptVersion: "v1",
      provider: "anthropic:m",
    };
    const k0 = cache.key(base);
    expect(cache.key({ ...base, prompt: "y" })).not.toEqual(k0);
    expect(cache.key({ ...base, cwd: "/z" })).not.toEqual(k0);
    expect(cache.key({ ...base, scriptVersion: "v2" })).not.toEqual(k0);
    expect(cache.key({ ...base, catalogMtimeMs: 2 })).not.toEqual(k0);
    expect(cache.key({ ...base, provider: "openai:m" })).not.toEqual(k0);
  });

  it("roundtrips put/get", () => {
    const k = cache.key({
      prompt: "p",
      catalogMtimeMs: 0,
      cwd: "/",
      scriptVersion: "v",
      provider: "anthropic:m",
    });
    cache.put(k, '["a.md"]');
    expect(cache.get(k)).toEqual('["a.md"]');
  });

  it("misses on stale entries (past TTL)", () => {
    const shortCache = new LocalCache(dir, 1, 7); // 1 min TTL
    const k = shortCache.key({
      prompt: "stale",
      catalogMtimeMs: 0,
      cwd: "/",
      scriptVersion: "v",
      provider: "anthropic:m",
    });
    const file = join(dir, `${k}.json`);
    writeFileSync(file, "[]");
    // Backdate file to 2 minutes ago
    const past = new Date(Date.now() - 2 * 60_000);
    utimesSync(file, past, past);
    expect(shortCache.get(k)).toBeNull();
  });

  it("evictStale removes files older than eviction threshold", () => {
    const cache2 = new LocalCache(dir, 60, 1); // 1 day eviction
    const k = cache2.key({
      prompt: "evict",
      catalogMtimeMs: 0,
      cwd: "/",
      scriptVersion: "v",
      provider: "anthropic:m",
    });
    const file = join(dir, `${k}.json`);
    writeFileSync(file, "[]");
    const past = new Date(Date.now() - 2 * 86_400_000); // 2 days ago
    utimesSync(file, past, past);
    expect(cache2.evictStale()).toBeGreaterThanOrEqual(1);
  });
});
