import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPANION_SKILLS,
  SKILL_FILES,
  isCompanionSkill,
  diffSkill,
  planInstall,
  planUninstall,
} from "../src/skills.js";
import { installCompanionSkills, runSkills, bundledSkillsDir } from "../src/skillsCmd.js";

// ── pure planner ─────────────────────────────────────────────────────────────

describe("isCompanionSkill", () => {
  it("accepts the three shipped names and rejects others", () => {
    expect(isCompanionSkill("wrap")).toBe(true);
    expect(isCompanionSkill("curate")).toBe(true);
    expect(isCompanionSkill("relay")).toBe(true);
    expect(isCompanionSkill("deploy")).toBe(false);
    expect(isCompanionSkill("")).toBe(false);
  });
});

describe("diffSkill", () => {
  const source = { "SKILL.md": "A", "reference.md": "B" };
  it("absent when nothing is installed", () => {
    expect(diffSkill(source, { "SKILL.md": null, "reference.md": null })).toBe("absent");
  });
  it("identical when every file matches", () => {
    expect(diffSkill(source, { "SKILL.md": "A", "reference.md": "B" })).toBe("identical");
  });
  it("differs on a content change", () => {
    expect(diffSkill(source, { "SKILL.md": "A", "reference.md": "EDITED" })).toBe("differs");
  });
  it("differs on a partially-installed skill", () => {
    expect(diffSkill(source, { "SKILL.md": "A", "reference.md": null })).toBe("differs");
  });
});

describe("planInstall", () => {
  const source = { "SKILL.md": "A" };
  it("installs an absent skill", () => {
    const p = planInstall("wrap", source, { "SKILL.md": null }, { force: false });
    expect(p.action).toBe("install");
    expect(p.writes).toEqual(["SKILL.md"]);
  });
  it("skips an identical skill (idempotent)", () => {
    const p = planInstall("wrap", source, { "SKILL.md": "A" }, { force: false });
    expect(p.action).toBe("skip");
    expect(p.writes).toEqual([]);
  });
  it("blocks a differing skill without force", () => {
    const p = planInstall("wrap", source, { "SKILL.md": "EDIT" }, { force: false });
    expect(p.action).toBe("blocked");
    expect(p.writes).toEqual([]);
  });
  it("overwrites a differing skill with force", () => {
    const p = planInstall("wrap", source, { "SKILL.md": "EDIT" }, { force: true });
    expect(p.action).toBe("overwrite");
    expect(p.writes).toEqual(["SKILL.md"]);
  });
});

describe("planUninstall", () => {
  const source = { "SKILL.md": "A", "reference.md": "B" };
  it("removes only the present files", () => {
    const p = planUninstall("curate", source, { "SKILL.md": "A", "reference.md": null });
    expect(p.action).toBe("remove");
    expect(p.removes).toEqual(["SKILL.md"]);
  });
  it("skips when nothing is installed", () => {
    const p = planUninstall("curate", source, { "SKILL.md": null, "reference.md": null });
    expect(p.action).toBe("skip");
    expect(p.present).toBe(false);
  });
});

// ── packaging: the real bundled skills resolve and ship every declared file ───

describe("bundledSkillsDir", () => {
  it("ships every file declared in SKILL_FILES", () => {
    const dir = bundledSkillsDir();
    for (const name of COMPANION_SKILLS) {
      for (const rel of SKILL_FILES[name]) {
        expect(existsSync(join(dir, name, rel))).toBe(true);
      }
    }
  });
});

// ── I/O: install / uninstall against a temp home + temp source ───────────────

describe("installCompanionSkills (I/O)", () => {
  const root = mkdtempSync(join(tmpdir(), "memhook-skills-test-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  // A synthetic source dir so the copy/backup logic is exercised independently
  // of the real skill content.
  const sourceDir = join(root, "src-skills");
  for (const name of COMPANION_SKILLS) {
    mkdirSync(join(sourceDir, name), { recursive: true });
    for (const rel of SKILL_FILES[name]) {
      writeFileSync(join(sourceDir, name, rel), `# ${name} ${rel} v1\n`);
    }
  }

  const installed = (home: string, name: string, rel = "SKILL.md") =>
    join(home, ".claude", "skills", name, rel);

  it("installs all absent skills", () => {
    const home = join(root, "home-fresh");
    const results = installCompanionSkills({ home, sourceDir });
    expect(results.every((r) => r.applied)).toBe(true);
    for (const name of COMPANION_SKILLS) {
      for (const rel of SKILL_FILES[name]) {
        expect(readFileSync(installed(home, name, rel), "utf8")).toContain(`${name} ${rel} v1`);
      }
    }
  });

  it("is idempotent — a second install writes nothing", () => {
    const home = join(root, "home-idem");
    installCompanionSkills({ home, sourceDir });
    const second = installCompanionSkills({ home, sourceDir });
    expect(second.every((r) => r.plan.action === "skip")).toBe(true);
    expect(second.every((r) => !r.applied)).toBe(true);
  });

  it("does not clobber a user-edited skill without force", () => {
    const home = join(root, "home-noclobber");
    installCompanionSkills({ home, sourceDir });
    writeFileSync(installed(home, "wrap"), "# my own edits\n");
    const results = installCompanionSkills({ home, sourceDir });
    const wrap = results.find((r) => r.plan.name === "wrap")!;
    expect(wrap.plan.action).toBe("blocked");
    expect(wrap.applied).toBe(false);
    expect(readFileSync(installed(home, "wrap"), "utf8")).toBe("# my own edits\n");
  });

  it("overwrites with force and backs up the edited file first", () => {
    const home = join(root, "home-force");
    installCompanionSkills({ home, sourceDir });
    writeFileSync(installed(home, "wrap"), "# my own edits\n");
    const results = installCompanionSkills({ home, sourceDir, force: true });
    const wrap = results.find((r) => r.plan.name === "wrap")!;
    expect(wrap.plan.action).toBe("overwrite");
    expect(wrap.applied).toBe(true);
    expect(readFileSync(installed(home, "wrap"), "utf8")).toContain("wrap SKILL.md v1");
    expect(wrap.backedUp.length).toBe(1);
    expect(readFileSync(wrap.backedUp[0]!, "utf8")).toBe("# my own edits\n");
  });

  it("dryRun writes nothing", () => {
    const home = join(root, "home-dry");
    const results = installCompanionSkills({ home, sourceDir, dryRun: true });
    expect(results.every((r) => !r.applied)).toBe(true);
    expect(existsSync(installed(home, "wrap"))).toBe(false);
  });

  it("runSkills install then uninstall round-trips", async () => {
    const home = join(root, "home-cli");
    const code1 = await runSkills({
      subcommand: "install",
      home,
      sourceDir,
      yes: true,
      dryRun: false,
      force: false,
    });
    expect(code1).toBe(0);
    expect(existsSync(installed(home, "curate", "reference.md"))).toBe(true);

    const code2 = await runSkills({
      subcommand: "uninstall",
      home,
      sourceDir,
      yes: true,
      dryRun: false,
      force: false,
    });
    expect(code2).toBe(0);
    expect(existsSync(installed(home, "curate"))).toBe(false);
    // The skill directory is removed once empty.
    expect(existsSync(join(home, ".claude", "skills", "curate"))).toBe(false);
  });
});
