/**
 * `memhook presets list|detect` — discover the built-in per-host source presets
 * so the user never has to know a preset's name or hand-write its paths.
 *
 *   list    Show every built-in preset (name, summary, the dirs/globs it points
 *           at). Static — no disk access.
 *   detect  Scan this project (cwd) + the home dir for the preset directories
 *           that actually hold matching `.md` files, then print the YAML snippet
 *           (`presets: [...]`) that enables the ones found.
 *
 * This is the I/O shell around the pure detector in `src/sources.ts`
 * (`detectPresets`), the same functional-core / imperative-shell split as
 * init.ts ↔ install.ts and skillsCmd.ts ↔ skills.ts. `presets` is NOT on the
 * hook path, so it may exit non-zero on user error and use the TTY
 * (docs/SPECIFICATION.md §9). The detector never throws (a missing/denied dir is
 * recorded as absent), so detect/list always exit 0.
 */

import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { makeAnsi, type Ansi } from "./ansi.js";
import { HOST_PRESETS, PRESET_NAMES, detectPresets, type PresetDetection } from "./sources.js";

export type PresetsSubcommand = "list" | "detect";

export interface RunPresetsOptions {
  subcommand: PresetsSubcommand;
  /** Test seams. */
  cwd?: string | undefined;
  home?: string | undefined;
  readDir?: ((dir: string) => string[]) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  out?: ((s: string) => void) | undefined;
}

interface Io {
  out: (s: string) => void;
  ansi: Ansi;
}

function makeIo(env: NodeJS.ProcessEnv, out?: (s: string) => void): Io {
  const ansi = makeAnsi({ isTTY: Boolean(process.stdout.isTTY), env });
  return { out: out ?? ((s) => process.stdout.write(s + "\n")), ansi };
}

/** Display a source dir + glob with a portable separator (path.join, never "/"). */
function dirGlob(dir: string, glob: string): string {
  return join(dir, glob);
}

export function runPresets(opts: RunPresetsOptions): number {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const home = opts.home ?? homedir();
  const readDir = opts.readDir ?? ((dir: string) => readdirSync(dir));
  const io = makeIo(env, opts.out);

  if (opts.subcommand === "list") return runList(io, cwd, home);
  return runDetect(io, cwd, home, readDir);
}

function runList(io: Io, cwd: string, home: string): number {
  const { ansi } = io;
  io.out(
    ansi.bold("memhook host presets") + ansi.dim(" — built-in source bundles (all experimental)\n"),
  );
  for (const name of PRESET_NAMES) {
    const def = HOST_PRESETS[name];
    if (!def) continue;
    io.out(`  ${ansi.cyan(name)} ${ansi.dim("(experimental)")}`);
    io.out(`      ${ansi.dim(def.summary)}`);
    for (const s of def.sources) {
      const dir = join(s.base === "cwd" ? cwd : home, s.rel);
      io.out(`      ${ansi.dim(dirGlob(dir, s.glob))}`);
    }
  }
  io.out(
    ansi.dim(
      "\nAll presets are doc-verified but not live-tested → experimental " +
        "until an echo-test.\nEnable in ~/.config/memhook/config.yaml:  " +
        "presets: [name, …]\nFind which apply here with `memhook presets detect`.",
    ),
  );
  return 0;
}

function runDetect(io: Io, cwd: string, home: string, readDir: (dir: string) => string[]): number {
  const { ansi } = io;
  const detections = detectPresets(cwd, home, readDir);
  const matched = detections.filter((d) => d.matched);

  io.out(
    ansi.bold("memhook presets detect") +
      ansi.dim(" — scan this project + home for known host memory\n"),
  );

  for (const d of detections) {
    const total = fileCount(d);
    if (d.matched) {
      io.out(`  ${ansi.green("●")} ${ansi.cyan(d.name)} ${ansi.dim(`— ${total} file(s)`)}`);
      for (const dir of d.dirs) {
        if (dir.files.length === 0) continue;
        io.out(`      ${ansi.dim(`${dirGlob(dir.dir, dir.glob)} (${dir.files.length})`)}`);
      }
    } else {
      io.out(`  ${ansi.dim("○")} ${ansi.dim(`${d.name} — no matching files`)}`);
    }
  }

  if (matched.length === 0) {
    io.out(ansi.dim("\nNo known host memory found under this project or home. Nothing to enable."));
    return 0;
  }

  const names = matched.map((d) => d.name).join(", ");
  io.out(
    "\n" +
      ansi.bold(`Found ${matched.length} host preset(s) with memory.`) +
      ansi.dim(" Enable (experimental) by adding to\n~/.config/memhook/config.yaml:\n"),
  );
  io.out(`  ${ansi.cyan(`presets: [${names}]`)}`);
  io.out(ansi.dim("\nThen run `memhook build-catalog` (or restart Claude Code) to catalog them."));
  return 0;
}

function fileCount(d: PresetDetection): number {
  return d.dirs.reduce((n, dir) => n + dir.files.length, 0);
}
