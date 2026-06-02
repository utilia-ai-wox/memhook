/**
 * `memhook tail` — a pretty, live view of the JSONL routing log.
 *
 * This is the human-facing twin of `tail -f ~/.claude/logs/memhook.log | jq`:
 * it reads the SAME frozen log the router writes (docs/SPECIFICATION.md §14 —
 * "the memhook tail TUI parses it"), and renders each routing decision as a
 * colourised row. It only ever READS the log, so it can never affect the hook.
 *
 * No TUI framework, no dependency: the layout is plain column padding + the
 * `src/ansi.ts` styler, which degrades to clean text when stdout is not a TTY
 * (so `memhook tail --no-follow > report.txt` is well-behaved).
 *
 * Pure rendering (`parseLogLine`, `formatRow`, the stats reducer) is split from
 * the follow-loop shell so the formatting is unit-tested without a terminal.
 */

import { existsSync, openSync, readSync, closeSync, readFileSync, statSync } from "node:fs";
import { loadConfig } from "./config.js";
import { MEMHOOK_VERSION } from "./version.js";
import { makeAnsi, padStart, padEnd, truncate, type Ansi, type AnsiColor } from "./ansi.js";

// ── parsed log row ──────────────────────────────────────────────────────────

export interface LogRow {
  ts: string;
  promptPreview: string;
  selected: string[];
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  status: string;
  /** Provider model recorded for the entry (added v0.3); null on older lines. */
  model: string | null;
}

function asInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0;
}

/** Parse one JSONL line into a `LogRow`, or null if it isn't a usable entry. */
export function parseLogLine(line: string): LogRow | null {
  let obj: unknown;
  try {
    obj = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  if (typeof o["status"] !== "string") return null;
  const selected = Array.isArray(o["selected"])
    ? o["selected"].filter((x): x is string => typeof x === "string")
    : [];
  return {
    ts: typeof o["ts"] === "string" ? o["ts"] : "",
    promptPreview: typeof o["prompt_preview"] === "string" ? o["prompt_preview"] : "",
    selected,
    latencyMs: asInt(o["latency_ms"]),
    tokensIn: asInt(o["tokens_in"]),
    tokensOut: asInt(o["tokens_out"]),
    status: o["status"],
    model: typeof o["model"] === "string" ? o["model"] : null,
  };
}

// ── status presentation ──────────────────────────────────────────────────────

interface StatusStyle {
  label: string;
  color: AnsiColor;
}

const STATUS_STYLE: Record<string, StatusStyle> = {
  ok: { label: "ok", color: "green" },
  cache_hit: { label: "cache", color: "cyan" },
  pre_filter_skip: { label: "skip", color: "gray" },
  empty_selection: { label: "empty", color: "yellow" },
  all_unfound: { label: "unfound", color: "yellow" },
  no_catalog: { label: "no catalog", color: "red" },
  no_api_key: { label: "no key", color: "red" },
  api_no_response: { label: "api err", color: "red" },
  api_no_content: { label: "api err", color: "red" },
  parse_invalid: { label: "bad json", color: "red" },
  provider_init_failed: { label: "init err", color: "red" },
};

function styleFor(status: string): StatusStyle {
  return STATUS_STYLE[status] ?? { label: status, color: "gray" };
}

const STATUS_W = Math.max(...Object.values(STATUS_STYLE).map((s) => s.label.length));

/** HH:MM:SS from an ISO timestamp, or the raw value clipped if unparseable. */
export function formatTime(ts: string): string {
  const m = ts.match(/T(\d{2}:\d{2}:\d{2})/);
  return m?.[1] ?? truncate(ts, 8).padEnd(8);
}

/** Compact latency: "142ms" under a second, "2.0s" above. */
export function formatLatency(ms: number): string {
  if (ms <= 0) return "0ms";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Right-most column: which model handled the entry (mirrors the mockup). */
export function modelCell(row: LogRow): string {
  if (row.status === "pre_filter_skip") return "dropped";
  if (row.status === "cache_hit") return "—";
  // Statuses that never reached the provider have no model to show.
  if (row.status === "no_catalog" || row.status === "no_api_key") return "—";
  return row.model ?? "—";
}

const LAT_W = 6;
const MODEL_W = 18;

/**
 * Render one log row to one or two lines: the primary row (time · status ·
 * prompt · latency · model) plus, when memories were injected, a dim secondary
 * line listing them — the whole reason memhook exists is to see WHICH memories
 * were picked.
 */
export function formatRow(row: LogRow, ansi: Ansi, columns = 80): string {
  const st = styleFor(row.status);
  const time = ansi.dim(formatTime(row.ts));
  const status = ansi.style(st.color, padEnd(st.label, STATUS_W));
  const latency = ansi.dim(padStart(formatLatency(row.latencyMs), LAT_W));
  const model = ansi.dim(truncate(modelCell(row), MODEL_W));

  // Prompt preview fills the space left between the fixed columns. The budget
  // is constant per row (5 two-col gaps + time + status + latency + a reserved
  // model column) so latency and model line up vertically across every row —
  // the preview never borrows from the model column's width.
  const fixed = 2 * 5 + 8 + STATUS_W + LAT_W + MODEL_W;
  const previewW = Math.max(12, columns - fixed);
  const preview = row.promptPreview
    ? ansi.style("white", `"${truncate(row.promptPreview, previewW - 2)}"`)
    : ansi.dim('""');

  const main = `  ${time}  ${status}  ${padEnd(preview, previewW)}  ${latency}  ${model}`;

  if (row.selected.length === 0) return main;
  const trimmed = row.selected.map((f) => f.replace(/\.md$/, ""));
  const files = ansi.dim(`     ↳ ${truncate(trimmed.join(" · "), Math.max(20, columns - 8))}`);
  return `${main}\n${files}`;
}

// ── running stats ────────────────────────────────────────────────────────────

export interface Stats {
  count: number;
  byStatus: Record<string, number>;
  latencies: number[];
}

export function emptyStats(): Stats {
  return { count: 0, byStatus: {}, latencies: [] };
}

export function accumulate(stats: Stats, row: LogRow): void {
  stats.count++;
  stats.byStatus[row.status] = (stats.byStatus[row.status] ?? 0) + 1;
  // Percentiles only over rows that actually called the provider (skips/cache
  // hits sit near 0ms and would flatten the distribution).
  if (row.latencyMs > 0) stats.latencies.push(row.latencyMs);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

export interface StatsSummary {
  count: number;
  cachePct: number;
  okPct: number;
  p50: number;
  p95: number;
}

export function summarize(stats: Stats): StatsSummary {
  const ok = stats.byStatus["ok"] ?? 0;
  const cache = stats.byStatus["cache_hit"] ?? 0;
  const delivered = ok + cache;
  const sorted = [...stats.latencies].sort((a, b) => a - b);
  return {
    count: stats.count,
    cachePct: delivered > 0 ? Math.round((cache / delivered) * 100) : 0,
    okPct: stats.count > 0 ? Math.round((delivered / stats.count) * 100) : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
  };
}

// ── header / footer ──────────────────────────────────────────────────────────

function divider(ansi: Ansi, columns: number): string {
  return ansi.dim("  " + "─".repeat(Math.max(10, Math.min(columns - 2, 72))));
}

export interface HeaderInfo {
  version: string;
  provider: string;
  model: string;
  logPath: string;
  follow: boolean;
}

export function formatHeader(info: HeaderInfo, ansi: Ansi, columns = 80): string {
  const live = info.follow ? ansi.green("● live") : ansi.dim("○ snapshot");
  const title = ansi.bold("memhook");
  const who = ansi.dim(`${info.provider} · ${info.model}`);
  const ver = ansi.dim(`v${info.version}`);
  const lines = [
    `  ${title}  ${live}    ${who}    ${ver}`,
    ansi.dim(`  ${info.logPath}`),
    divider(ansi, columns),
  ];
  if (info.follow) lines.push(ansi.dim("  ⌃C to quit"));
  return lines.join("\n");
}

export function formatFooter(stats: Stats, ansi: Ansi, columns = 80): string {
  const s = summarize(stats);
  const noun = s.count === 1 ? "prompt" : "prompts";
  const parts = [
    ansi.bold(`${s.count} ${noun}`),
    `${s.cachePct}% cache`,
    `${s.okPct}% delivered`,
    `p50 ${s.p50}ms`,
    `p95 ${s.p95}ms`,
  ];
  return `${divider(ansi, columns)}\n  ${parts.join(ansi.dim(" · "))}`;
}

// ── pure helpers shared with the follow loop ────────────────────────────────

/** Last `n` non-empty lines of `text`. */
export function tailLines(text: string, n: number): string[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return n >= lines.length ? lines : lines.slice(lines.length - n);
}

function passesFilter(row: LogRow, filter: Set<string> | null): boolean {
  return filter === null || filter.has(row.status);
}

// ── follow loop (shell) ──────────────────────────────────────────────────────

export interface TailOptions {
  file?: string | undefined;
  lines: number;
  noFollow: boolean;
  status?: string[] | undefined;
}

const POLL_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Read `len` bytes at `offset` from `path` as utf8 (best-effort). */
function readChunk(path: string, offset: number, len: number): string {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(len);
    const read = readSync(fd, buf, 0, len, offset);
    return buf.toString("utf8", 0, read);
  } finally {
    closeSync(fd);
  }
}

export async function runTail(
  opts: TailOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const config = loadConfig(env);
  const logPath = opts.file ?? config.logging.jsonlPath;
  const ansi = makeAnsi({ isTTY: Boolean(process.stdout.isTTY), env });
  const columns = process.stdout.columns ?? 80;
  const filter = opts.status && opts.status.length > 0 ? new Set(opts.status) : null;
  const out = (s: string): void => void process.stdout.write(s + "\n");

  out(
    formatHeader(
      {
        version: MEMHOOK_VERSION,
        provider: config.provider.type,
        model: config.provider.model,
        logPath,
        follow: !opts.noFollow,
      },
      ansi,
      columns,
    ),
  );

  const stats = emptyStats();
  const render = (line: string): void => {
    const row = parseLogLine(line);
    if (!row) return;
    accumulate(stats, row);
    if (passesFilter(row, filter)) out(formatRow(row, ansi, columns));
  };

  // Initial tail of the existing log. Capture the follow offset from the SAME
  // buffer rendered here, so a line appended between this read and the offset
  // snapshot can't be skipped in the live view.
  let offset = 0;
  if (existsSync(logPath)) {
    const initial = readFileSync(logPath, "utf8");
    for (const line of tailLines(initial, opts.lines)) render(line);
    offset = Buffer.byteLength(initial, "utf8");
  }

  if (opts.noFollow) {
    out(formatFooter(stats, ansi, columns));
    return 0;
  }

  // Follow by polling (robust + cross-platform; fs.watch semantics vary by OS).
  let stop = false;
  const stopped = new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      stop = true;
      resolve();
    });
  });
  if (!existsSync(logPath)) out(ansi.dim("  waiting for the first prompt…"));

  let buffer = "";
  while (!stop) {
    await Promise.race([sleep(POLL_MS), stopped]);
    if (stop) break;
    try {
      if (!existsSync(logPath)) continue;
      const size = statSync(logPath).size;
      if (size < offset) {
        offset = 0; // truncated / rotated
        buffer = "";
      }
      if (size > offset) {
        buffer += readChunk(logPath, offset, size - offset);
        offset = size;
        const parts = buffer.split("\n");
        buffer = parts.pop() ?? "";
        for (const line of parts) if (line.trim() !== "") render(line);
      }
    } catch {
      // Transient (file rotated out from under us) — retry next tick.
    }
  }

  out("\n" + formatFooter(stats, ansi, columns));
  return 0;
}
