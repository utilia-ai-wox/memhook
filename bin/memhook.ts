#!/usr/bin/env node
/**
 * memhook CLI.
 *
 *   memhook run            Read stdin (Claude Code hook JSON), write hook output
 *   memhook build-catalog  Rebuild ~/.claude/cache/memory-catalog.txt
 *   memhook init           Wire memhook into ~/.claude/settings.json (interactive)
 *   memhook uninstall      Remove memhook's hooks from ~/.claude/settings.json
 *   memhook tail           Pretty live view of the JSONL routing log
 *   memhook version        Print package version
 *
 * Only `run` obeys the fail-soft hook contract (never throws, never exits
 * non-zero). The interactive commands (`init`/`uninstall`/`tail`) may exit
 * non-zero on user error and are free to use the TTY — docs/SPECIFICATION.md §9.
 *
 * Wired into ~/.claude/settings.json hooks (see `memhook init`):
 *   "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "memhook run" }] }]
 *   "SessionStart":     [{ "hooks": [{ "type": "command", "command": "memhook build-catalog" }] }]
 */

import { route } from "../src/router.js";
import { buildCatalog } from "../src/catalog.js";
import { loadConfig, type ProviderType } from "../src/config.js";
import { runInit, runUninstall } from "../src/init.js";
import { runTail } from "../src/tail.js";
import { runSkills, type SkillsSubcommand } from "../src/skillsCmd.js";
import { isCompanionSkill, type CompanionSkill } from "../src/skills.js";
import { MEMHOOK_VERSION as VERSION } from "../src/version.js";

const PROVIDERS = ["anthropic", "openai", "ollama"];
const SKILLS_SUBCOMMANDS = ["install", "uninstall", "list"];

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  const args = process.argv.slice(3);
  switch (cmd) {
    case "run":
      await cmdRun();
      break;
    case "build-catalog":
      cmdBuildCatalog();
      break;
    case "init":
      process.exitCode = await cmdInit(args);
      break;
    case "uninstall":
      process.exitCode = await cmdUninstall(args);
      break;
    case "tail":
      process.exitCode = await cmdTail(args);
      break;
    case "skills":
      process.exitCode = await cmdSkills(args);
      break;
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`memhook: unknown command "${cmd}"`);
      printHelp();
      process.exit(1);
  }
}

async function cmdRun(): Promise<void> {
  // Fail-soft: read stdin AND route inside one try, so ANY error — a stdin
  // read error (stdin 'error' event) just as much as a routing error — falls
  // back to empty additionalContext and exit 0, never a non-zero exit that
  // would block the user prompt.
  let output = {
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit" as const,
      additionalContext: "",
    },
  };
  try {
    output = await route(await readStdin());
  } catch (err) {
    if (process.env["MEMHOOK_DEBUG"] === "true") {
      process.stderr.write(`memhook run error: ${String(err)}\n`);
    }
  }
  process.stdout.write(JSON.stringify(output) + "\n");
}

function cmdBuildCatalog(): void {
  const config = loadConfig();
  const result = buildCatalog({
    cwd: process.cwd(),
    outputPath: config.catalog.path,
  });
  process.stderr.write(
    `[memhook build-catalog] ${config.catalog.path} — ${result.lines}L, ${result.bytes}B\n`,
  );
}

async function cmdInit(args: string[]): Promise<number> {
  const { flags } = parseArgs(args, BOOL_INIT);
  let provider: ProviderType | undefined;
  if (typeof flags["provider"] === "string") {
    if (!PROVIDERS.includes(flags["provider"])) {
      process.stderr.write(`memhook init: unknown provider "${flags["provider"]}"\n`);
      return 1;
    }
    provider = flags["provider"] as ProviderType;
  }
  let skills: boolean | undefined;
  if (flags["no-skills"] === true) skills = false;
  else if (flags["skills"] === true) skills = true;
  return runInit({
    yes: flags["yes"] === true,
    dryRun: flags["dry-run"] === true,
    provider,
    apiKeyEnv: strFlag(flags["api-key-env"]),
    model: strFlag(flags["model"]),
    bin: strFlag(flags["bin"]) ?? "memhook",
    settingsPath: strFlag(flags["settings"]),
    noCatalog: flags["no-catalog"] === true,
    skills,
  });
}

async function cmdSkills(args: string[]): Promise<number> {
  const { flags, positionals } = parseArgs(args, BOOL_SKILLS);
  const sub = positionals[0] ?? "list";
  if (!SKILLS_SUBCOMMANDS.includes(sub)) {
    process.stderr.write(
      `memhook skills: unknown subcommand "${sub}" (install | uninstall | list)\n`,
    );
    return 1;
  }
  const names: CompanionSkill[] = [];
  for (const n of positionals.slice(1)) {
    if (!isCompanionSkill(n)) {
      process.stderr.write(`memhook skills: unknown skill "${n}" (wrap | curate | relay)\n`);
      return 1;
    }
    names.push(n);
  }
  return runSkills({
    subcommand: sub as SkillsSubcommand,
    names: names.length > 0 ? names : undefined,
    yes: flags["yes"] === true,
    dryRun: flags["dry-run"] === true,
    force: flags["force"] === true,
  });
}

async function cmdUninstall(args: string[]): Promise<number> {
  const { flags } = parseArgs(args, BOOL_UNINSTALL);
  return runUninstall({
    yes: flags["yes"] === true,
    dryRun: flags["dry-run"] === true,
    settingsPath: strFlag(flags["settings"]),
    purge: flags["purge"] === true,
  });
}

async function cmdTail(args: string[]): Promise<number> {
  const { flags } = parseArgs(args, BOOL_TAIL);
  const linesRaw = strFlag(flags["lines"]);
  const lines = linesRaw !== undefined && /^\d+$/.test(linesRaw) ? Number(linesRaw) : 10;
  const statusRaw = strFlag(flags["status"]);
  const status = statusRaw
    ? statusRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;
  return runTail({
    file: strFlag(flags["file"]),
    lines,
    noFollow: flags["no-follow"] === true,
    status,
  });
}

// ── tiny flag parser ─────────────────────────────────────────────────────────

const BOOL_INIT = new Set(["yes", "dry-run", "no-catalog", "skills", "no-skills"]);
const BOOL_UNINSTALL = new Set(["yes", "dry-run", "purge"]);
const BOOL_TAIL = new Set(["no-follow"]);
const BOOL_SKILLS = new Set(["yes", "dry-run", "force"]);

const SHORT: Record<string, string> = { "-y": "--yes", "-n": "--lines" };

function strFlag(v: string | boolean | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * Parse `--key value`, `--key=value`, and boolean flags (those listed in
 * `bools`, plus any `--key` not followed by a value). Unknown long flags that
 * take a value consume the next non-dash token.
 */
function parseArgs(
  args: string[],
  bools: Set<string>,
): { flags: Record<string, string | boolean>; positionals: string[] } {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const raw = args[i];
    if (raw === undefined) continue;
    const a = SHORT[raw] ?? raw;
    if (!a.startsWith("--")) {
      positionals.push(a);
      continue;
    }
    const key = a.slice(2);
    const eq = key.indexOf("=");
    if (eq >= 0) {
      flags[key.slice(0, eq)] = key.slice(eq + 1);
      continue;
    }
    if (bools.has(key)) {
      flags[key] = true;
      continue;
    }
    const next = args[i + 1];
    if (next !== undefined && !next.startsWith("-")) {
      flags[key] = next;
      i++;
    } else {
      flags[key] = true;
    }
  }
  return { flags, positionals };
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function printHelp(): void {
  console.log(`memhook ${VERSION}

USAGE
  memhook <command> [options]

COMMANDS
  run                Read Claude Code hook JSON from stdin, emit additionalContext
  build-catalog      Rebuild the memory catalog at $MEMHOOK_CATALOG_PATH
  init               Wire memhook into ~/.claude/settings.json (with backup)
  uninstall          Remove memhook's hooks from ~/.claude/settings.json
  tail               Pretty live view of the routing log (status, latency, memories)
  skills             Install/uninstall/list companion skills (/wrap /curate /relay)
  version            Print version
  help               Show this message

init OPTIONS
  --provider <p>     anthropic | openai | ollama (else prompted; default anthropic)
  --api-key-env <n>  env var holding the API key (default per provider)
  --model <m>        override the model id
  --bin <name>       command written into settings.json (default: memhook)
  --settings <path>  settings file to patch (default: ~/.claude/settings.json)
  --no-catalog       skip the initial catalog build
  --skills           install companion skills (default: ask / yes in --yes mode)
  --no-skills        skip installing companion skills
  --dry-run          print the plan, write nothing
  -y, --yes          non-interactive (accept defaults / flags)

uninstall OPTIONS
  --settings <path>  settings file to patch (default: ~/.claude/settings.json)
  --dry-run          print the plan, write nothing
  -y, --yes          non-interactive
  --purge            also report cache + log locations to clean up

tail OPTIONS
  -n, --lines <N>    history lines to show before following (default: 10)
  --no-follow        print the recent log + summary, then exit (no live follow)
  --status <a,b>     only show these statuses (e.g. ok,cache_hit)
  --file <path>      log file to read (default: $MEMHOOK_LOG_PATH)

skills SUBCOMMANDS
  install [names…]   copy /wrap /curate /relay into ~/.claude/skills (default: all)
  uninstall [names…] remove the bundled companion skills (backs up first)
  list               show each skill's install status
  --force            overwrite a skill that differs from shipped (backs up first)
  --dry-run          print the plan, write nothing
  -y, --yes          non-interactive (accept defaults)

ENV VARS
  MEMHOOK_ENABLED                 toggle (default: true)
  MEMHOOK_PROVIDER                anthropic | openai | ollama (default: anthropic)
  MEMHOOK_MODEL                   model id (per-provider default if unset)
  MEMHOOK_API_KEY_ENV             env var name holding the API key
  MEMHOOK_BASE_URL                override the provider API endpoint
  MEMHOOK_CONFIG                  path to a YAML config file
  MEMHOOK_LOG_PATH                JSONL log path (read by 'memhook tail')
  MEMHOOK_MAX_FILES               file-count cap (default: 5)
  MEMHOOK_MAX_ADDITIONAL_CHARS    injection size cap (default: 9500)
  MEMHOOK_TIMEOUT_MS              request timeout (default: 8000; ollama: 30000)
  MEMHOOK_DISABLE_CACHE=true      skip local LRU cache
  MEMHOOK_DISABLE_PREFILTER=true  skip trivial-prompt skip
  MEMHOOK_CURATE_NUDGE            /curate-nudge toggle (default: true)
  MEMHOOK_CURATE_NUDGE_TOKENS     catalog-token threshold to nudge (default: 15000)
  MEMHOOK_CURATE_NUDGE_FILES      memory-file-count threshold to nudge (default: 250)
  MEMHOOK_CURATE_NUDGE_COOLDOWN_DAYS  min days between nudges (default: 7)
  NO_COLOR / MEMHOOK_NO_COLOR     disable colour in init/tail output
  MEMHOOK_DEBUG=true              print errors to stderr (default: silent fail-soft)

PROVIDERS
  Default is Anthropic (only api.anthropic.com is contacted). Selecting
  openai or ollama is opt-in and changes the outbound endpoint to
  api.openai.com or your local Ollama (http://localhost:11434) respectively.
  Per-key precedence is env var > YAML config > built-in default.
`);
}

main().catch((err) => {
  process.stderr.write(`memhook fatal: ${String(err)}\n`);
  process.exit(1);
});
