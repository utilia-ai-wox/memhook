#!/usr/bin/env node
/**
 * memhook CLI — three commands shipped in v0.1 preview:
 *
 *   memhook run            Read stdin (Claude Code hook JSON), write hook output
 *   memhook build-catalog  Rebuild ~/.claude/cache/memory-catalog.txt
 *   memhook version        Print package version
 *
 * Designed to be wired into ~/.claude/settings.json hooks:
 *   "UserPromptSubmit": [{ "hooks": [{ "type": "command",
 *                                      "command": "memhook run" }] }]
 *   "SessionStart":     [{ "hooks": [{ "type": "command",
 *                                      "command": "memhook build-catalog" }] }]
 */

import { route } from "../src/router.js";
import { buildCatalog } from "../src/catalog.js";
import { loadConfig } from "../src/config.js";

const VERSION = "0.1.0-preview.0";

async function main(): Promise<void> {
  const cmd = process.argv[2] ?? "help";
  switch (cmd) {
    case "run":
      await cmdRun();
      break;
    case "build-catalog":
      cmdBuildCatalog();
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
  const stdin = await readStdin();
  let output;
  try {
    output = await route(stdin);
  } catch (err) {
    // Fail-soft: emit empty additionalContext, never block the user prompt
    output = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit" as const,
        additionalContext: "",
      },
    };
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
  memhook <command>

COMMANDS
  run                Read Claude Code hook JSON from stdin, emit additionalContext
  build-catalog      Rebuild the memory catalog at $MEMHOOK_CATALOG_PATH
  version            Print version
  help               Show this message

ENV VARS
  MEMHOOK_ENABLED                 toggle (default: true)
  MEMHOOK_MODEL                   provider model id (default: claude-haiku-4-5)
  MEMHOOK_API_KEY_ENV             env var name holding the API key (default: ANTHROPIC_API_KEY)
  MEMHOOK_MAX_FILES               file-count cap (default: 5)
  MEMHOOK_MAX_ADDITIONAL_CHARS    injection size cap (default: 9500)
  MEMHOOK_DISABLE_CACHE=true      skip local LRU cache
  MEMHOOK_DISABLE_PREFILTER=true  skip trivial-prompt skip
  MEMHOOK_DEBUG=true              print errors to stderr (default: silent fail-soft)
`);
}

main().catch((err) => {
  process.stderr.write(`memhook fatal: ${String(err)}\n`);
  process.exit(1);
});
