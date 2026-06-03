import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { runPresets } from "../src/presetsCmd.js";

// Colour off so output assertions are stable; capture stdout via the `out` seam.
const NO_COLOR = { NO_COLOR: "1" } as NodeJS.ProcessEnv;

function capture(opts: Parameters<typeof runPresets>[0]): { code: number; text: string } {
  const lines: string[] = [];
  const code = runPresets({ env: NO_COLOR, out: (s) => lines.push(s), ...opts });
  return { code, text: lines.join("\n") };
}

describe("runPresets list", () => {
  it("lists every built-in preset, flagged experimental, exit 0", () => {
    const { code, text } = capture({ subcommand: "list", cwd: "/repo", home: "/home/u" });
    expect(code).toBe(0);
    for (const name of ["cline", "continue", "copilot", "windsurf"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("experimental");
    // Paths are shown resolved against cwd/home.
    expect(text).toContain(join("/repo", ".continue", "rules"));
  });
});

describe("runPresets detect", () => {
  const cwd = "/repo";
  const home = "/home/u";
  const makeReadDir =
    (fs: Record<string, string[]>) =>
    (dir: string): string[] => {
      if (dir in fs) return fs[dir] as string[];
      throw new Error(`ENOENT: ${dir}`);
    };

  it("prints the YAML snippet for the presets that have memory, exit 0", () => {
    const fs = { [join(cwd, ".continue", "rules")]: ["a.md"] };
    const { code, text } = capture({
      subcommand: "detect",
      cwd,
      home,
      readDir: makeReadDir(fs),
    });
    expect(code).toBe(0);
    expect(text).toContain("presets: [continue]");
    // Unmatched presets are still reported as having no files.
    expect(text).toContain("no matching files");
  });

  it("combines multiple matched presets into one snippet, in PRESET_NAMES order", () => {
    const fs = {
      [join(cwd, ".continue", "rules")]: ["a.md"],
      [join(cwd, ".windsurf", "rules")]: ["w.md"],
    };
    const { text } = capture({ subcommand: "detect", cwd, home, readDir: makeReadDir(fs) });
    expect(text).toContain("presets: [continue, windsurf]");
  });

  it("says nothing to enable when no preset matches, exit 0", () => {
    const { code, text } = capture({
      subcommand: "detect",
      cwd,
      home,
      readDir: makeReadDir({}),
    });
    expect(code).toBe(0);
    expect(text).toContain("Nothing to enable");
    expect(text).not.toContain("presets: [");
  });
});
