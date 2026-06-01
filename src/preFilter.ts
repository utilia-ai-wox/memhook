/**
 * Pre-filter trivial prompts — skip the LLM call entirely on acks like
 * "ok", "yeah", "merci", etc. Conservative by design: better to false-negative
 * (call Haiku unnecessarily) than false-positive (skip a real prompt).
 *
 * Strategy:
 *   - Strip whitespace and punctuation from the prompt
 *   - Lowercase
 *   - Exact match against the trivial word list (file > defaults)
 */

import { existsSync, readFileSync } from "node:fs";

export class PreFilter {
  private readonly words: Set<string>;

  constructor(filePath: string | undefined, defaults: string[]) {
    let words = defaults;
    if (filePath && existsSync(filePath)) {
      try {
        const raw = readFileSync(filePath, "utf8");
        words = raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith("#"));
      } catch {
        // fall back to defaults silently
      }
    }
    this.words = new Set(words.map((w) => normalise(w)));
  }

  isTrivial(prompt: string): boolean {
    const trim = normalise(prompt);
    if (trim.length === 0) return true;
    return this.words.has(trim);
  }
}

function normalise(input: string): string {
  return input.replace(/[\s\p{P}]/gu, "").toLowerCase();
}
