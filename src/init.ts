/**
 * `memhook init` / `memhook uninstall` orchestration.
 *
 * These are INTERACTIVE, user-invoked commands — NOT the hook entrypoint. They
 * are allowed to prompt, own the TTY, print to stdout, and exit non-zero on
 * user error (docs/SPECIFICATION.md §9: "memhook run is the only command that
 * must obey the fail-soft contract"). The one hard rule: they must never
 * corrupt `~/.claude/settings.json`. So:
 *   - the merge itself is pure + unit-tested (src/install.ts),
 *   - an unparseable settings file aborts rather than being overwritten,
 *   - every write is preceded by a timestamped backup,
 *   - `--dry-run` prints the plan and writes nothing.
 *
 * All file I/O lives here; `install.ts` stays pure.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { stringify as yamlStringify } from "yaml";
import { addHooks, removeHooks, type Settings } from "./install.js";
import { buildCatalog } from "./catalog.js";
import { loadConfig, type ProviderType } from "./config.js";
import { makeAnsi, type Ansi } from "./ansi.js";

const PROVIDERS: ProviderType[] = ["anthropic", "openai", "ollama"];
const DEFAULT_KEY_ENV: Record<ProviderType, string | undefined> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ollama: undefined,
};

export interface InitOptions {
  yes: boolean;
  dryRun: boolean;
  provider?: ProviderType | undefined;
  apiKeyEnv?: string | undefined;
  model?: string | undefined;
  bin: string;
  settingsPath?: string | undefined;
  noCatalog?: boolean | undefined;
}

export interface UninstallOptions {
  yes: boolean;
  dryRun: boolean;
  settingsPath?: string | undefined;
  purge?: boolean | undefined;
}

/** A backup path next to `path`, stamped so successive runs never collide. */
export function backupPath(path: string, stamp: string): string {
  return `${path}.bak-${stamp}`;
}

function stampNow(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/-(\d{3})Z$/, "Z");
}

function defaultSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function configYamlPath(): string {
  return join(homedir(), ".config", "memhook", "config.yaml");
}

/**
 * Build the minimal YAML config object for the chosen provider — only keys that
 * differ from the built-in defaults are emitted, so the file stays small and
 * the anthropic-default install writes no config at all.
 */
export function buildConfigObject(opts: {
  provider: ProviderType;
  model?: string | undefined;
  apiKeyEnv?: string | undefined;
}): Record<string, unknown> | null {
  const provider: Record<string, unknown> = {};
  if (opts.provider !== "anthropic") provider["type"] = opts.provider;
  if (opts.model) provider["model"] = opts.model;
  if (opts.apiKeyEnv && opts.apiKeyEnv !== DEFAULT_KEY_ENV[opts.provider]) {
    provider["apiKeyEnv"] = opts.apiKeyEnv;
  }
  return Object.keys(provider).length > 0 ? { provider } : null;
}

interface Io {
  out: (s: string) => void;
  ansi: Ansi;
}

function makeIo(env: NodeJS.ProcessEnv): Io {
  const ansi = makeAnsi({ isTTY: Boolean(process.stdout.isTTY), env });
  return { out: (s) => process.stdout.write(s + "\n"), ansi };
}

/** Read + JSON-parse settings; returns `{}` for a missing file, throws for invalid JSON. */
function readSettings(path: string): Settings {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as Settings;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

// ── memhook init ──────────────────────────────────────────────────────────

export async function runInit(
  opts: InitOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const io = makeIo(env);
  const { ansi } = io;
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const interactive = !opts.yes && Boolean(process.stdin.isTTY) && !opts.dryRun;

  io.out(ansi.bold("memhook init") + ansi.dim(" — wire memhook into Claude Code\n"));

  // 1. Provider / key / model — flags win, then prompts, then defaults.
  let provider: ProviderType = opts.provider ?? "anthropic";
  const model = opts.model;
  let apiKeyEnv = opts.apiKeyEnv;

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const p = (await rl.question(`Provider ${ansi.dim("[anthropic]")} / openai / ollama: `))
        .trim()
        .toLowerCase();
      if (p && (PROVIDERS as string[]).includes(p)) provider = p as ProviderType;

      if (provider !== "ollama") {
        const defKey = DEFAULT_KEY_ENV[provider];
        const k = (await rl.question(`API key env var ${ansi.dim(`[${defKey}]`)}: `)).trim();
        apiKeyEnv = k || apiKeyEnv || defKey;
      }
    } finally {
      rl.close();
    }
  } else {
    apiKeyEnv = apiKeyEnv ?? DEFAULT_KEY_ENV[provider];
  }

  // 2. Compute the settings.json merge (pure).
  let existing: Settings;
  try {
    existing = readSettings(settingsPath);
  } catch {
    io.out(
      ansi.red("✗ ") +
        `${settingsPath} is not valid JSON. Refusing to overwrite it.\n` +
        ansi.dim("  Fix or move the file, then re-run `memhook init`."),
    );
    return 1;
  }
  const merge = addHooks(existing, opts.bin);
  const configObj = buildConfigObject({ provider, model, apiKeyEnv });

  // 3. Plan summary.
  io.out(ansi.bold("\nPlan"));
  if (merge.added.length > 0) {
    io.out(`  ${ansi.green("+")} hook ${merge.added.join(" + ")} → ${settingsPath}`);
    io.out(`      ${ansi.dim(`backup → ${backupPath(settingsPath, "<timestamp>")}`)}`);
  }
  for (const ev of merge.alreadyPresent) {
    io.out(`  ${ansi.dim("·")} hook ${ev} already wired ${ansi.dim("(skip)")}`);
  }
  if (configObj) {
    io.out(
      `  ${ansi.green("+")} config → ${configYamlPath()} ${ansi.dim(`(provider: ${provider})`)}`,
    );
  } else {
    io.out(
      `  ${ansi.dim("·")} provider anthropic (default) ${ansi.dim("— no config file needed")}`,
    );
  }
  if (!opts.noCatalog) io.out(`  ${ansi.green("+")} build catalog`);

  // 4. API-key heads-up (never blocks; just warns).
  if (provider !== "ollama" && apiKeyEnv && !env[apiKeyEnv]) {
    io.out(
      `\n  ${ansi.yellow("!")} ${apiKeyEnv} is not set in this shell — ` +
        ansi.dim(`export it before memhook can route (the hook fails soft until then).`),
    );
  }

  if (opts.dryRun) {
    io.out(ansi.dim("\n(dry run — nothing written)"));
    return 0;
  }

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const go = (await rl.question(`\n${ansi.bold("Proceed?")} ${ansi.dim("[Y/n]")} `))
        .trim()
        .toLowerCase();
      if (go === "n" || go === "no") {
        io.out(ansi.dim("Aborted. Nothing written."));
        return 0;
      }
    } finally {
      rl.close();
    }
  }

  // 5. Write (settings first, with backup).
  const stamp = stampNow();
  if (merge.added.length > 0) {
    if (existsSync(settingsPath)) copyFileSync(settingsPath, backupPath(settingsPath, stamp));
    writeJson(settingsPath, merge.settings);
    io.out(`${ansi.green("✓")} wired ${merge.added.join(" + ")} into ${settingsPath}`);
  }
  if (configObj) {
    const cfgPath = configYamlPath();
    if (existsSync(cfgPath)) copyFileSync(cfgPath, backupPath(cfgPath, stamp));
    mkdirSync(dirname(cfgPath), { recursive: true });
    writeFileSync(cfgPath, yamlStringify(configObj), "utf8");
    io.out(`${ansi.green("✓")} wrote ${cfgPath}`);
  }

  // 6. Bootstrap memory dirs so build-catalog + the router have somewhere to look.
  for (const d of [join(homedir(), ".claude", "rules"), join(homedir(), ".claude", "projects")]) {
    mkdirSync(d, { recursive: true });
  }

  // 7. Seed the catalog.
  if (!opts.noCatalog) {
    try {
      const config = loadConfig(env);
      const res = buildCatalog({ cwd: process.cwd(), outputPath: config.catalog.path });
      io.out(`${ansi.green("✓")} catalog ${config.catalog.path} ${ansi.dim(`(${res.lines}L)`)}`);
    } catch {
      io.out(ansi.yellow("! ") + "catalog build skipped (run `memhook build-catalog` later)");
    }
  }

  io.out(
    `\n${ansi.green("Done.")} Restart Claude Code, then watch it live with ` +
      ansi.bold("memhook tail") +
      ".",
  );
  return 0;
}

// ── memhook uninstall ───────────────────────────────────────────────────────

export async function runUninstall(
  opts: UninstallOptions,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const io = makeIo(env);
  const { ansi } = io;
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const interactive = !opts.yes && Boolean(process.stdin.isTTY) && !opts.dryRun;

  io.out(ansi.bold("memhook uninstall") + ansi.dim(" — remove memhook hooks\n"));

  let existing: Settings;
  try {
    existing = readSettings(settingsPath);
  } catch {
    io.out(ansi.red("✗ ") + `${settingsPath} is not valid JSON. Refusing to touch it.`);
    return 1;
  }

  const result = removeHooks(existing);
  if (result.removed === 0) {
    io.out(ansi.dim("No memhook hooks found. Nothing to do."));
    return 0;
  }

  io.out(ansi.bold("Plan"));
  io.out(
    `  ${ansi.red("-")} ${result.removed} memhook hook(s) from ${result.removedEvents.join(" + ")}`,
  );
  io.out(`      ${ansi.dim(`backup → ${backupPath(settingsPath, "<timestamp>")}`)}`);
  if (opts.purge) io.out(`  ${ansi.red("-")} purge cache + log`);

  if (opts.dryRun) {
    io.out(ansi.dim("\n(dry run — nothing written)"));
    return 0;
  }

  if (interactive) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const go = (await rl.question(`\n${ansi.bold("Proceed?")} ${ansi.dim("[y/N]")} `))
        .trim()
        .toLowerCase();
      if (go !== "y" && go !== "yes") {
        io.out(ansi.dim("Aborted. Nothing written."));
        return 0;
      }
    } finally {
      rl.close();
    }
  }

  const stamp = stampNow();
  if (existsSync(settingsPath)) copyFileSync(settingsPath, backupPath(settingsPath, stamp));
  writeJson(settingsPath, result.settings);
  io.out(`${ansi.green("✓")} removed ${result.removed} hook(s) from ${settingsPath}`);

  if (opts.purge) {
    const config = loadConfig(env);
    for (const target of [config.cache.dir, config.logging.jsonlPath]) {
      io.out(ansi.dim(`  (left in place: ${target} — remove manually if desired)`));
    }
  }

  io.out(`\n${ansi.green("Done.")} Restart Claude Code to drop the hooks.`);
  return 0;
}
