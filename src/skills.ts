/**
 * Pure planning core for `memhook skills install|uninstall|list`.
 *
 * Like src/install.ts, this module has NO file I/O. The orchestration layer
 * (src/skillsCmd.ts) reads the bundled skill files and the files already on
 * disk, calls these pure planners, and applies the result with backups.
 * Keeping the plan pure means the idempotency + non-clobbering guarantees are
 * unit-tested without touching anyone's real `~/.claude/skills`.
 *
 * memhook ships three STANDALONE companion skills in Claude Code's skill format
 * (`~/.claude/skills/<name>/SKILL.md`, invoked as `/<name>`):
 *
 *   /wrap   — end-of-session wrap-up (capture lessons into memory + journal)
 *   /curate — memory hygiene (dedupe, index sync, rebuild the catalog)
 *   /relay  — generate a handoff prompt for a fresh session
 *
 * Standalone — not a plugin — so the command names stay bare (`/wrap`, not
 * `/memhook:wrap`). See docs/SPECIFICATION.md "Companion skills".
 */

export const COMPANION_SKILLS = ["wrap", "curate", "relay"] as const;
export type CompanionSkill = (typeof COMPANION_SKILLS)[number];

/**
 * Files bundled for each skill, relative to the skill's own directory. The
 * orchestration layer reads `<sourceDir>/<name>/<relPath>` and writes
 * `~/.claude/skills/<name>/<relPath>`.
 */
export const SKILL_FILES: Record<CompanionSkill, readonly string[]> = {
  wrap: ["SKILL.md"],
  curate: ["SKILL.md", "reference.md"],
  relay: ["SKILL.md"],
};

export function isCompanionSkill(name: string): name is CompanionSkill {
  return (COMPANION_SKILLS as readonly string[]).includes(name);
}

/** Bundled content for one skill, keyed by relative path. */
export type SkillSources = Record<string, string>;
/** Installed content per relative path; `null` means the file is not on disk. */
export type InstalledFiles = Record<string, string | null>;

export type SkillStatus = "absent" | "identical" | "differs";
export type InstallAction = "install" | "skip" | "overwrite" | "blocked";

/**
 * Compare a skill's bundled files against what's on disk.
 *   - `absent`    — none of the skill's files are installed.
 *   - `identical` — every bundled file is installed with matching content.
 *   - `differs`   — installed but a file is missing or its content changed
 *                   (a user edit, or an older shipped version).
 */
export function diffSkill(source: SkillSources, installed: InstalledFiles): SkillStatus {
  const rels = Object.keys(source);
  const anyPresent = rels.some((r) => installed[r] != null);
  if (!anyPresent) return "absent";
  const allMatch = rels.every((r) => installed[r] != null && installed[r] === source[r]);
  return allMatch ? "identical" : "differs";
}

export interface SkillInstallPlan {
  name: CompanionSkill;
  status: SkillStatus;
  action: InstallAction;
  /** Relative paths that will be written for `install` / `overwrite`. */
  writes: string[];
}

/**
 * Plan one skill install. Idempotent: an `identical` skill is skipped. A skill
 * that `differs` is NEVER clobbered without `force` (it's reported `blocked`),
 * matching install.ts's "back up + never overwrite silently" stance. With
 * `force`, a differing skill is `overwrite` (the caller backs up first).
 */
export function planInstall(
  name: CompanionSkill,
  source: SkillSources,
  installed: InstalledFiles,
  opts: { force: boolean },
): SkillInstallPlan {
  const status = diffSkill(source, installed);
  let action: InstallAction;
  if (status === "absent") action = "install";
  else if (status === "identical") action = "skip";
  else action = opts.force ? "overwrite" : "blocked";
  const writes = action === "install" || action === "overwrite" ? Object.keys(source) : [];
  return { name, status, action, writes };
}

export interface SkillUninstallPlan {
  name: CompanionSkill;
  present: boolean;
  action: "remove" | "skip";
  /** Relative paths that exist on disk and will be deleted. */
  removes: string[];
}

/** Plan one skill uninstall: remove only the files memhook ships, if present. */
export function planUninstall(
  name: CompanionSkill,
  source: SkillSources,
  installed: InstalledFiles,
): SkillUninstallPlan {
  const removes = Object.keys(source).filter((r) => installed[r] != null);
  const present = removes.length > 0;
  return { name, present, action: present ? "remove" : "skip", removes };
}
