/**
 * Zero-dependency ANSI styling for the interactive CLI commands
 * (`memhook init`, `memhook tail`).
 *
 * This module is NOT used by the hook entrypoint (`memhook run`) — the hook's
 * stdout is reserved for the JSON envelope and must stay byte-clean. Colour is
 * only ever emitted to a human-facing TTY.
 *
 * Colour is disabled (every styler becomes the identity function) when:
 *   - `NO_COLOR` is set (any value) — https://no-color.org/
 *   - `MEMHOOK_NO_COLOR` is set (memhook-specific opt-out)
 *   - `TERM=dumb`
 *   - the target stream is not a TTY (piped to a file / another process)
 * `FORCE_COLOR` (any value) overrides all of the above and forces colour on,
 * which is what the test-suite and `| less -R` rely on.
 */

/**
 * The ANSI escape introducer (0x1b). Built from a char code so the source file
 * stays printable ASCII — no raw control byte to be mangled by an editor,
 * `git`, or a copy/paste.
 */
const ESC = String.fromCharCode(27);
const CSI = `${ESC}[`;
const RESET = `${CSI}0m`;

export interface AnsiOptions {
  /** Whether the destination is an interactive terminal. */
  isTTY: boolean;
  env: NodeJS.ProcessEnv;
}

/** Decide once whether colour should be emitted for a given stream + env. */
export function colorEnabled({ isTTY, env }: AnsiOptions): boolean {
  if (env["FORCE_COLOR"] !== undefined && env["FORCE_COLOR"] !== "") return true;
  if (env["NO_COLOR"] !== undefined) return false;
  if (env["MEMHOOK_NO_COLOR"] !== undefined) return false;
  if (env["TERM"] === "dumb") return false;
  return isTTY;
}

/** SGR codes used by the CLI. Kept tiny on purpose. */
const CODES = {
  bold: 1,
  dim: 2,
  italic: 3,
  underline: 4,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  gray: 90,
  brightGreen: 92,
  brightCyan: 96,
} as const;

export type AnsiColor = keyof typeof CODES;

export interface Ansi {
  readonly enabled: boolean;
  /** Wrap `s` in the SGR code for `name`, or return it untouched if disabled. */
  style(name: AnsiColor, s: string): string;
  // Convenience shorthands — the ones the views actually use.
  bold(s: string): string;
  dim(s: string): string;
  red(s: string): string;
  green(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  gray(s: string): string;
}

/**
 * Build an `Ansi` styler. When colour is disabled every method is the identity
 * function, so call-sites never branch on `enabled` themselves.
 */
export function makeAnsi(opts: AnsiOptions): Ansi {
  const enabled = colorEnabled(opts);
  const wrap = (name: AnsiColor, s: string): string =>
    enabled ? `${CSI}${CODES[name]}m${s}${RESET}` : s;
  return {
    enabled,
    style: wrap,
    bold: (s) => wrap("bold", s),
    dim: (s) => wrap("dim", s),
    red: (s) => wrap("red", s),
    green: (s) => wrap("green", s),
    yellow: (s) => wrap("yellow", s),
    cyan: (s) => wrap("cyan", s),
    gray: (s) => wrap("gray", s),
  };
}

/** Matches any SGR escape sequence, e.g. "ESC[32m" or "ESC[0m". */
const SGR_RE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/**
 * Visible width of a string with ANSI escapes stripped — used to pad/align
 * columns correctly even when the cell contains colour codes.
 */
export function visibleWidth(s: string): number {
  return s.replace(SGR_RE, "").length;
}

/** Left-pad `s` to `width` visible columns (right-align). */
export function padStart(s: string, width: number): string {
  const gap = width - visibleWidth(s);
  return gap > 0 ? " ".repeat(gap) + s : s;
}

/** Right-pad `s` to `width` visible columns (left-align). */
export function padEnd(s: string, width: number): string {
  const gap = width - visibleWidth(s);
  return gap > 0 ? s + " ".repeat(gap) : s;
}

/** Truncate to `max` chars, appending `…` when cut. Callers pass plain text. */
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  if (max <= 1) return s.slice(0, max);
  return s.slice(0, max - 1) + "…";
}
