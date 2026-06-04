import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  expandHome,
  globToRegExp,
  listMatchingFiles,
  isHostAutoloadedFile,
  hasSourceExtension,
  SOURCE_EXTENSIONS,
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

describe("hasSourceExtension", () => {
  it("accepts md / mdc / txt, rejects everything else", () => {
    expect(SOURCE_EXTENSIONS).toEqual(["md", "mdc", "txt"]);
    for (const ext of SOURCE_EXTENSIONS) expect(hasSourceExtension(`f.${ext}`)).toBe(true);
    expect(hasSourceExtension("note.markdown")).toBe(false);
    expect(hasSourceExtension("script.sh")).toBe(false);
    expect(hasSourceExtension("data.json")).toBe(false);
    expect(hasSourceExtension("noext")).toBe(false);
  });
});

describe("listMatchingFiles", () => {
  it("keeps glob-matched allowed-extension files, drops others, and sorts", () => {
    const entries = ["b.md", "a.md", "skip.json", "note.markdown"];
    expect(listMatchingFiles(entries, "*.md")).toEqual(["a.md", "b.md"]);
  });

  it("accepts widened extensions when the glob permits (.mdc, .txt)", () => {
    expect(listMatchingFiles(["r.mdc", "skip.md"], "*.mdc")).toEqual(["r.mdc"]);
    expect(listMatchingFiles(["note.txt", "skip.json"], "*.txt")).toEqual(["note.txt"]);
  });

  it("the extension gate is a floor independent of the glob (a `*` glob still drops non-source files)", () => {
    const entries = ["a.md", "b.mdc", "c.txt", "evil.sh", "data.json"];
    expect(listMatchingFiles(entries, "*")).toEqual(["a.md", "b.mdc", "c.txt"]);
  });

  it("applies the glob on top of the extension gate (e.g. *.instructions.md)", () => {
    const entries = ["x.instructions.md", "readme.md", "y.instructions.md"];
    expect(listMatchingFiles(entries, "*.instructions.md")).toEqual([
      "x.instructions.md",
      "y.instructions.md",
    ]);
  });

  it("returns [] for an empty listing", () => {
    expect(listMatchingFiles([], "*.md")).toEqual([]);
  });
});

describe("isHostAutoloadedFile", () => {
  it("detects Cursor alwaysApply: true and Windsurf trigger: always_on in frontmatter", () => {
    expect(isHostAutoloadedFile("---\nalwaysApply: true\n---\nbody")).toBe(true);
    expect(isHostAutoloadedFile("---\ndescription: x\nalwaysApply: true\n---\n")).toBe(true);
    expect(isHostAutoloadedFile("---\ntrigger: always_on\n---\n")).toBe(true);
    // Tolerates no-space and trailing whitespace around the value.
    expect(isHostAutoloadedFile("---\nalwaysApply:true\n---\n")).toBe(true);
    expect(isHostAutoloadedFile("---\ntrigger:  always_on  \n---\n")).toBe(true);
  });

  it("returns false for non-always-on rules and files with no/blank frontmatter", () => {
    expect(isHostAutoloadedFile("---\nalwaysApply: false\n---\n")).toBe(false);
    expect(isHostAutoloadedFile("---\ntrigger: model_decision\n---\n")).toBe(false);
    expect(isHostAutoloadedFile("---\nglobs: src/**\n---\n")).toBe(false);
    expect(isHostAutoloadedFile("# Just a heading\nbody")).toBe(false);
    expect(isHostAutoloadedFile("")).toBe(false);
  });

  it("only scans the frontmatter block — body prose never false-positives", () => {
    // No closing fence → no frontmatter block at all.
    expect(isHostAutoloadedFile("---\ndescription: x\nbody alwaysApply: true everywhere")).toBe(
      false,
    );
    // The marker appears only after the frontmatter closes.
    expect(isHostAutoloadedFile("---\ndescription: x\n---\nalwaysApply: true")).toBe(false);
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
      {
        dir: join(home, "notes"),
        glob: "*.md",
        scope: "memory",
        hostAutoLoaded: false,
        perFileAutoload: false,
      },
    ]);
  });

  it("honours explicit glob / scope / hostAutoLoaded / perFileAutoload", () => {
    const out = resolveCustomSources(
      [
        {
          dir: "/a",
          glob: "rule-*.md",
          scope: "rules",
          hostAutoLoaded: true,
          perFileAutoload: true,
        },
      ],
      home,
    );
    expect(out[0]).toEqual({
      dir: "/a",
      glob: "rule-*.md",
      scope: "rules",
      hostAutoLoaded: true,
      perFileAutoload: true,
    });
  });

  it("coerces a non-true perFileAutoload to false", () => {
    expect(resolveCustomSources([{ dir: "/a", perFileAutoload: "yes" }], home)[0]).toMatchObject({
      perFileAutoload: false,
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

  it("every preset is experimental and ships atomic sources with an allowed-extension glob", () => {
    for (const def of Object.values(HOST_PRESETS)) {
      expect(def.experimental).toBe(true);
      expect(def.sources.length).toBeGreaterThan(0);
      for (const s of def.sources) {
        expect(["cwd", "home"]).toContain(s.base);
        // The glob narrows to an allowed source extension (.md / .mdc / .txt) so
        // it always passes both the catalog filter and the router guard.
        expect(SOURCE_EXTENSIONS.some((ext) => s.glob.endsWith(`.${ext}`))).toBe(true);
        // perFileAutoload, when present, is a boolean (default false at expansion).
        if (s.perFileAutoload !== undefined) expect(typeof s.perFileAutoload).toBe("boolean");
      }
    }
  });

  it("the cursor preset is .mdc, per-file-autoload, not directory-wide host-autoloaded", () => {
    const cursor = HOST_PRESETS["cursor"];
    expect(cursor?.sources).toHaveLength(1);
    expect(cursor?.sources[0]).toMatchObject({
      glob: "*.mdc",
      hostAutoLoaded: false,
      perFileAutoload: true,
    });
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
      perFileAutoload: false,
    });
    expect(out).toContainEqual({
      dir: join("/home/u", ".continue", "rules"),
      glob: "*.md",
      scope: "rules",
      hostAutoLoaded: false,
      perFileAutoload: false,
    });
    expect(expandPresets(["nope"], "/r", "/h")).toEqual([]);
  });

  it("expandPresets propagates perFileAutoload for cursor (.mdc, true)", () => {
    expect(expandPresets(["cursor"], "/repo", "/home/u")).toEqual([
      {
        dir: join("/repo", ".cursor", "rules"),
        glob: "*.mdc",
        scope: "rules",
        hostAutoLoaded: false,
        perFileAutoload: true,
      },
    ]);
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
      perFileAutoload: true,
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
      perFileAutoload: true,
    });
    // A preset with no memory on disk is not pulled in by auto.
    expect(out.some((s) => s.dir === join(cwd, ".continue", "rules"))).toBe(false);
  });
});
