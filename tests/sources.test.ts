import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  expandHome,
  globToRegExp,
  listMatchingMdFiles,
  resolveCustomSources,
  activeCustomSources,
  resolveSources,
  expandPresets,
  resolveActivePresetNames,
  resolvePresetNames,
  isPresetName,
  detectPresets,
  HOST_PRESETS,
  PRESET_NAMES,
  PRESET_AUTO,
  type CustomSource,
} from "../src/sources.js";

describe("expandHome", () => {
  it("expands ~ and ~/ against home, leaves other paths alone", () => {
    expect(expandHome("~", "/home/u")).toBe("/home/u");
    // join() so the separator matches the platform (backslash on Windows).
    expect(expandHome("~/notes", "/home/u")).toBe(join("/home/u", "notes"));
    expect(expandHome("/abs/path", "/home/u")).toBe("/abs/path");
    expect(expandHome("rel/path", "/home/u")).toBe("rel/path");
  });
});

describe("globToRegExp", () => {
  it("matches * (any run) and ? (one char), anchored", () => {
    expect(globToRegExp("*.md").test("note.md")).toBe(true);
    expect(globToRegExp("*.md").test("note.txt")).toBe(false);
    expect(globToRegExp("note-*.md").test("note-a.md")).toBe(true);
    expect(globToRegExp("note-*.md").test("other.md")).toBe(false);
    expect(globToRegExp("a?.md").test("ax.md")).toBe(true);
    expect(globToRegExp("a?.md").test("axx.md")).toBe(false);
  });

  it("treats regex metacharacters in the glob literally", () => {
    expect(globToRegExp("a.b.md").test("a.b.md")).toBe(true);
    expect(globToRegExp("a.b.md").test("axbxmd")).toBe(false); // '.' is literal, not any-char
    expect(globToRegExp("f(1).md").test("f(1).md")).toBe(true);
  });

  it("is anchored (no partial match)", () => {
    expect(globToRegExp("note.md").test("xnote.mdx")).toBe(false);
  });
});

describe("listMatchingMdFiles", () => {
  it("keeps glob-matched .md files, drops non-.md, and sorts", () => {
    const entries = ["b.md", "a.md", "skip.txt", "note.markdown"];
    expect(listMatchingMdFiles(entries, "*.md")).toEqual(["a.md", "b.md"]);
  });

  it("applies the glob on top of the .md gate (e.g. *.instructions.md)", () => {
    const entries = ["x.instructions.md", "readme.md", "y.instructions.md"];
    expect(listMatchingMdFiles(entries, "*.instructions.md")).toEqual([
      "x.instructions.md",
      "y.instructions.md",
    ]);
  });

  it("returns [] for an empty listing", () => {
    expect(listMatchingMdFiles([], "*.md")).toEqual([]);
  });
});

describe("resolveCustomSources", () => {
  const home = "/home/u";

  it("returns [] for non-arrays and never throws", () => {
    expect(resolveCustomSources(undefined, home)).toEqual([]);
    expect(resolveCustomSources(null, home)).toEqual([]);
    expect(resolveCustomSources("nope", home)).toEqual([]);
    expect(resolveCustomSources({ dir: "/x" }, home)).toEqual([]); // object, not array
  });

  it("resolves a full entry and applies defaults (glob *.md, scope memory, hostAutoLoaded false)", () => {
    const out = resolveCustomSources([{ dir: "~/notes" }], home);
    expect(out).toEqual([
      { dir: join(home, "notes"), glob: "*.md", scope: "memory", hostAutoLoaded: false },
    ]);
  });

  it("honours explicit glob / scope / hostAutoLoaded", () => {
    const out = resolveCustomSources(
      [{ dir: "/a", glob: "rule-*.md", scope: "rules", hostAutoLoaded: true }],
      home,
    );
    expect(out[0]).toEqual({
      dir: "/a",
      glob: "rule-*.md",
      scope: "rules",
      hostAutoLoaded: true,
    });
  });

  it("drops invalid entries (missing/blank dir, non-objects) but keeps valid ones", () => {
    const out = resolveCustomSources(
      [{ glob: "*.md" }, { dir: "" }, { dir: "  " }, 42, null, { dir: "/keep" }],
      home,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.dir).toBe("/keep");
  });

  it("coerces an unknown scope to memory and a non-true hostAutoLoaded to false", () => {
    const out = resolveCustomSources([{ dir: "/a", scope: "weird", hostAutoLoaded: "yes" }], home);
    expect(out[0]?.scope).toBe("memory");
    expect(out[0]?.hostAutoLoaded).toBe(false);
  });
});

describe("activeCustomSources", () => {
  const mk = (dir: string, hostAutoLoaded: boolean): CustomSource => ({
    dir,
    glob: "*.md",
    scope: "memory",
    hostAutoLoaded,
  });

  it("always includes non-host-autoloaded sources", () => {
    const srcs = [mk("/a", false), mk("/b", false)];
    expect(activeCustomSources(srcs, false).map((s) => s.dir)).toEqual(["/a", "/b"]);
  });

  it("includes host-autoloaded sources only when resurfacing", () => {
    const srcs = [mk("/a", false), mk("/b", true)];
    expect(activeCustomSources(srcs, false).map((s) => s.dir)).toEqual(["/a"]);
    expect(activeCustomSources(srcs, true).map((s) => s.dir)).toEqual(["/a", "/b"]);
  });
});

describe("host presets", () => {
  it("PRESET_NAMES are all known; isPresetName rejects the unknown", () => {
    expect(PRESET_NAMES.length).toBeGreaterThan(0);
    for (const n of PRESET_NAMES) expect(isPresetName(n)).toBe(true);
    expect(isPresetName("nope")).toBe(false);
  });

  it("every preset is experimental and only ships atomic .md/.instructions.md sources", () => {
    for (const def of Object.values(HOST_PRESETS)) {
      expect(def.experimental).toBe(true);
      expect(def.sources.length).toBeGreaterThan(0);
      for (const s of def.sources) {
        expect(["cwd", "home"]).toContain(s.base);
        expect(s.glob.endsWith(".md")).toBe(true);
      }
    }
  });

  it("resolvePresetNames keeps known names + the auto token, drops unknown / non-strings / non-arrays", () => {
    expect(resolvePresetNames(["continue", "nope", 42, "cline"])).toEqual(["continue", "cline"]);
    expect(resolvePresetNames(["auto", "continue"])).toEqual(["auto", "continue"]);
    expect(resolvePresetNames("continue")).toEqual([]);
    expect(resolvePresetNames(undefined)).toEqual([]);
  });

  it("expandPresets resolves cwd/home bases into CustomSource[], skips unknown", () => {
    const out = expandPresets(["continue"], "/repo", "/home/u");
    expect(out).toContainEqual({
      dir: join("/repo", ".continue", "rules"),
      glob: "*.md",
      scope: "rules",
      hostAutoLoaded: false,
    });
    expect(out).toContainEqual({
      dir: join("/home/u", ".continue", "rules"),
      glob: "*.md",
      scope: "rules",
      hostAutoLoaded: false,
    });
    expect(expandPresets(["nope"], "/r", "/h")).toEqual([]);
  });

  it("resolveSources concats explicit customSources then expanded presets", () => {
    const custom: CustomSource[] = [
      { dir: "/x", glob: "*.md", scope: "memory", hostAutoLoaded: false },
    ];
    // No `auto`, so readDir is never consulted (a throwing reader proves it).
    const boom = (): string[] => {
      throw new Error("readDir must not be called without auto");
    };
    const out = resolveSources(custom, ["windsurf"], "/repo", "/home/u", boom);
    expect(out[0]).toEqual(custom[0]);
    expect(out).toContainEqual({
      dir: join("/repo", ".windsurf", "rules"),
      glob: "*.md",
      scope: "rules",
      hostAutoLoaded: false,
    });
  });
});

describe("detectPresets", () => {
  const cwd = "/repo";
  const home = "/home/u";

  // A fake filesystem keyed by directory; an unknown dir makes readDir throw
  // (the real readdirSync's ENOENT), which detection must treat as absent.
  const makeReadDir =
    (fs: Record<string, string[]>) =>
    (dir: string): string[] => {
      if (dir in fs) return fs[dir] as string[];
      throw new Error(`ENOENT: ${dir}`);
    };

  it("returns every built-in preset in PRESET_NAMES order", () => {
    const got = detectPresets(cwd, home, makeReadDir({})).map((d) => d.name);
    expect(got).toEqual(PRESET_NAMES);
  });

  it("marks a preset matched when a dir holds ≥1 glob-matched .md, with sorted files", () => {
    const fs = {
      [join(cwd, ".continue", "rules")]: ["b.md", "a.md", "skip.txt"],
      [join(home, ".continue", "rules")]: ["g.md"],
    };
    const cont = detectPresets(cwd, home, makeReadDir(fs)).find((d) => d.name === "continue");
    expect(cont?.matched).toBe(true);
    expect(cont?.experimental).toBe(true);
    const projectDir = cont?.dirs.find((d) => d.dir === join(cwd, ".continue", "rules"));
    expect(projectDir).toMatchObject({ files: ["a.md", "b.md"], exists: true });
    const homeDir = cont?.dirs.find((d) => d.dir === join(home, ".continue", "rules"));
    expect(homeDir).toMatchObject({ files: ["g.md"], exists: true });
  });

  it("applies the preset's own glob (copilot *.instructions.md), not a bare *.md", () => {
    const fs = {
      [join(cwd, ".github", "instructions")]: ["x.instructions.md", "readme.md"],
    };
    const copilot = detectPresets(cwd, home, makeReadDir(fs)).find((d) => d.name === "copilot");
    expect(copilot?.matched).toBe(true);
    expect(copilot?.dirs[0]?.files).toEqual(["x.instructions.md"]);
  });

  it("records a missing/denied dir as exists:false, files:[] (never throws)", () => {
    const detections = detectPresets(cwd, home, makeReadDir({}));
    for (const d of detections) {
      expect(d.matched).toBe(false);
      for (const dir of d.dirs) {
        expect(dir).toMatchObject({ exists: false, files: [] });
      }
    }
  });

  it("a present-but-empty dir is exists:true but unmatched", () => {
    const fs = { [join(cwd, ".windsurf", "rules")]: [] };
    const windsurf = detectPresets(cwd, home, makeReadDir(fs)).find((d) => d.name === "windsurf");
    expect(windsurf?.matched).toBe(false);
    expect(windsurf?.dirs[0]).toMatchObject({ exists: true, files: [] });
  });

  it("is total even when readDir always throws", () => {
    const boom = (): string[] => {
      throw new Error("boom");
    };
    expect(() => detectPresets(cwd, home, boom)).not.toThrow();
    expect(detectPresets(cwd, home, boom).every((d) => !d.matched)).toBe(true);
  });
});

describe("resolveActivePresetNames (auto)", () => {
  const cwd = "/repo";
  const home = "/home/u";
  const makeReadDir =
    (fs: Record<string, string[]>) =>
    (dir: string): string[] => {
      if (dir in fs) return fs[dir] as string[];
      throw new Error(`ENOENT: ${dir}`);
    };

  it("returns the known names unchanged and never reads disk without auto", () => {
    const boom = (): string[] => {
      throw new Error("readDir must not be called without auto");
    };
    expect(resolveActivePresetNames(["continue", "windsurf"], cwd, home, boom)).toEqual([
      "continue",
      "windsurf",
    ]);
    // `auto` is the opt-in token (PRESET_AUTO); plain names don't trigger detection.
    expect(PRESET_AUTO).toBe("auto");
  });

  it("auto expands to every detected preset, unioned with explicit names, de-duped", () => {
    const fs = {
      [join(cwd, ".continue", "rules")]: ["a.md"],
      [join(cwd, ".windsurf", "rules")]: ["w.md"],
    };
    const names = resolveActivePresetNames([PRESET_AUTO, "continue"], cwd, home, makeReadDir(fs));
    expect(new Set(names)).toEqual(new Set(["continue", "windsurf"]));
    expect(names.filter((n) => n === "continue")).toHaveLength(1); // de-duped
    expect(names).not.toContain("auto"); // the token itself is dropped
  });

  it("auto with no detected preset memory yields no names", () => {
    expect(resolveActivePresetNames([PRESET_AUTO], cwd, home, makeReadDir({}))).toEqual([]);
  });

  it("resolveSources expands auto into the detected preset's dirs", () => {
    const fs = { [join(cwd, ".windsurf", "rules")]: ["w.md"] };
    const out = resolveSources([], [PRESET_AUTO], cwd, home, makeReadDir(fs));
    expect(out).toContainEqual({
      dir: join(cwd, ".windsurf", "rules"),
      glob: "*.md",
      scope: "rules",
      hostAutoLoaded: false,
    });
    // A preset with no memory on disk is not pulled in by auto.
    expect(out.some((s) => s.dir === join(cwd, ".continue", "rules"))).toBe(false);
  });
});
