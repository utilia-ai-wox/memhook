# CLAUDE.md

Project memory for Claude Code working on **memhook**.

## Mission

memhook is a semantic memory router for Claude Code. It runs as a
`UserPromptSubmit` hook: for each user prompt it asks Haiku to pick the
0–5 most relevant memory files (`feedback_*.md`, `rule_*.md`) from the
user's `~/.claude/` and injects them as `additionalContext`. Everything
else stays on disk, invisible to the model until it matters.

## Cardinal doctrine: **fail-soft**

The hook **must never block Claude Code**. Every error path falls back to
an empty `additionalContext`. A missing API key, a network timeout, a
malformed JSON response, a corrupted cache — none of these should ever
make the hook exit with a non-zero status that interrupts the user.

If you change `src/router.ts`, `bin/memhook.ts`, or any of the hook entry
points, run [`/smoke`](.claude/commands/smoke.md) before opening a PR and
ask [`failsoft-auditor`](.claude/agents/failsoft-auditor.md) to review.

## Stack

- Node **18+** (CI matrix tests 18 / 20 / 22)
- TypeScript **strict ESM** (no CommonJS), `tsc` → `dist/`
- **vitest** for tests (`tests/*.test.ts`), 46 tests as of v0.2.2
- **bun** for development (`bun install`, `bun run test`); CI uses `npm`
- CI runs on **GitHub-hosted runners** (Linux + macOS + Windows × Node
  18 / 20 / 22) — free for this public repo

## Commands

```bash
bun install            # install deps
bun run build          # tsc → dist/
bun run typecheck      # tsc --noEmit
bun run test           # vitest run
bun run dev            # tsc --watch
```

Local install for hook testing:

```bash
npm link               # exposes `memhook` globally → ~/bin/memhook
memhook build-catalog  # rebuild the memory catalog
memhook run            # read hook JSON from stdin, emit additionalContext
```

## Layout

```
src/        router · catalog · cache · preFilter · providers · config · configFile · version
bin/        CLI entrypoint (`memhook run|build-catalog|version`)
tests/      vitest suites — colocated with src/ they cover
dist/       tsc output (gitignored, built on publish)
docs/       SPECIFICATION.md (frozen dev contract)
```

## Non-goals (still firm in v0.2)

- No telemetry, no phone-home, no update check. By default the **only**
  outbound call is `api.anthropic.com`, using the user's own API key.
  Selecting `openai` or `ollama` is opt-in and changes the endpoint the user
  chose to route through — it is never analytics or phone-home.

## Shipped in v0.2

- **YAML config file** — optional, opt-in (`$MEMHOOK_CONFIG` or
  `~/.config/memhook/config.yaml`); precedence env > YAML > default. Parsed by
  the `yaml` package (memhook's first runtime dependency, zero sub-deps).
- **Multi-provider** — `MEMHOOK_PROVIDER` selects `anthropic` (default),
  `openai`, or `ollama` (local). Built via `createProvider()` in
  `src/providers/factory.ts`; all share `src/providers/http.ts`.

## Working on this repo

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. The hook
contract — fail-soft, no telemetry, strict TypeScript — is non-negotiable.
