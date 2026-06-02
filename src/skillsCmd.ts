/**
 * `memhook skills install|uninstall|list` — copy the bundled companion skills
 * (/wrap, /curate, /relay) into `~/.claude/skills/<name>/`.
 *
 * This is the I/O shell around the pure planner in src/skills.ts (same split as
 * init.ts ↔ install.ts). All reads/writes/backups live here; the plan logic is
 * pure and unit-tested. These are INTERACTIVE, user-invoked commands — not the
 * hook path — so they may use the TTY and exit non-zero on user error
 * (docs/SPECIFICATION.md §9). The one safety rule: never clobber a skill the
 * user has edited without `--force`, and always back up before overwriting.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { makeAnsi, type Ansi } from "./ansi.js";
import { backupPath, stampNow } from "./backup.js";
import {
  COMPANION_SKILLS,
  SKILL_FILES,
  diffSkill,
  planInstall,
  planUninstall,
  type CompanionSkill,
  type InstalledFiles,
  type SkillInstallPlan,
  type SkillSources,
  type SkillStatus,
} from "./skills.js";

/**
 * Directory holding the bundled skill sources. The module lives at `src/` in
 * dev/tests and `dist/src/` once published, so the relative depth to the
 * package-root `skills/` differs — walk up from the module dir until we find a
 * `skills/wrap/SKILL.md`, which is unambiguous in either layout.
 */
export function bundledSkillsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, "skills");
    if (existsSync(join(candidate, "wrap", "SKILL.md"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fallback: best guess relative to the published layout (dist/src → root).
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

function skillDir(home: string, name: string): string {
  return join(home, ".claude", "skills", name);
}

/** Read a skill's bundled files. Throws if a shipped file is missing (a packaging bug). */
function readSources(sourceDir: string, name: CompanionSkill): SkillSources {
  const dir = join(sourceDir, name);
  const out: SkillSources = {};
  for (const rel of SKILL_FILES[name]) out[rel] = readFileSync(join(dir, rel), "utf8");
  return out;
}

/** Read what's installed for a skill; a missing/unreadable file maps to `null`. */
function readInstalled(home: string, name: CompanionSkill): InstalledFiles {
  const dir = skillDir(home, name);
  const out: InstalledFiles = {};
  for (const rel of SKILL_FILES[name]) {
    try {
      out[rel] = readFileSync(join(dir, rel), "utf8");
    } catch {
      out[rel] = null;
    }
  }
  return out;
}

// ── programmatic install (reused by `memhook init`) ──────────────────────────

export interface InstallSkillsOptions {
  home?: string | undefined;
  sourceDir?: string | undefined;
  names?: CompanionSkill[] | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
}

export interface SkillInstallResult {
  plan: SkillInstallPlan;
  applied: boolean;
  backedUp: string[];
}

/**
 * Install (copy) the requested skills, backing up any file an `--force`
 * overwrite would replace. Pure-of-prompts: callers handle confirmation + I/O
 * reporting. Returns one result per requested skill.
 */
export function installCompanionSkills(opts: InstallSkillsOptions = {}): SkillInstallResult[] {
  const home = opts.home ?? homedir();
  const sourceDir = opts.sourceDir ?? bundledSkillsDir();
  const names = opts.names ?? [...COMPANION_SKILLS];
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;
  const stamp = stampNow();

  const results: SkillInstallResult[] = [];
  for (const name of names) {
    const source = readSources(sourceDir, name);
    const installed = readInstalled(home, name);
    const plan = planInstall(name, source, installed, { force });
    const backedUp: string[] = [];
    let applied = false;

    if (!dryRun && (plan.action === "install" || plan.action === "overwrite")) {
      const dir = skillDir(home, name);
      for (const rel of plan.writes) {
        const dest = join(dir, rel);
        if (plan.action === "overwrite" && installed[rel] != null) {
          const bak = backupPath(dest, stamp);
          try {
            copyFileSync(dest, bak);
            backedUp.push(bak);
          } catch {
            /* best-effort backup; never abort the install on a backup miss */
          }
        }
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, source[rel] as string, "utf8");
      }
      applied = true;
    }
    results.push({ plan, applied, backedUp });
  }
  return results;
}

// ── CLI: memhook skills <install|uninstall|list> ─────────────────────────────

export type SkillsSubcommand = "install" | "uninstall" | "list";

export interface RunSkillsOptions {
  subcommand: SkillsSubcommand;
  names?: CompanionSkill[] | undefined;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  /** Test seams. */
  home?: string | undefined;
  sourceDir?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

interface Io {
  out: (s: string) => void;
  ansi: Ansi;
}

function makeIo(env: NodeJS.ProcessEnv): Io {
  const ansi = makeAnsi({ isTTY: Boolean(process.stdout.isTTY), env });
  return { out: (s) => process.stdout.write(s + "\n"), ansi };
}

const STATUS_LABEL: Record<SkillStatus, string> = {
  absent: "not installed",
  identical: "installed (up to date)",
  differs: "installed (differs from shipped)",
};

export async function runSkills(opts: RunSkillsOptions): Promise<number> {
  const env = opts.env ?? process.env;
  const io = makeIo(env);
  const { ansi } = io;
  const home = opts.home ?? homedir();
  const sourceDir = opts.sourceDir ?? bundledSkillsDir();
  const names = opts.names && opts.names.length > 0 ? opts.names : [...COMPANION_SKILLS];
  const interactive = !opts.yes && Boolean(process.stdin.isTTY) && !opts.dryRun;

  if (opts.subcommand === "list") {
    io.out(ansi.bold("memhook companion skills"));
    for (const name of names) {
      const status = diffSkill(readSources(sourceDir, name), readInstalled(home, name));
      const dot =
        status === "identical"
          ? ansi.green("●")
          : status === "differs"
            ? ansi.yellow("●")
            : ansi.dim("○");
      io.out(`  ${dot} /${name} ${ansi.dim(`— ${STATUS_LABEL[status]}`)}`);
      io.out(`      ${ansi.dim(skillDir(home, name))}`);
    }
    io.out(ansi.dim("\nInstall with `memhook skills install`. Invoke as /wrap, /curate, /relay."));
    return 0;
  }

  if (opts.subcommand === "uninstall") {
    const plans = names.map((name) =>
      planUninstall(name, readSources(sourceDir, name), readInstalled(home, name)),
    );
    const toRemove = plans.filter((p) => p.present);
    io.out(
      ansi.bold("memhook skills uninstall") + ansi.dim(" — remove bundled companion skills\n"),
    );
    if (toRemove.length === 0) {
      io.out(ansi.dim("No memhook companion skills found. Nothing to do."));
      return 0;
    }
    io.out(ansi.bold("Plan"));
    for (const p of plans) {
      if (p.present) {
        io.out(`  ${ansi.red("-")} /${p.name} ${ansi.dim(`(${p.removes.length} file(s))`)}`);
      } else {
        io.out(`  ${ansi.dim("·")} /${p.name} ${ansi.dim("(not installed — skip)")}`);
      }
    }
    if (opts.dryRun) {
      io.out(ansi.dim("\n(dry run — nothing removed)"));
      return 0;
    }
    if (interactive && !(await confirm(ansi, "[y/N]", false))) {
      io.out(ansi.dim("Aborted. Nothing removed."));
      return 0;
    }
    const stamp = stampNow();
    const skillsRoot = join(home, ".claude", "skills");
    let removed = 0;
    for (const p of toRemove) {
      const dir = skillDir(home, p.name);
      const source = readSources(sourceDir, p.name);
      for (const rel of p.removes) {
        const target = join(dir, rel);
        // Back up only a file the user edited (differs from shipped), and place
        // the backup OUTSIDE the skill dir so the dir can be cleanly removed. A
        // pristine shipped file is just deleted — it's recoverable by reinstall.
        let content: string | null = null;
        try {
          content = readFileSync(target, "utf8");
        } catch {
          /* already gone */
        }
        if (content !== null && content !== source[rel]) {
          const bak = join(skillsRoot, `${p.name}.${rel.replace(/[\\/]/g, "_")}.bak-${stamp}`);
          try {
            copyFileSync(target, bak);
          } catch {
            /* best-effort backup */
          }
        }
        try {
          unlinkSync(target);
          removed++;
        } catch {
          /* already gone */
        }
      }
      try {
        rmdirSync(dir); // only succeeds if the dir is now empty — leaves user files alone
      } catch {
        /* non-empty or missing — fine */
      }
    }
    io.out(`${ansi.green("✓")} removed ${removed} file(s) from ${toRemove.length} skill(s)`);
    io.out(ansi.dim("Restart Claude Code to drop the skills from the menu."));
    return 0;
  }

  // install
  io.out(ansi.bold("memhook skills install") + ansi.dim(" — copy /wrap, /curate, /relay\n"));
  const preview = installCompanionSkills({
    home,
    sourceDir,
    names,
    force: opts.force,
    dryRun: true,
  });
  const willWrite = preview.filter(
    (r) => r.plan.action === "install" || r.plan.action === "overwrite",
  );
  const blocked = preview.filter((r) => r.plan.action === "blocked");

  io.out(ansi.bold("Plan"));
  for (const r of preview) {
    const { name, action, status } = r.plan;
    if (action === "install") io.out(`  ${ansi.green("+")} /${name} ${ansi.dim("(new)")}`);
    else if (action === "overwrite")
      io.out(`  ${ansi.yellow("~")} /${name} ${ansi.dim("(overwrite — backup first)")}`);
    else if (action === "skip")
      io.out(`  ${ansi.dim("·")} /${name} ${ansi.dim("(up to date — skip)")}`);
    else
      io.out(
        `  ${ansi.yellow("!")} /${name} ${ansi.dim(`(${STATUS_LABEL[status]} — use --force to overwrite)`)}`,
      );
  }
  if (willWrite.length === 0) {
    if (blocked.length > 0) {
      io.out(
        ansi.dim(
          `\n${blocked.length} skill(s) differ from shipped. Re-run with --force to overwrite (a backup is made first).`,
        ),
      );
    } else {
      io.out(ansi.dim("\nAll skills are already up to date. Nothing to do."));
    }
    return 0;
  }
  if (opts.dryRun) {
    io.out(ansi.dim("\n(dry run — nothing written)"));
    return 0;
  }
  if (interactive && !(await confirm(ansi, "[Y/n]", true))) {
    io.out(ansi.dim("Aborted. Nothing written."));
    return 0;
  }
  const results = installCompanionSkills({ home, sourceDir, names, force: opts.force });
  const applied = results.filter((r) => r.applied);
  io.out(
    `${ansi.green("✓")} installed ${applied.length} skill(s) into ${skillDir(home, "<name>")}`,
  );
  if (blocked.length > 0) {
    io.out(
      ansi.dim(`  ${blocked.length} skill(s) left untouched (differ from shipped — use --force).`),
    );
  }
  io.out(ansi.dim("Restart Claude Code, then use /wrap, /curate, /relay."));
  return 0;
}

async function confirm(ansi: Ansi, hint: string, defaultYes: boolean): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(`\n${ansi.bold("Proceed?")} ${ansi.dim(hint)} `))
      .trim()
      .toLowerCase();
    if (a === "") return defaultYes;
    return a === "y" || a === "yes";
  } finally {
    rl.close();
  }
}
