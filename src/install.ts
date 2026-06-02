/**
 * Pure settings.json hook wiring — the dangerous-but-testable core of
 * `memhook init` / `memhook uninstall`.
 *
 * Everything here is a pure data transform: it takes the parsed contents of
 * `~/.claude/settings.json` and returns a NEW object with memhook's hooks
 * added or removed. There is NO file I/O in this module — the orchestration
 * layer (`src/init.ts`) handles reading, backing up, and writing. Keeping the
 * merge pure means the idempotency / non-clobbering guarantees are unit-tested
 * without touching anyone's real config (the one file we must never corrupt).
 *
 * The Claude Code hook shape (sourced from the README + docs/SPECIFICATION.md
 * §10) is:
 *
 *   {
 *     "hooks": {
 *       "UserPromptSubmit": [ { "hooks": [ { "type": "command", "command": "memhook run" } ] } ],
 *       "SessionStart":     [ { "hooks": [ { "type": "command", "command": "memhook build-catalog" } ] } ]
 *     }
 *   }
 *
 * Each event maps to an array of matcher-groups; each group has a `hooks` array
 * of `{ type, command }`. memhook contributes one group per event and leaves
 * every other key — and every other user hook — untouched.
 */

/** The two events memhook wires, paired with the subcommand each runs. */
export const MEMHOOK_HOOKS = [
  { event: "UserPromptSubmit", subcommand: "run" },
  { event: "SessionStart", subcommand: "build-catalog" },
] as const;

export type HookEvent = (typeof MEMHOOK_HOOKS)[number]["event"];

export interface HookCommand {
  type: "command";
  command: string;
  [key: string]: unknown;
}

export interface HookGroup {
  hooks?: HookCommand[];
  [key: string]: unknown;
}

export interface Settings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export interface AddResult {
  settings: Settings;
  /** Events where a memhook hook was newly added. */
  added: HookEvent[];
  /** Events where a memhook hook was already present (idempotent no-op). */
  alreadyPresent: HookEvent[];
}

export interface RemoveResult {
  settings: Settings;
  /** Number of individual memhook hook commands removed. */
  removed: number;
  /** Event names a memhook hook was removed from. */
  removedEvents: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * If `command` invokes the memhook binary, return its subcommand
 * (e.g. "run", "build-catalog"), else null. Matches the README form
 * (`memhook run`), an absolute-path form (`/usr/local/bin/memhook run`), and a
 * node form (`node dist/bin/memhook.js run`). Detection is binary-name based
 * (not the configured invocation), so `uninstall` cleans up a hook regardless
 * of how it was originally written.
 */
export function memhookSubcommand(command: unknown): string | null {
  if (typeof command !== "string") return null;
  const m = command.match(/(?:^|[\s/\\])memhook(?:\.[cm]?js)?["']?\s+([a-z][a-z-]*)/i);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** True if `group` contains a memhook hook for `subcommand`. */
function groupHasMemhook(group: HookGroup, subcommand: string): boolean {
  if (!Array.isArray(group.hooks)) return false;
  return group.hooks.some((h) => memhookSubcommand(h?.command) === subcommand);
}

/**
 * Return a deep clone with memhook's hooks added. Idempotent: an event that
 * already has a memhook hook for its subcommand is left untouched. Every other
 * key and every other user hook is preserved exactly.
 *
 * @param input  parsed settings.json (non-object input is treated as `{}`)
 * @param bin    the command used to invoke memhook (default `"memhook"`)
 */
export function addHooks(input: unknown, bin = "memhook"): AddResult {
  const settings: Settings = isPlainObject(input) ? (structuredClone(input) as Settings) : {};
  if (!isPlainObject(settings.hooks)) settings.hooks = {};
  const hooks = settings.hooks;

  const added: HookEvent[] = [];
  const alreadyPresent: HookEvent[] = [];

  for (const { event, subcommand } of MEMHOOK_HOOKS) {
    const list = Array.isArray(hooks[event]) ? hooks[event] : (hooks[event] = []);
    if (list.some((g) => isPlainObject(g) && groupHasMemhook(g, subcommand))) {
      alreadyPresent.push(event);
      continue;
    }
    list.push({ hooks: [{ type: "command", command: `${bin} ${subcommand}` }] });
    added.push(event);
  }

  return { settings, added, alreadyPresent };
}

/**
 * Return a deep clone with every memhook hook removed. Scans ALL hook events
 * (not just the two memhook registers) so a hook moved by hand is still cleaned
 * up. Empties that result — a group whose `hooks` becomes empty, an event whose
 * group list becomes empty — are pruned so no dangling shells are left behind.
 */
export function removeHooks(input: unknown): RemoveResult {
  const settings: Settings = isPlainObject(input) ? (structuredClone(input) as Settings) : {};
  let removed = 0;
  const removedEvents: string[] = [];

  if (!isPlainObject(settings.hooks)) return { settings, removed, removedEvents };
  const hooks = settings.hooks;

  for (const event of Object.keys(hooks)) {
    const list = hooks[event];
    if (!Array.isArray(list)) continue;

    let removedHere = 0;
    const kept: HookGroup[] = [];
    for (const group of list) {
      if (!isPlainObject(group) || !Array.isArray(group.hooks)) {
        kept.push(group as HookGroup);
        continue;
      }
      const before = group.hooks.length;
      group.hooks = group.hooks.filter((h) => memhookSubcommand(h?.command) === null);
      removedHere += before - group.hooks.length;
      // Drop a group only if WE emptied it (a group that was already empty, or
      // empty for other reasons, is preserved untouched).
      if (group.hooks.length > 0 || before === 0) kept.push(group);
    }

    if (removedHere > 0) {
      removed += removedHere;
      removedEvents.push(event);
      if (kept.length > 0) hooks[event] = kept;
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      else delete hooks[event];
    }
  }

  return { settings, removed, removedEvents };
}
