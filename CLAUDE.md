# CLAUDE.md

Project memory for Claude Code working on **memhook**.

## Mission

memhook is a semantic memory router. Claude Code is the reference host (via a
harness-adapter seam, `src/adapters/`). It runs as a `UserPromptSubmit` hook:
for each user prompt it asks Haiku to pick the 0–5 most relevant memory files
(`feedback_*.md`, `project_*.md`, plus the rule zones) from the user's
`~/.claude/` and injects them as `additionalContext`. Everything else stays on
disk, invisible to the model until it matters.

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
- **vitest** for tests (`tests/*.test.ts`), 194 tests across 21 suites as of v0.5
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
memhook presets detect # scan for known-tool memory dirs → a presets: snippet
```

## Layout

```
src/        router · catalog · cache · preFilter · providers · config · configFile · version · index
            sources · presetsCmd            (source registry: customSources/presets/detect; ON the hook path)
            adapters/  claudeCode · types    (harness-adapter seam; Claude Code = adapter #1)
            ansi · install · init · tail   (init/uninstall/tail commands; not on the hook path)
            skills · skillsCmd · backup     (skills install/uninstall/list; not on the hook path)
bin/        CLI entrypoint (`memhook run|build-catalog|init|uninstall|tail|skills|presets|version`)
skills/     bundled companion skills (wrap/ · curate/ · relay/) shipped in the npm tarball
tests/      vitest suites (21 files) — colocated with src/ they cover
dist/       tsc output (gitignored, built on publish)
docs/       SPECIFICATION.md (frozen dev contract)
```

## Non-goals (still firm in v0.5)

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

## Shipped in v0.3

- **`memhook init` / `memhook uninstall`** — interactive, zero-dependency
  (`node:readline`) setup. The settings.json merge is a pure, unit-tested
  transform in `src/install.ts` (idempotent, non-clobbering, backs up first,
  refuses to overwrite unparseable JSON); `src/init.ts` is the I/O shell.
- **`memhook tail`** — zero-dependency colourised live view of the JSONL log
  (`src/tail.ts`, ANSI via `src/ansi.ts`). Pure parse/format + a polling
  follow-loop. Reads the log only — never on the hook path.
- **`model` field** added to the JSONL log (additive; frozen-schema safe).
- **Fail-soft boundary**: only `memhook run` obeys the fail-soft contract;
  `init`/`uninstall`/`tail` are interactive and may exit non-zero
  (docs/SPECIFICATION.md §9).

## Shipped in v0.4

- **Companion skills** — three standalone Claude Code skills bundled in
  `skills/` and installed into `~/.claude/skills/<name>/` by `memhook skills
install`: `/wrap` (end-of-session wrap-up), `/curate` (memory hygiene),
  `/relay` (fresh-session handoff). Standalone, not a plugin, so the names stay
  bare (`/wrap`, not `/memhook:wrap`). The copy plan is a pure, unit-tested
  transform in `src/skills.ts` (idempotent, non-clobbering, backs up edits);
  `src/skillsCmd.ts` is the I/O shell. `memhook init` offers to install them.
- **`/curate` nudge** — when the catalog grows past a threshold the router
  attaches an additive `systemMessage` suggesting `/curate`
  (`maybeCurateNudge` in `src/router.ts`). Local-only (no outbound call),
  wrapped so it never affects fail-soft, config-toggleable
  (`MEMHOOK_CURATE_NUDGE`), on a cooldown.
- **`backup.ts`** — shared `backupPath`/`stampNow`, extracted so `init.ts` and
  `skillsCmd.ts` don't import each other.

## Shipped in v0.5

The "cable onto existing memory" chantier — memhook installs mid-project, so
memory already exists; v0.5 lets it route what's there. All in `src/sources.ts`
(pure/total) unless noted; decisions D30–D35 (docs/SPECIFICATION.md §25).

- **Harness-adapter seam** (`src/adapters/`) — the pipeline is harness-agnostic;
  Claude Code is adapter #1 (`claudeCode.ts`). `route()` is byte-identical to the
  pre-seam hook.
- **Host-autoloaded rule zones omitted by default** (`resurfaceHostLoaded`, D30)
  — `~/.claude/rules` + `<cwd>/.claude/rules` are loaded in full by Claude Code at
  launch, so the catalog omits them by default (no double-injection); routes only
  the not-autoloaded `feedback_*/project_*` memory. `MEMHOOK_RESURFACE_HOST_LOADED`
  re-includes them.
- **Custom sources** (`customSources`, YAML-only, D31) — extra `.md` dirs (any
  naming, via a glob) catalogued + routed like the built-in zones.
- **Built-in host presets** (`presets`, YAML-only, all experimental, D32) — named
  bundles (`cline`, `continue`, `copilot`, `windsurf`); `presets: [auto]` (D35)
  routes every detected preset. `expandPresets` / `resolveActivePresetNames`.
- **`memhook presets list|detect`** (D33, `src/presetsCmd.ts` I/O shell) — discover
  presets that have memory on disk; `detect` prints the `presets: [...]` snippet.
  Not on the hook path.
- **Presets nudge** (`maybePresetsNudge` in `src/router.ts`, D34) — additive
  `systemMessage` suggesting `memhook presets detect` when a known host's memory
  exists but isn't routed. Same guard-rails as the `/curate` nudge; toggle
  `MEMHOOK_PRESETS_NUDGE`.

(On `main`, unreleased → v0.6: widened routable extensions `.md`/`.mdc`/`.txt`
via `SOURCE_EXTENSIONS`, D36 — foundation for a Cursor preset.)

## Working on this repo

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR. The hook
contract — fail-soft, no telemetry, strict TypeScript — is non-negotiable.
