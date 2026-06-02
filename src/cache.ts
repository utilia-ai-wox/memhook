/**
 * Local LRU cache for memhook selections.
 *
 * Key = sha256(prompt + catalog_mtime + cwd + script_version + provider). Bump
 * any of these and the entry is automatically invalidated — `provider`
 * (type + model) is included so switching provider/model never serves a stale
 * selection made by a different model.
 *
 * Storage: one JSON file per key under config.cache.dir. TTL enforced via
 * filesystem mtime check.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface CacheKeyInput {
  prompt: string;
  catalogMtimeMs: number;
  cwd: string;
  scriptVersion: string;
  /** Provider identity, e.g. "anthropic:claude-haiku-4-5". */
  provider: string;
}

export class LocalCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMin: number,
    private readonly evictionDays: number,
  ) {
    mkdirSync(this.dir, { recursive: true });
  }

  key(input: CacheKeyInput): string {
    const raw = `${input.prompt}|${input.catalogMtimeMs}|${input.cwd}|${input.scriptVersion}|${input.provider}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  get(key: string): string | null {
    const file = join(this.dir, `${key}.json`);
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(file);
    } catch {
      return null;
    }
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > this.ttlMin * 60_000) return null;
    try {
      return readFileSync(file, "utf8");
    } catch {
      return null;
    }
  }

  put(key: string, value: string): void {
    const file = join(this.dir, `${key}.json`);
    writeFileSync(file, value, "utf8");
  }

  evictStale(): number {
    let removed = 0;
    const cutoffMs = Date.now() - this.evictionDays * 86_400_000;
    let entries: string[] = [];
    try {
      entries = readdirSync(this.dir);
    } catch {
      return 0;
    }
    for (const name of entries) {
      if (!name.endsWith(".json")) continue;
      const file = join(this.dir, name);
      try {
        const stat = statSync(file);
        if (stat.mtimeMs < cutoffMs) {
          unlinkSync(file);
          removed++;
        }
      } catch {
        // ignore
      }
    }
    return removed;
  }
}
