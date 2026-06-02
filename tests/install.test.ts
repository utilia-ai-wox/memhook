import { describe, it, expect } from "vitest";
import { addHooks, removeHooks, memhookSubcommand, type Settings } from "../src/install.js";

/** Reach into the dynamic settings shape for assertions. */
const cmd = (s: Settings, ev: string, g = 0, h = 0): string | undefined =>
  s.hooks?.[ev]?.[g]?.hooks?.[h]?.command;

describe("memhookSubcommand", () => {
  it("detects the binary + subcommand across invocation forms", () => {
    expect(memhookSubcommand("memhook run")).toBe("run");
    expect(memhookSubcommand("memhook build-catalog")).toBe("build-catalog");
    expect(memhookSubcommand("/usr/local/bin/memhook run")).toBe("run");
    expect(memhookSubcommand("node /x/dist/bin/memhook.js run")).toBe("run");
  });
  it("returns null for non-memhook commands and non-strings", () => {
    expect(memhookSubcommand("othertool run")).toBeNull();
    expect(memhookSubcommand("memhookish run")).toBeNull(); // no false-positive on a prefix
    expect(memhookSubcommand("memhook")).toBeNull(); // no subcommand
    expect(memhookSubcommand(123)).toBeNull();
    expect(memhookSubcommand(undefined)).toBeNull();
  });
});

describe("addHooks", () => {
  it("wires both events into an empty settings file", () => {
    const r = addHooks({});
    expect(r.added).toEqual(["UserPromptSubmit", "SessionStart"]);
    expect(cmd(r.settings, "UserPromptSubmit")).toBe("memhook run");
    expect(cmd(r.settings, "SessionStart")).toBe("memhook build-catalog");
  });

  it("is idempotent — a second run adds nothing and does not duplicate", () => {
    const once = addHooks({});
    const twice = addHooks(once.settings);
    expect(twice.added).toEqual([]);
    expect(twice.alreadyPresent).toEqual(["UserPromptSubmit", "SessionStart"]);
    expect(twice.settings.hooks?.["UserPromptSubmit"]).toHaveLength(1);
  });

  it("preserves unrelated settings keys and unrelated hooks", () => {
    const existing = {
      model: "opus",
      permissions: { allow: ["Bash"] },
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "other-tool run" }] }],
        Stop: [{ hooks: [{ type: "command", command: "do-stop" }] }],
      },
    };
    const r = addHooks(existing);
    expect(r.settings["model"]).toBe("opus");
    expect(r.settings["permissions"]).toEqual({ allow: ["Bash"] });
    expect(r.settings.hooks?.["Stop"]).toEqual(existing.hooks.Stop);
    // memhook appended as a second group; the user's group stays first.
    expect(r.settings.hooks?.["UserPromptSubmit"]).toHaveLength(2);
    expect(cmd(r.settings, "UserPromptSubmit", 0)).toBe("other-tool run");
    expect(cmd(r.settings, "UserPromptSubmit", 1)).toBe("memhook run");
  });

  it("does not mutate the input object", () => {
    const existing = { hooks: { UserPromptSubmit: [] as unknown[] } };
    addHooks(existing);
    expect(existing.hooks.UserPromptSubmit).toHaveLength(0);
  });

  it("honours a custom bin path", () => {
    const r = addHooks({}, "/opt/bin/memhook");
    expect(cmd(r.settings, "UserPromptSubmit")).toBe("/opt/bin/memhook run");
    expect(cmd(r.settings, "SessionStart")).toBe("/opt/bin/memhook build-catalog");
  });

  it("treats non-object input as an empty base", () => {
    expect(addHooks(null).added).toHaveLength(2);
    expect(addHooks("nonsense").added).toHaveLength(2);
  });
});

describe("removeHooks", () => {
  it("removes memhook hooks, prunes emptied groups/events, keeps the rest", () => {
    const wired = addHooks({
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "keep me" }] }],
        Stop: [{ hooks: [{ type: "command", command: "do-stop" }] }],
      },
    }).settings;

    const r = removeHooks(wired);
    expect(r.removed).toBe(2); // run + build-catalog
    expect(r.removedEvents.sort()).toEqual(["SessionStart", "UserPromptSubmit"]);
    // UserPromptSubmit drops only the memhook group; the user's stays.
    expect(r.settings.hooks?.["UserPromptSubmit"]).toHaveLength(1);
    expect(cmd(r.settings, "UserPromptSubmit")).toBe("keep me");
    // SessionStart had only memhook → the now-empty event is removed.
    expect(r.settings.hooks?.["SessionStart"]).toBeUndefined();
    // Unrelated event untouched.
    expect(cmd(r.settings, "Stop")).toBe("do-stop");
  });

  it("is a no-op when there are no memhook hooks", () => {
    expect(removeHooks({ model: "x" }).removed).toBe(0);
    expect(removeHooks({}).removed).toBe(0);
    expect(removeHooks("nonsense").removed).toBe(0);
    expect(
      removeHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: "z" }] }] } }).removed,
    ).toBe(0);
  });

  it("add then remove round-trips back to an empty hooks map", () => {
    const r = removeHooks(addHooks({}).settings);
    expect(r.removed).toBe(2);
    expect(r.settings.hooks).toEqual({});
  });
});
