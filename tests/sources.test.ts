import { describe, it, expect } from "vitest";
import { join } from "node:path";
import {
  expandHome,
  globToRegExp,
  resolveCustomSources,
  activeCustomSources,
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
