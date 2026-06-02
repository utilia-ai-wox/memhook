---
description: End-to-end smoke test of the memhook hook with a fake prompt
allowed-tools: ["Bash", "Read"]
---

# /smoke

End-to-end smoke test of the memhook hook against a synthetic prompt,
**without touching the user's live `~/.claude/cache/` or
`~/.claude/logs/`**. Use this before opening a PR that changes anything
under `src/router.ts`, `src/cache.ts`, `src/providers/`, or `bin/`.

## What it does

1. Builds `dist/` if missing.
2. Routes a canned prompt through `memhook run` against a sandbox catalog
   and a sandbox cache directory (both under `/tmp/memhook-smoke-*`).
3. Asserts the hook emits a syntactically valid
   `{ hookSpecificOutput: { additionalContext } }` JSON object on stdout.
4. Asserts the JSONL log line in the sandbox log file has
   `status: "ok" | "cache_hit" | "empty_selection" | "all_unfound"` —
   anything else means the fail-soft contract drifted.

## Steps for Claude

1. Run `bun run build` if `dist/bin/memhook.js` is missing.
2. Create a sandbox dir under `/tmp/memhook-smoke-$$/` containing:
   - `catalog.txt` (3 lines: `=== MEMORY ===`, one fake basename, blank).
   - empty `cache/` subdir, empty `log.jsonl`.
3. Invoke the hook with stdin JSON `{"prompt": "smoke", "cwd": "/tmp"}`
   and these env overrides:
   - `MEMHOOK_ENABLED=true`
   - `MEMHOOK_PROVIDER=anthropic` (the canned run exercises the default provider)
   - `ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY` (must be set in caller env). The
     key gate is provider-aware: `MEMHOOK_PROVIDER=ollama` needs **no** key,
     `openai` needs `OPENAI_API_KEY`. The provider/key logic lives in
     `src/config.ts` + `src/providers/factory.ts` — also worth a smoke run.
   - `MEMHOOK_CATALOG_PATH=<sandbox>/catalog.txt`
   - `MEMHOOK_CACHE_DIR=<sandbox>/cache`
   - `MEMHOOK_LOG_PATH=<sandbox>/log.jsonl`
   - `MEMHOOK_PROJECTS_ROOT=<sandbox>/projects` (empty dir)
   - `MEMHOOK_GLOBAL_RULES_DIR=<sandbox>/rules` (empty dir)
4. Parse stdout as JSON, assert it has a
   `hookSpecificOutput.additionalContext` string field.
5. Read `<sandbox>/log.jsonl`, assert exactly one line, assert
   `.status` is one of the four acceptable values above.
6. Clean up `<sandbox>/` and report pass / fail.

## Pass criteria

- Exit code 0.
- One JSONL log line, `status` field set to a fail-soft-compatible value.
- stdout valid JSON with `additionalContext` (may be empty string).

## Fail criteria

- Any non-zero exit code from `memhook run`.
- stdout that isn't valid JSON, or that's missing `hookSpecificOutput`.
- `status` field set to anything starting with `api_no_*`, or set to
  `parse_invalid` or `provider_init_failed` **without** also producing a
  fail-soft empty `additionalContext`.
