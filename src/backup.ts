/**
 * Tiny shared backup helpers for the interactive commands (init / uninstall /
 * skills). Extracted so both `init.ts` and `skillsCmd.ts` can use them without
 * importing each other (which would create a module cycle).
 */

/** A backup path next to `path`, stamped so successive runs never collide. */
export function backupPath(path: string, stamp: string): string {
  return `${path}.bak-${stamp}`;
}

/** A filesystem-safe ISO-ish timestamp for backup filenames. */
export function stampNow(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-(\d{3})Z$/, "Z");
}
