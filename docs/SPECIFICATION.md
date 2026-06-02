# memhook — project specification

> This document is the **frozen development contract** for memhook.
> Any Claude Code instance working on this repository MUST read it
> before writing code, opening PRs, or changing public surfaces.
> Changes to this spec happen through dedicated PRs labelled `spec`,
> never as a side-effect of feature work.
>
> **Status**: spec first frozen 2026-06-01, refreshed for v0.4.
> **Implementation status**: `0.3.0` published on npm (init/uninstall setup +
> `tail` live monitor). This revision documents **v0.4** — the companion skills
> (`/wrap`, `/curate`, `/relay`) + the `memhook skills` installer + the
> `/curate` nudge ([§26](#26-companion-skills-v04)); see
> [§22 Roadmap](#22-roadmap).

---

## Table of contents

1. [Identity](#1-identity)
2. [Stack](#2-stack)
3. [Versioning](#3-versioning)
4. [OS support](#4-os-support)
5. [Architecture](#5-architecture)
6. [Cardinal doctrine](#6-cardinal-doctrine)
7. [File layout](#7-file-layout)
8. [Module specs](#8-module-specs)
9. [CLI commands](#9-cli-commands)
10. [Hook contract](#10-hook-contract)
11. [Provider contract](#11-provider-contract)
12. [Cache contract](#12-cache-contract)
13. [PreFilter contract](#13-prefilter-contract)
14. [Logging spec](#14-logging-spec)
15. [Configuration](#15-configuration)
16. [Performance targets](#16-performance-targets)
17. [Cost targets](#17-cost-targets)
18. [Bench methodology](#18-bench-methodology)
19. [Security model](#19-security-model)
20. [Conventions](#20-conventions)
21. [Quality gates](#21-quality-gates)
22. [Roadmap](#22-roadmap)
23. [Anti-patterns](#23-anti-patterns)
24. [NEVER list](#24-never-list)
25. [Decision log](#25-decision-log)

---

## 1. Identity

| Field           | Value                                                                                                                                                    |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Name**        | `memhook`                                                                                                                                                |
| **Tagline**     | Semantic memory router for Claude Code                                                                                                                   |
| **One-liner**   | A `UserPromptSubmit` hook that asks Haiku to pick 0–5 relevant memory files per user prompt and injects them as `additionalContext`.                     |
| **License**     | MIT                                                                                                                                                      |
| **Repository**  | https://github.com/utilia-ai-wox/memhook                                                                                                                 |
| **npm package** | `memhook` (scope `none`)                                                                                                                                 |
| **Bin command** | `memhook`                                                                                                                                                |
| **Status**      | `0.3.0` published on npm; v0.4 (companion skills) in this revision; extracted from a private daily-use hook; API surface may still shift before `1.0.0`. |

### Naming rationale

`memhook` = memory + hook — a memory router that runs as a Claude Code hook.
Short, unambiguous, and available on npm. (The earlier working name `memflow`
was unavailable.)

---

## 2. Stack

| Layer             | Choice                                                                | Rationale                                                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime           | **Node 18+** (LTS line)                                               | Active LTS through 2027. Required `fs.watch` recursive support.                                                                                                           |
| Language          | **TypeScript strict ESM**                                             | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled. ESM only — no CommonJS.                                                                       |
| Build             | **`tsc -p tsconfig.json`** → `dist/`                                  | No bundler. Distribution as ESM with `.d.ts`.                                                                                                                             |
| Tests             | **vitest**                                                            | Fast, ESM-native, mock-friendly. Snapshot only when justified.                                                                                                            |
| Package manager   | **npm** (primary)                                                     | No committed lockfile (dropped in `9fb393f` to dodge an npm cross-platform optional-dep bug); CI + publish use `npm install`. `bun` allowed for local dev (not required). |
| Lint              | **eslint** flat config + `typescript-eslint` strict + stylistic       |                                                                                                                                                                           |
| Format            | **prettier**                                                          | Config: 2-space indent, semicolons, trailing commas, line width 100.                                                                                                      |
| Commit hooks      | **husky** v9 + **commitlint** + **lint-staged**                       |                                                                                                                                                                           |
| Release           | **release-please-action** v4, manifest mode                           | Pre-release tags `0.X.Y-preview.N`.                                                                                                                                       |
| CI                | **GitHub Actions** matrix Linux + macOS + Windows × Node 18 / 20 / 22 | GitHub-hosted runners — free for a public repo.                                                                                                                           |
| Security scanning | **CodeQL** weekly + on push/PR                                        |                                                                                                                                                                           |
| Dependency bumps  | **Dependabot** weekly, grouped by category                            |                                                                                                                                                                           |

### Runtime dependency policy

- **One runtime dependency** as of v0.2: `yaml` (^2.9.0, zero sub-deps),
  used by the YAML config loader. The core router otherwise pulls in nothing.
- No transitive dep introducing telemetry / phone-home. Every dep bump
  reviewed against this rule.

---

## 3. Versioning

memhook follows **SemVer 2.0** strictly.

### Pre-1.0 phase

- Tag format: plain `v0.X.Y` (e.g. `v0.2.2`). No `-preview` suffix —
  `0.x` already signals an unstable API.
- Any `feat` → minor bump. Any `fix` / `perf` → patch bump.
- Any breaking change in `0.x` → minor bump (acceptable in `0.x` per
  SemVer §4). Communicated in CHANGELOG under `BREAKING CHANGES`.

### Post-1.0 phase

- Tag format: `vX.Y.Z`.
- `feat!:` or `BREAKING CHANGE:` footer → major bump.
- `feat:` → minor. `fix:` / `perf:` → patch.

### Release process

1. Commits matching `feat` / `fix` / `perf` land on `main`.
2. release-please opens a PR titled `chore(main): release X.Y.Z[-preview.N]`.
3. The release PR updates `package.json` version, `CHANGELOG.md`,
   `.release-please-manifest.json`.
4. Merging the release PR creates a Git tag and a GitHub Release.
5. `npm publish` is **automated**: the `publish-npm` job in
   `release-please.yml` runs when `release_created` is true, authenticates
   via npm **Trusted Publishing** (GitHub OIDC, no `NPM_TOKEN`), and runs
   `npm publish --provenance --access public`.

---

## 4. OS support

memhook supports **macOS, Linux, and Windows**. All three are exercised in
CI on every push and PR.

### CI coverage

- Matrix: `ubuntu-latest` + `macos-latest` + `windows-latest` × Node
  18 / 20 / 22, on GitHub-hosted runners (free for a public repo).
- `.gitattributes` pins line endings to LF so files lint, format, and test
  identically across the three OSes.
- `package.json` declares no `os` restriction.

### Windows caveat

memhook is a dependency-free Node CLI with no native bindings, so it is
portable by construction. The one POSIX-specific spot is `cwdToSlug`
(`src/catalog.ts`), which mirrors how Claude Code encodes a project path
into a `~/.claude/projects/<slug>` directory name. It normalises
backslashes before slugifying; drive-letter matching on Windows is
best-effort, because Claude Code's Windows slug scheme is not independently
verified here. A catalog-zone mismatch on Windows is the symptom to watch.

---

## 5. Architecture

memhook is a **stateless CLI** that reads a JSON envelope on stdin and
writes a JSON envelope on stdout. No daemon. No long-lived process.

```
┌────────────────────────────────────────────────────────────┐
│                   Claude Code parent process                │
│                                                             │
│   UserPromptSubmit fires → spawn `memhook run` (stdin/out)  │
└────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                         bin/memhook.ts                        │
│                                                              │
│  1. parse stdin JSON                                         │
│  2. route() → orchestrates the pipeline                      │
│  3. emit stdout JSON, exit 0                                 │
└──────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────┐
│                          src/router.ts                        │
│                                                              │
│   loadConfig() → preFilter → cache.get() →                   │
│       provider.select() → cache.put() →                      │
│           readSelected(files, cap) → emit + logEntry         │
└──────────────────────────────────────────────────────────────┘
       │            │             │              │
       ▼            ▼             ▼              ▼
   config.ts   preFilter.ts   cache.ts    providers/factory.ts
                                          providers/{anthropic,openai,ollama}.ts
                                          providers/http.ts (shared transport)
```

Key invariants:

- **No I/O outside declared paths**: `~/.claude/cache/`,
  `~/.config/memhook/`, `$MEMHOOK_LOG_PATH`. Anything else = bug.
- **No outbound network call** except `provider.select()`, which goes
  to the user-configured provider with the user's own API key.
- **Failure is silent + logged**: any error path writes to stderr +
  emits empty `additionalContext` + exits 0. Never blocks Claude Code.

---

## 6. Cardinal doctrine

These three rules are **non-negotiable**. A PR that violates any of
them must be rejected, regardless of how clean the code is otherwise.

### 6.1 Fail-soft

The hook MUST never crash, hang past timeout, exit non-zero, or write
malformed JSON to stdout. Every error path falls back to an empty
`additionalContext` and a JSONL log entry with a meaningful `status`
field. The `.claude/agents/failsoft-auditor.md` agent scans for
violations on every PR.

### 6.2 No telemetry

memhook makes **exactly one** outbound network call: `provider.select()`
to the user-configured LLM endpoint, with the user's own API key, on
their explicit `MEMHOOK_ENABLED=true`. No analytics, no crash report,
no update check, no version ping, no phone-home of any kind. Any future
feature that adds an outbound call must be **opt-in via env var or
config**, documented in the README, and never default-on.

### 6.3 Local-only state

memhook writes only to the local filesystem under paths the user
controls. No remote cache. No database. No SaaS dependency. The cache
is a directory of JSON files; the log is a JSONL file; the catalog is
a flat text file. A user who deletes `~/.cache/memhook/` and
`~/.claude/cache/memory-catalog.txt` and uninstalls the package is
back to a clean state.

---

## 7. File layout

```
memhook/
├── README.md                 — pitch + install (EN)
├── CLAUDE.md                 — onboarding for Claude Code (EN)
├── CONTRIBUTING.md           — conventions (EN)
├── CODE_OF_CONDUCT.md        — Contributor Covenant 2.1 (EN, verbatim)
├── SECURITY.md               — disclosure policy (EN)
├── CHANGELOG.md              — auto-managed by release-please (EN)
├── LICENSE                   — MIT
├── package.json
├── tsconfig.json
├── .gitignore
├── .editorconfig
├── .prettierrc.json
├── .prettierignore
├── eslint.config.js
├── commitlint.config.js
├── release-please-config.json
├── .release-please-manifest.json
├── .env.example
│
├── .husky/
│   ├── pre-commit            — lint-staged
│   └── commit-msg            — commitlint
│
├── .github/
│   ├── CODEOWNERS
│   ├── dependabot.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   └── feature_request.yml
│   └── workflows/
│       ├── ci.yml
│       ├── release-please.yml
│       └── codeql.yml
│
├── .claude/
│   ├── settings.json         — permissions template for contributors
│   ├── commands/
│   │   └── smoke.md          — /smoke E2E test against sandbox
│   └── agents/
│       └── failsoft-auditor.md
│
├── src/
│   ├── index.ts              — public exports barrel
│   ├── router.ts             — UserPromptSubmit pipeline (§8.1)
│   ├── catalog.ts            — catalog builder (§8.2)
│   ├── cache.ts              — local LRU cache (§8.3)
│   ├── preFilter.ts          — trivial-prompt filter (§8.4)
│   ├── config.ts             — config resolver, env > yaml > default (§8.6)
│   ├── configFile.ts         — YAML config loader (fail-soft)
│   ├── version.ts            — MEMHOOK_VERSION (release-please-managed)
│   ├── ansi.ts               — zero-dep ANSI styler (init/tail; TTY/NO_COLOR aware)
│   ├── install.ts            — pure settings.json hook merge (init/uninstall core)
│   ├── init.ts               — `memhook init` / `memhook uninstall` orchestration
│   ├── tail.ts               — `memhook tail` live JSONL monitor
│   ├── backup.ts             — shared backupPath/stampNow (init + skills)
│   ├── skills.ts             — pure companion-skills plan (install/uninstall/list)
│   ├── skillsCmd.ts          — `memhook skills` I/O shell + init integration
│   └── providers/
│       ├── types.ts          — Provider interface (§8.5)
│       ├── http.ts           — shared postJsonWithRetry transport
│       ├── factory.ts        — createProvider(config, apiKey)
│       ├── anthropic.ts      — Anthropic Messages adapter
│       ├── openai.ts         — OpenAI Chat Completions adapter
│       └── ollama.ts         — Ollama native /api/chat adapter
│
├── bin/
│   └── memhook.ts            — CLI entrypoint
│
├── skills/                   — bundled companion skills (shipped in the npm tarball)
│   ├── wrap/SKILL.md
│   ├── curate/{SKILL.md, reference.md}
│   └── relay/SKILL.md
│
├── tests/                    — 106 tests across 13 suites
│   ├── router.test.ts
│   ├── cache.test.ts
│   ├── preFilter.test.ts
│   ├── config.test.ts
│   ├── factory.test.ts
│   ├── openai.test.ts
│   ├── ollama.test.ts
│   ├── ansi.test.ts
│   ├── install.test.ts
│   ├── init.test.ts
│   ├── skills.test.ts
│   ├── curateNudge.test.ts
│   └── tail.test.ts
│
├── dist/                     — tsc output, gitignored, built on publish
│
└── docs/
    ├── SPECIFICATION.md      — THIS FILE
    └── private/              — internal planning notes (gitignored)
```

---

## 8. Module specs

### 8.1 `src/router.ts`

The `UserPromptSubmit` hook entrypoint. Single exported async function:

```ts
export async function route(
  stdinJson: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<HookOutput>;
```

**Pipeline** (in order, with early exits):

1. `loadConfig(env)` → fail-soft on parse error.
2. `ensureDirs()` + `evictStale()` (best-effort, never throws).
3. Toggle gate: if `config.enabled === false`, return EMPTY.
4. Parse stdin JSON → if invalid, return EMPTY.
5. PreFilter: if trivial prompt, log `pre_filter_skip`, return EMPTY.
6. Catalog check: if missing, log `no_catalog`, return EMPTY.
7. API key check: if missing, log `no_api_key`, return EMPTY.
8. Cache check: if hit, set `fromCache = true` and skip provider call.
9. Provider call: try / catch; on error, log `api_no_response`, return EMPTY.
10. Parse provider response: if not a JSON array, log `parse_invalid`, return EMPTY.
11. Inject files (with the cap-A1 projection check, see §8.3) → set `status`.
12. Log entry + return `{ hookSpecificOutput: { hookEventName, additionalContext } }`.

**Status field values** (exhaustive — any new status must be added here):

| Status                 | Meaning                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `ok`                   | Files injected from a fresh provider selection.                         |
| `cache_hit`            | Files injected from local LRU cache.                                    |
| `pre_filter_skip`      | Trivial prompt; LLM call skipped.                                       |
| `empty_selection`      | Provider returned `[]`.                                                 |
| `all_unfound`          | Provider returned basenames that don't exist on disk.                   |
| `no_catalog`           | Catalog file missing.                                                   |
| `no_api_key`           | `$ANTHROPIC_API_KEY` (or configured env) absent; not needed for Ollama. |
| `provider_init_failed` | `createProvider()` threw during construction (bad config).              |
| `api_no_response`      | Provider HTTP error / network timeout.                                  |
| `api_no_content`       | Provider 200 but no text returned.                                      |
| `parse_invalid`        | Response wasn't a valid JSON array.                                     |

### 8.2 `src/catalog.ts`

Builds `~/.claude/cache/memory-catalog.txt` from:

- `~/.claude/projects/*/memory/{feedback,project}_*.md` — all zones
- `~/.claude/rules/*.md` — global rules
- `<cwd>/.claude/rules/*.md` — project rules

**Title-only reduction**: zones other than the current CWD are listed
with **basename only** (no description). Reduces catalog size ~50 % on
a multi-zone setup. The CWD zone keeps `basename: description` for
priority.

Output:

```
=== MEMORY FEEDBACKS ===
--- <cwd-zone> [CWD] ---
feedback_xxx.md: <description>
--- <other-zone-1> ---
feedback_yyy.md
feedback_zzz.md
(N entries)

=== MEMORY PROJECTS ===
…

=== GLOBAL RULES ===
…

=== PROJECT RULES (<cwd-basename>) ===
…
```

### 8.3 `src/cache.ts`

File-based LRU cache. One JSON file per key under
`$MEMHOOK_CACHE_DIR` (default `~/.cache/memhook/`).

**Key derivation**:

```
key = sha256(prompt + "|" + catalog_mtime + "|" + cwd + "|" + script_version + "|" + provider)
```

Each component is required: changing any one invalidates the entry.
`provider` is `type:model` (e.g. `anthropic:claude-haiku-4-5`), so switching
provider or model never serves a stale selection. `script_version` comes from
`src/version.ts` (`MEMHOOK_VERSION`, release-please-managed), so a release
bump automatically retires every cached selection.

**TTL**: 60 minutes by default (`MEMHOOK_CACHE_TTL_MIN`). Entries
older than that are misses.

**Eviction**: at every hook invocation, files older than 7 days
(`MEMHOOK_CACHE_EVICT_DAYS`) are deleted on a best-effort basis.

**Cap-A1 projection check** (must be in `router.ts:readSelected`):

```
for each file Haiku selected:
  if injected_count == 0:
    inject unconditionally        # always allow ≥1 file
  else if (current_size + file_size + 64) > MAX_ADDITIONAL_CHARS:
    stop the loop                 # respect the cap pre-injection
  else:
    inject
```

The `+ 64` accounts for the HTML-comment wrapper that prefixes each
injected file. Without this projection, a single 70 KB memory placed
first would overflow the cap to 80+ KB.

### 8.4 `src/preFilter.ts`

Skips the LLM call when the prompt is obviously trivial (acks, single
words). Loads its word list from
`$MEMHOOK_TRIVIAL_FILE` (default `~/.config/memhook/trivial-words.txt`)
if present, else falls back to a built-in list of ~35 words.

**Normalisation**: strip `\s` and `\p{P}` from the prompt, lowercase,
then exact-match against the set. Trim "OK!", "vas-y", "merci."
become "ok", "vasy", "merci".

The list is conservative by design — better to false-negative (call
Haiku unnecessarily) than false-positive (skip a real prompt).

### 8.5 `src/providers/`

Provider adapter pattern. Each provider implements:

```ts
interface Provider {
  readonly name: string;
  select(req: SelectionRequest): Promise<SelectionResponse>;
}
```

`SelectionRequest` carries `systemPrompt`, `userPrompt`,
`maxOutputTokens`, `timeoutMs` — provider-agnostic only. Anthropic-specific
knobs (`betaHeaders`, `cacheControlTtl`) live in `AnthropicProviderOptions`,
passed to the Anthropic adapter at construction, never on `SelectionRequest`.
`ProviderConfig.apiKey` is **optional** (local providers like Ollama need
none). `SelectionResponse` carries `rawText`, `usage` (input / output /
cache_create / cache_read tokens), `latencyMs`, `httpStatus`.

`createProvider(config, apiKey)` (`src/providers/factory.ts`) selects the
adapter from `config.provider.type`; the router's API-key gate is
provider-aware (Ollama skips it). All adapters share `src/providers/http.ts`.

**Ships**: `anthropic` (default), `openai`, and `ollama`.

### 8.6 `src/config.ts`

Config resolver with precedence **env > YAML > default**. YAML is opt-in,
loaded by `src/configFile.ts` from `$MEMHOOK_CONFIG` or
`~/.config/memhook/config.yaml` (parsed by the `yaml` package, fail-soft to
defaults). Empty/whitespace env values are treated as absent; numeric values
are clamped to positive integers; the boolean vocabulary is `true`/`1`/`yes`/
`on` (case-insensitive); a per-provider defaults table seeds
model / apiKeyEnv / timeout. Single exported function:

```ts
export function loadConfig(env: NodeJS.ProcessEnv = process.env): MemhookConfig;
```

Returns a fully-typed config object with sane defaults for every
field. See [§15 Configuration](#15-configuration) for the env var
reference.

---

## 9. CLI commands

```
memhook <command> [options]
```

| Command                 | Status | Purpose                                                                                                                                                                                      |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memhook run`           | v0.1   | Read hook JSON from stdin, emit `additionalContext`.                                                                                                                                         |
| `memhook build-catalog` | v0.1   | (Re)build `~/.claude/cache/memory-catalog.txt`.                                                                                                                                              |
| `memhook version`       | v0.1   | Print `MEMHOOK_VERSION` (`src/version.ts`).                                                                                                                                                  |
| `memhook help`          | v0.1   | Print this command list + env var reference.                                                                                                                                                 |
| `memhook init`          | v0.3   | Interactive setup: detect Claude Code paths, write hook to `~/.claude/settings.json` (with backup), validate API key, bootstrap empty memory dirs.                                           |
| `memhook uninstall`     | v0.3   | Remove hooks from `~/.claude/settings.json` (with backup), prompt for cache + log cleanup.                                                                                                   |
| `memhook tail`          | v0.3   | Live colourised tail of the JSONL log — time · status · prompt · latency · model + the injected memories, with a cache-rate + p50/p95 summary. Zero-dep ANSI, no TUI framework (see D20).    |
| `memhook skills`        | v0.4   | `install` / `uninstall` / `list` the bundled companion skills (`/wrap`, `/curate`, `/relay`) under `~/.claude/skills/`. Non-clobbering, backs up edits. See [§26](#26-companion-skills-v04). |
| `memhook bench`         | v0.5   | Run the 50-prompt bench suite against the configured provider; output recall + cost table.                                                                                                   |

`memhook run` is the only command that must obey the fail-soft
contract. The others may exit non-zero on user error.

---

## 10. Hook contract

The contract Claude Code enforces on a `UserPromptSubmit` hook (as of
2026-06-01, sourced from
https://code.claude.com/docs/en/hooks):

### 10.1 stdin

```json
{
  "session_id": "string",
  "transcript_path": "/abs/path/to/session.jsonl",
  "cwd": "/abs/path/to/project",
  "permission_mode": "default|acceptEdits|plan|bypassPermissions",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "verbatim user prompt text"
}
```

### 10.2 stdout (success)

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "string injected before the user prompt"
  },
  "systemMessage": "optional one-line notice shown to the user (v0.4, additive)"
}
```

`systemMessage` is a documented Claude Code field ("warning message shown to
the user"). memhook emits it **only** for the `/curate` nudge ([§26](#26-companion-skills-v04)),
and only on the turns it fires; it is absent otherwise, so the existing
`hookSpecificOutput.additionalContext` contract is unchanged. Adding it is
additive (mirrors the §14 log-schema rule), not a breaking shape change — see
[D26](#25-decision-log).

### 10.3 stdout size cap

Claude Code caps hook stdout at **10 000 characters**. Beyond that,
output is silently spilled to a file and only a preview reaches the
model. memhook MUST therefore keep `additionalContext` ≤ 10 000
characters in production — the default `MEMHOOK_MAX_ADDITIONAL_CHARS`
ships at **9 500** to leave headroom for the wrapping JSON envelope.

This is a **change from v0.1.0-preview.0**, which used 32 000 based on
an obsolete reading of the docs. See [decision log](#25-decision-log)
entry **D2**.

### 10.4 Exit codes

- `0` — success, stdout parsed.
- `2` — block the prompt (sends stderr back to Claude as an error).
  memhook MUST never exit 2 outside of `bin/memhook.ts:build-catalog`.
- Anything else — non-blocking warning.

### 10.5 Timeout

UserPromptSubmit hooks have a **30 s** default timeout. memhook
configures provider calls to **8 s** to leave ≥ 22 s for catalog read,
cache lookup, file injection, and JSON serialisation.

---

## 11. Provider contract

See [§8.5](#85-srcproviders) for the interface. Per-provider notes:

### 11.1 Anthropic (default)

- Model default: `claude-haiku-4-5` (un-snapshotted alias — avoids
  404 if Anthropic retires a snapshot).
- Endpoint: `https://api.anthropic.com/v1/messages`.
- Headers: `x-api-key`, `anthropic-version: 2023-06-01`.
- Beta headers: **none required** for `ttl: "1h"` cache as of 2026 —
  the feature is GA. Do not ship `anthropic-beta: extended-cache-ttl-2025-04-11`;
  it is obsolete.
- Cache control: `{type: "ephemeral", ttl: "1h"}` on the system prompt
  (the catalog), divides input cost ~10× over a continuous session.
- Retry: single retry on HTTP 429 / 503 with 500 ms backoff.

### 11.2 OpenAI

- Model default: `gpt-4o-mini`.
- Endpoint: `https://api.openai.com/v1/chat/completions`.
- Cost: ~$0.15 input / $0.60 output per MTok. ~33 % cheaper than Haiku.
- Recall measured at **77.8 %** vs 88.9 % for Haiku (bench v2, 9 prompts).

### 11.3 Ollama

- Model default: `llama3.1` (must be pulled locally: `ollama pull llama3.1`).
- Endpoint: `http://localhost:11434/api/chat` (native), `stream:false`.
- No API key required for local use; the key gate is skipped for Ollama.
- Default timeout: 30 s (not 8 s) — absorbs cold model loads.
- Cost: zero — local inference.
- No `cache_control` field — the cache feature is Anthropic-specific.

---

## 12. Cache contract

See [§8.3](#83-srccachets) for implementation. Invariants:

- One JSON file per key.
- The file's payload is a JSON array of basenames (e.g.
  `["feedback_x.md", "rule_y.md"]`).
- Empty arrays (`[]`) are **not cached** (a `[]` from the provider
  usually means "nothing relevant" — re-asking next time costs ~zero).
- A `script_version` **or** provider (`type:model`) change retires every
  cached entry transparently.
- Eviction is best-effort; failures during cleanup never block the hook.

---

## 13. PreFilter contract

See [§8.4](#84-srcprefilterts). Default list (sorted, lowercase):

```
allez certain continu continue fais go hmm hmmm hmmmm k lance merci
nickel no nope ok okay ouais ouep oui parfait stop sur sure thanks
thx tupeux vasy yeah yep yes
```

Users override by placing their own list at
`~/.config/memhook/trivial-words.txt` (one normalised word per line,
comments starting with `#` ignored).

The list is intentionally short. Expand only if measured empirically.
Adding aggressive words ("ye", "sí", "k") risks false-positives on
short technical prompts.

---

## 14. Logging spec

memhook writes one JSONL line per invocation to
`$MEMHOOK_LOG_PATH` (default `~/.claude/logs/memhook.log`).

```json
{
  "ts": "2026-06-01T17:30:00Z",
  "prompt_preview": "first 80 chars of the prompt",
  "selected": ["feedback_x.md"],
  "latency_ms": 1727,
  "tokens_in": 12,
  "tokens_out": 28,
  "cache_create": 0,
  "cache_read": 13398,
  "additional_size_chars": 9412,
  "additional_size_tokens_est": 2353,
  "status": "ok",
  "model": "claude-haiku-4-5"
}
```

| Field                        | Type                    | Notes                                                                                      |
| ---------------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| `ts`                         | ISO 8601 UTC, no millis | Logging time.                                                                              |
| `prompt_preview`             | string ≤ 80 chars       | Truncated user prompt — for grep / debugging. Never the full prompt.                       |
| `selected`                   | `string[]`              | Basenames returned by the provider (may include items not actually injected if cap fired). |
| `latency_ms`                 | integer                 | End-to-end provider call duration. 0 on cache hit or pre-filter skip.                      |
| `tokens_in`, `tokens_out`    | integer                 | From provider response. 0 on cache hit.                                                    |
| `cache_create`               | integer                 | Anthropic-only; tokens that wrote to the 1h cache.                                         |
| `cache_read`                 | integer                 | Anthropic-only; tokens read from the cache.                                                |
| `additional_size_chars`      | integer                 | Length of the injected `additionalContext` string.                                         |
| `additional_size_tokens_est` | integer                 | `floor(chars / 4)` rough estimate.                                                         |
| `status`                     | string                  | One of the 11 values in [§8.1](#81-srcrouterts).                                           |
| `model`                      | string                  | Provider model that handled the turn (added v0.3, see D21). Absent on pre-v0.3 lines.      |

This log is the primary observability surface. Cost dashboards and
the `memhook tail` TUI both parse it. The schema is **frozen**: new
fields may be added, existing fields may not be renamed or removed
without a major version bump.

---

## 15. Configuration

Every knob resolves **env var > YAML file > default**. The YAML file is
opt-in (`$MEMHOOK_CONFIG` or `~/.config/memhook/config.yaml`). Defaults for
`MEMHOOK_MODEL` / `MEMHOOK_API_KEY_ENV` / `MEMHOOK_BASE_URL` / `MEMHOOK_TIMEOUT_MS`
are **per-provider** (e.g. Ollama timeout 30000, OpenAI model gpt-4o-mini);
the table below shows the Anthropic-default values. Sensible defaults work
for most users.

| Variable                             | Default                                   | Type   | Purpose                                                         |
| ------------------------------------ | ----------------------------------------- | ------ | --------------------------------------------------------------- |
| `MEMHOOK_ENABLED`                    | `true`                                    | bool   | Master toggle.                                                  |
| `MEMHOOK_PROVIDER`                   | `anthropic`                               | enum   | Provider: `anthropic` / `openai` / `ollama`.                    |
| `MEMHOOK_MODEL`                      | `claude-haiku-4-5`                        | string | Provider model id (per-provider default).                       |
| `MEMHOOK_API_KEY_ENV`                | `ANTHROPIC_API_KEY`                       | string | Name of env var holding the API key.                            |
| `MEMHOOK_BASE_URL`                   | `https://api.anthropic.com/v1/messages`   | string | Provider endpoint (per-provider default).                       |
| `MEMHOOK_CONFIG`                     | `~/.config/memhook/config.yaml`           | path   | Optional YAML config file path.                                 |
| `MEMHOOK_MAX_FILES`                  | `5`                                       | int    | Hard cap on number of files injected.                           |
| `MEMHOOK_MAX_ADDITIONAL_CHARS`       | `9500`                                    | int    | Soft cap on injection size (Claude Code stdout cap = 10 000).   |
| `MEMHOOK_MAX_OUTPUT_TOKENS`          | `200`                                     | int    | Provider's `max_tokens`.                                        |
| `MEMHOOK_TIMEOUT_MS`                 | `8000`                                    | int    | Provider call timeout.                                          |
| `MEMHOOK_DISABLE_CACHE`              | `false`                                   | bool   | Skip the local LRU cache.                                       |
| `MEMHOOK_DISABLE_PREFILTER`          | `false`                                   | bool   | Skip the trivial-prompt filter.                                 |
| `MEMHOOK_CACHE_TTL_MIN`              | `60`                                      | int    | Cache freshness in minutes.                                     |
| `MEMHOOK_CACHE_EVICT_DAYS`           | `7`                                       | int    | Evict cache entries older than N days.                          |
| `MEMHOOK_CACHE_DIR`                  | `$HOME/.cache/memhook`                    | path   | Cache root.                                                     |
| `MEMHOOK_CATALOG_PATH`               | `$HOME/.claude/cache/memory-catalog.txt`  | path   | Catalog file.                                                   |
| `MEMHOOK_LOG_PATH`                   | `$HOME/.claude/logs/memhook.log`          | path   | JSONL log file.                                                 |
| `MEMHOOK_TRIVIAL_FILE`               | `$HOME/.config/memhook/trivial-words.txt` | path   | User-editable trivial words.                                    |
| `MEMHOOK_PROJECTS_ROOT`              | `$HOME/.claude/projects`                  | path   | Memory zones root (override for tests / sandbox).               |
| `MEMHOOK_GLOBAL_RULES_DIR`           | `$HOME/.claude/rules`                     | path   | Global rules dir.                                               |
| `MEMHOOK_CURATE_NUDGE`               | `true`                                    | bool   | Enable the `/curate` nudge (§26). Local-only; no outbound call. |
| `MEMHOOK_CURATE_NUDGE_TOKENS`        | `15000`                                   | int    | Catalog-token estimate that triggers the nudge.                 |
| `MEMHOOK_CURATE_NUDGE_FILES`         | `250`                                     | int    | Memory-file count that triggers the nudge.                      |
| `MEMHOOK_CURATE_NUDGE_COOLDOWN_DAYS` | `7`                                       | int    | Minimum days between nudges.                                    |
| `MEMHOOK_DEBUG`                      | `false`                                   | bool   | Print errors to stderr (default silent fail-soft).              |
| `NO_COLOR` / `MEMHOOK_NO_COLOR`      | _(unset)_                                 | flag   | Disable colour in `init` / `tail`; `FORCE_COLOR` forces it on.  |

---

## 16. Performance targets

| Metric                          | Target        | Measured 2026-05-28 baseline                                         |
| ------------------------------- | ------------- | -------------------------------------------------------------------- |
| Hook latency p50 (cache miss)   | ≤ 2 000 ms    | 1 727 ms (Haiku 4.5)                                                 |
| Hook latency p95 (cache miss)   | ≤ 3 500 ms    | 2 946 ms                                                             |
| Hook latency on cache hit       | ≤ 100 ms      | < 50 ms (file read)                                                  |
| `additional_size_chars` p50     | 5 000 — 9 000 | 13 010 (over cap — must fix to ≤ 9 500)                              |
| Cache hit ratio over 48 h       | ≥ 10 %        | 1.6 % (caveat: cache key includes prompt, so identical prompts only) |
| Pre-filter skip ratio over 48 h | 5 — 15 %      | 10.9 %                                                               |

When a metric drifts more than 25 % below target over a rolling 14-day
window, open an issue + investigate. Don't accept silent regression.

---

## 17. Cost targets

Reference workload: **50 prompts/day**, mixed complexity, 6 working
days/week.

| Provider                       | Monthly cost target | Annual extrapolation                 |
| ------------------------------ | ------------------- | ------------------------------------ |
| Anthropic Haiku 4.5 (default)  | ≤ €12               | ≤ €145                               |
| OpenAI GPT-4o-mini (v0.2)      | ≤ €8                | ≤ €95                                |
| Mistral Small free tier (v0.2) | €0                  | €0 (rate-limit fatal above ~100/day) |
| Gemini Flash-Lite (v0.2)       | ≤ €5                | ≤ €60                                |
| Ollama qwen2.5:1.5b (v0.2)     | €0                  | €0 (local compute only)              |

The README ships a "What does it cost?" section with this table from
v0.2 onwards. Data comes from the live JSONL log + provider pricing
documented in [`docs/PROVIDERS.md`](PROVIDERS.md).

---

## 18. Bench methodology

The bench validates **recall** (does the router pick the right memory
files?) and **cost** (per provider, per prompt class).

### v0.2 baseline (50-prompt suite)

The current bench v2 (9 prompts) is too small for CI. v0.2 must ship
a 50-prompt suite stored at `tests/bench/prompts.json`, covering:

- 20 prompts where 1 specific memory file is the right answer
- 15 prompts where 2-3 files compose the right answer
- 10 prompts where `[]` is the right answer (no relevant memory)
- 5 prompts that are trivial (`pre_filter_skip` expected)

Each prompt declares its ground-truth list in `tests/bench/expected.json`.

The `memhook bench` CLI command runs the suite against the configured
provider, compares with ground truth, and outputs:

- Recall (% of expected files actually selected)
- Precision (% of selected files that were expected)
- Mean latency / p95 latency
- Total cost (€) at the provider's current pricing

Bench runs are reproducible (no calendar-dependent prompts, no flaky
LLM-temperature settings — set `temperature: 0`). CI runs bench on
every merge to `main`; results published to `docs/BENCH.md`.

---

## 19. Security model

### 19.1 Threat surface (in-scope)

- **Path traversal** in catalog reading or file injection (a malicious
  catalog entry like `../../etc/passwd` must be rejected).
- **Prompt injection** through user-controlled file content
  (markdown that asks the model to leak secrets).
- **Cache poisoning** (a tampered cache file that injects content
  the user didn't intend).
- **Supply chain** (malicious npm dep, post-install scripts).

### 19.2 Mitigations

- File basenames validated against `^[A-Za-z0-9._-]+\.md$` — no
  slashes, no traversal.
- Files are read from a hardcoded set of search dirs only, never from
  user-supplied paths.
- Cache JSON is parsed strictly; malformed entries are treated as
  cache misses, not crashes.
- Every dep bump reviewed manually; no `postinstall` scripts in
  shipped deps (audited per release).

### 19.3 Disclosure

See [`SECURITY.md`](../SECURITY.md). Private vulnerability reporting
via GitHub Security Advisories. Embargoed 90 days; coordinated
release with credit to the reporter.

---

## 20. Conventions

### 20.1 Commits — Conventional Commits 1.0

```
type(scope): subject

Optional body, wrap at 100 chars.

BREAKING CHANGE: description (if applicable)
Co-Authored-By: Name <email@example.org>
```

**Allowed types**: `feat`, `fix`, `perf`, `refactor`, `chore`, `docs`,
`style`, `test`, `build`, `ci`, `revert`.

**Allowed scopes**: `router`, `catalog`, `cache`, `prefilter`,
`providers`, `bin`, `config`, `hooks`, `deps`, `ci`, `docs`, `tests`,
`release`, `.claude`, `spec`.

**Subject rules**: ≤ 72 chars, no trailing period, imperative mood.
Proper nouns (Anthropic, Haiku, OpenAI) keep their case.

### 20.2 Branches

- `feature/<slug>` — new capability
- `fix/<slug>` — bug fix
- `perf/<slug>` — performance improvement, no API change
- `refactor/<slug>` — internal restructure
- `chore/<slug>` — maintenance / deps / tooling
- `docs/<slug>` — docs only
- `ci/<slug>` — CI only
- `spec/<slug>` — change to this SPECIFICATION.md (treated as a docs
  change, but uses its own prefix for grep-ability)

### 20.3 PR rules

- PR title MUST match the type of the **highest-ranking** commit in
  the bundle. If any `feat()` is present, PR title is `feat(...)`.
  Otherwise the squash-merge would miss the release-please bump.
- Squash-merge only.
- Description follows `.github/PULL_REQUEST_TEMPLATE.md`.
- CI passes; failsoft-auditor agent ran on any router/CLI change.

---

## 21. Quality gates

| Gate               | Tool                                                    | Trigger                         | Enforced where |
| ------------------ | ------------------------------------------------------- | ------------------------------- | -------------- |
| Format             | prettier                                                | `pre-commit` (lint-staged) + CI | both           |
| Lint               | eslint flat config + typescript-eslint strict           | `pre-commit` + CI               | both           |
| Typecheck          | `tsc --noEmit`                                          | CI                              | CI             |
| Test               | vitest                                                  | CI on every push/PR             | CI             |
| Commit format      | commitlint                                              | `commit-msg` (husky)            | local          |
| PR title format    | squash-merge: PR title = the commit (commitlint, local) | commit-msg                      | local          |
| Security scan      | CodeQL                                                  | weekly + push/PR                | CI             |
| Supply chain       | Dependabot                                              | weekly                          | bot PRs        |
| Fail-soft contract | `failsoft-auditor` agent                                | manual on router/CLI PRs        | dev            |

---

## 22. Roadmap

> **Shipped as of `0.3.0`:** v0.1.x, **v0.2.0** (OpenAI + Ollama providers, YAML
> config), and **v0.3.0** (`memhook init` / `uninstall` + the zero-dep `tail`
> live monitor). **v0.4.0** (this revision) adds the companion skills + the
> `memhook skills` installer + the `/curate` nudge ([§26](#26-companion-skills-v04)).
> **npm publish is live and automated** (Trusted Publishing / OIDC) since v0.2.
> The `docs/PROVIDERS.md` / `docs/CONFIG.md` / `docs/BENCH.md` files the v0.2
> row once promised were **not** created. The rows below are the original
> plan, kept for historical intent.

| Version              | Scope                                                                                                                                                                                                                                                                                                                                           | Target          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **v0.1.0-preview.0** | Initial public preview: Anthropic Haiku provider, fail-soft pipeline, cap-A1 fix, JSONL log, smoke command, failsoft-auditor agent, CI on GitHub-hosted (Linux + macOS + Windows). **NO npm publish yet** — install from source.                                                                                                                | Shipped 2026-06 |
| **v0.1.0-preview.N** | Bug fixes, observability tweaks, doc polish. No new features.                                                                                                                                                                                                                                                                                   | continuous      |
| **v0.1.0**           | First stable preview. Smoke harness for hook contract. Bench v2 ported to 50 prompts. `npm publish --tag preview`.                                                                                                                                                                                                                              | 2026-06         |
| **v0.2.0**           | OpenAI provider + Ollama provider. YAML config file. `docs/PROVIDERS.md` + `docs/CONFIG.md` + `docs/BENCH.md`. README cost table.                                                                                                                                                                                                               | 2026-07         |
| **v0.3.0**           | `memhook init` (Claude Code settings.json wizard with backup) + `memhook uninstall` + `memhook tail` (zero-dep ANSI live monitor, pulled forward from v0.4 — see D20). `npm publish --tag latest`.                                                                                                                                              | 2026-08         |
| **v0.4.0**           | Companion skills: `/wrap` (end-of-session wrap-up), `/curate` (memory hygiene), `/relay` (cross-session handoff). Standalone skills installed by `memhook skills install` (pulled forward from v0.5 — the Ink TUI once slotted here shipped early in v0.3 as a zero-dep reader, D20). Plus the `/curate` nudge (additive `systemMessage`, D26). | 2026-09         |
| **v0.5.0**           | `memhook bench` — run the 50-prompt suite against the configured provider, output recall + cost.                                                                                                                                                                                                                                                | 2026-10         |
| **v1.0.0**           | API freeze. SemVer commitment. Cross-OS testing. Bench v3 (100+ prompts). Polished README.                                                                                                                                                                                                                                                      | 2026-Q4         |

Roadmap reviewed quarterly. A version slips? Document why in the
quarterly review issue, don't quietly push out dates in this file.

---

## 23. Anti-patterns

| Anti-pattern                                                 | Why it's banned                                                                   |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Adding a dep with a `postinstall` script                     | Supply chain risk; ships arbitrary code on install.                               |
| Reading files outside the declared search dirs               | Breaks the local-only invariant; opens path traversal.                            |
| Throwing an uncaught exception from the hook                 | Breaks fail-soft.                                                                 |
| Writing to stdout outside the final JSON envelope            | Pollutes Claude Code's parser; can break the user's session.                      |
| Adding a new outbound URL that's not the configured provider | Breaks the no-telemetry invariant.                                                |
| Caching empty arrays                                         | Wastes disk, no benefit.                                                          |
| Hardcoding model IDs in router (vs config)                   | Forces a release for a model rename.                                              |
| Adding a YAML / JSON / TOML config without env var fallback  | Hurts discoverability and CI sandboxing.                                          |
| Synchronous I/O on the hot path beyond catalog + cache       | Inflates p95 latency.                                                             |
| Schema-strict structured output in CI tests                  | Provider drift breaks the suite. Use schema-lenient parsing + assertion on shape. |

---

## 24. NEVER list

- **NEVER** ship a version that can crash, hang, or exit non-zero from
  `memhook run`.
- **NEVER** introduce telemetry of any kind.
- **NEVER** publish to npm without a green CI on Linux + macOS + Windows.
- **NEVER** merge to `main` without a PR.
- **NEVER** force-push to `main`.
- **NEVER** delete or rewrite history of a tagged release.
- **NEVER** commit a `*.local.json`, `.env`, or any file that could
  carry an API key.
- **NEVER** claim support for an OS that is not in the CI matrix with a
  green test suite — supported means tested, not "probably works".
- **NEVER** rename a logging field without a major version bump.
- **NEVER** make a breaking change to the hook's stdout shape without a major
  version bump. Adding an _optional_ field (e.g. `systemMessage`, v0.4) is
  additive and allowed, the same way the log schema permits new fields (§14);
  removing or renaming `hookSpecificOutput` / `additionalContext` is not.

---

## 25. Decision log

Each row is a one-line decision with a date and a rationale link. Edits
to this section are append-only — past decisions don't get rewritten.

| ID  | Date       | Decision                                                                                               | Rationale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | 2026-06-01 | Renamed `memflow` → `memhook`                                                                          | Earlier working name `memflow` was unavailable on npm; `memhook` = memory + hook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D2  | 2026-06-01 | `MEMHOOK_MAX_ADDITIONAL_CHARS` default 9 500 (was 32 000)                                              | Claude Code stdout cap = 10 000 chars; beyond that, spill-to-file silently.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D3  | 2026-06-01 | Removed `anthropic-beta: extended-cache-ttl-2025-04-11` header                                         | 1 h TTL is GA in 2026; the beta header is obsolete.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D4  | 2026-06-01 | macOS + Linux only; Windows explicitly dropped (later reversed — see D11)                              | No Windows runner; POSIX assumed throughout.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D5  | 2026-06-01 | TUI demoted from v0.1.5 to v0.4                                                                        | 18 MB / 40 transitive deps for Ink not justified before adoption. CLI + `--json` first.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D6  | 2026-06-01 | Removed `@file` streaming claim                                                                        | No Anthropic documentation guarantees `@file` resolution inside `additionalContext` injected by a hook.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D7  | 2026-06-01 | Default model alias `claude-haiku-4-5` (un-snapshotted)                                                | Avoids 404 if Anthropic retires a dated snapshot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | 2026-06-01 | `MEMHOOK_LOG_PATH` field schema frozen                                                                 | Renaming a field requires a major version bump.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D9  | 2026-06-01 | npm publish gated to v0.1.0 (not preview.0)                                                            | Preview tag is for installs-from-source; publish only when the install one-liner is honest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D10 | 2026-06-01 | Bench grown from 9 to 50 prompts at v0.1.0                                                             | Stat power too low at n=9 for CI reproducibility.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D11 | 2026-06-01 | Reversed D4 — Windows re-added as a supported OS                                                       | GitHub Actions is free for public repos, so the CI-credit + runner constraint behind D4 no longer applies. memhook is a dependency-free Node CLI; only `cwdToSlug` needed backslash-normalisation. CI runs Linux + macOS + Windows on github-hosted runners.                                                                                                                                                                                                                                                                                                             |
| D12 | 2026-06-02 | OpenAI + Ollama providers + YAML config shipped (v0.2.0)                                               | Multi-provider via `createProvider` factory; YAML opt-in, env > yaml > default.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D13 | 2026-06-02 | Dropped committed lockfile (`9fb393f`); CI + publish use `npm install`                                 | Avoided an npm cross-platform optional-dep bug.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D14 | 2026-06-02 | npm publish automated via Trusted Publishing (OIDC) + `--provenance`                                   | Supersedes D9's manual plan; no `NPM_TOKEN`, signed provenance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D15 | 2026-06-02 | release-please-action bumped v4 → v5                                                                   | Stay on the maintained major.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D16 | 2026-06-02 | Dropped the `-preview` suffix; plain `0.x` tags                                                        | `0.x` already signals an unstable API (SemVer §4); `-preview` was redundant.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D17 | 2026-06-02 | Added `provider_init_failed` status                                                                    | `createProvider()` throws are caught + logged, preserving fail-soft.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D18 | 2026-06-02 | Cache key gains a `provider` (`type:model`) component                                                  | Switching provider/model must never serve a stale selection.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D19 | 2026-06-02 | Added runtime dep `yaml` (was zero-dep)                                                                | YAML config loader; `yaml` has zero sub-deps.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D20 | 2026-06-02 | `memhook tail` pulled v0.4 → v0.3, built zero-dep (ANSI) not Ink                                       | Revises D5. The live monitor is a colourised reader of the frozen JSONL log; raw ANSI + column layout (`src/ansi.ts`, `src/tail.ts`) needs no TUI framework, so the 18 MB / 40-dep Ink footprint behind the descope no longer applies. Keeps the 1-runtime-dep profile; colour degrades under `NO_COLOR` / non-TTY.                                                                                                                                                                                                                                                      |
| D21 | 2026-06-02 | Added `model` field to the JSONL log (additive)                                                        | `memhook tail` shows which model handled each turn. Additive per the §14 frozen-schema rule (new fields allowed; none renamed/removed).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| D22 | 2026-06-02 | `init`/`uninstall` settings merge is pure + unit-tested; never clobbers                                | The dangerous step (editing `~/.claude/settings.json`) is a pure transform (`src/install.ts`): idempotent, preserves unrelated hooks/keys, backs up before writing, aborts on unparseable JSON, `--dry-run` writes nothing.                                                                                                                                                                                                                                                                                                                                              |
| D23 | 2026-06-02 | `main` branch protection = block force-push + deletion + linear history; **no required status checks** | Required status checks on classic branch protection block release-please's PRs forever: GitHub does not run CI on PRs created by `GITHUB_TOKEN` (anti-recursion), so the release PR has zero checks and can never satisfy them. Only the maintainer can merge (external PRs have no write access) and always sees CI, so checks stay advisory; force-push + deletion blocking is the real guard and satisfies GitHub's "protect this branch" requirement. **Do NOT re-add required status checks** unless release-please is moved off `GITHUB_TOKEN` (GitHub App / PAT). |
| D24 | 2026-06-02 | `ci.yml` triggers on `push:[main]` + `pull_request:[main]` only                                        | Dropped `push` on `feature/**` + `fix/**`. Same-repo branch PRs were double-triggering CI (push event AND pull_request event on the same head), wasting runners and emitting duplicate check runs that stalled the PR merge-gate display. PRs are validated via `pull_request`; `main` keeps a post-merge `push` run.                                                                                                                                                                                                                                                    |
| D25 | 2026-06-02 | Companion skills ship as **standalone skills**, not slash-commands or a plugin                         | Per the Claude Code docs, custom commands are merged into skills, and skills are the superset (supporting files, invocation control, auto-load). `/curate` bundles a `reference.md`, so it needs the skill directory format. Standalone (`~/.claude/skills/<name>/`) keeps the names bare (`/wrap`); a plugin would namespace them (`/memhook:wrap`). A plugin is noted as a future distribution option in [§26](#26-companion-skills-v04).                                                                                                                              |
| D26 | 2026-06-02 | `/curate` nudge emits an **additive** `systemMessage`; local-only                                      | When the catalog grows large the router suggests `/curate` via the documented `systemMessage` field. Additive (§10.2, §24) — absent unless it fires, never alters `additionalContext`. Local-only: reads the already-loaded catalog length, counts memory files, stamps a cooldown file — no outbound call (§6.2 preserved). Fully wrapped so it never affects fail-soft. Toggle `MEMHOOK_CURATE_NUDGE`.                                                                                                                                                                 |
| D27 | 2026-06-02 | `memhook skills` copy plan is pure + unit-tested; non-clobbering                                       | Same discipline as D22 (`install.ts`): the plan (`src/skills.ts`) is a pure transform — idempotent (skips identical), refuses to overwrite a user-edited skill without `--force`, backs up before overwriting; `src/skillsCmd.ts` is the I/O shell. Skills are NOT on the hook path, so they may exit non-zero (§9 boundary).                                                                                                                                                                                                                                            |
| D28 | 2026-06-02 | Pinned third-party GitHub Actions to commit SHAs                                                       | Tags are mutable; a full commit SHA is the only immutable release reference (GitHub "Using third-party actions" hardening guidance). The `github-actions` Dependabot group keeps the SHAs + version comments current.                                                                                                                                                                                                                                                                                                                                                    |
| D29 | 2026-06-02 | Stopped publishing sourcemaps in the npm tarball                                                       | `.js.map` / `.d.ts.map` carry no `sourcesContent` and `src/` is not shipped, so they were dead weight (~35% of the tarball) on an every-prompt hook. Dropped `sourceMap` / `declarationMap` from `tsconfig.json`.                                                                                                                                                                                                                                                                                                                                                        |

---

## 26. Companion skills (v0.4)

memhook ships three **standalone** Claude Code skills (skill format, invoked by
their bare directory name). They are optional, user-invoked, and never on the
hook path.

| Skill     | Source                                    | Purpose                                                                         |
| --------- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| `/wrap`   | `skills/wrap/SKILL.md`                    | End-of-session wrap-up: capture lessons into memory + a journal entry.          |
| `/curate` | `skills/curate/SKILL.md` + `reference.md` | Memory hygiene: dedupe, index sync, split oversized files, rebuild the catalog. |
| `/relay`  | `skills/relay/SKILL.md`                   | Generate a self-contained handoff prompt for a fresh session (read-only).       |

All three carry `disable-model-invocation: true` (user-invoked only — they have
side effects or control timing). They are generic and English: no assumption
beyond memhook's own conventions (a `~/.claude/projects/*/memory/` directory,
the load-bearing `description:` frontmatter, and `memhook build-catalog`).

### Install

`memhook skills install|uninstall|list` (and `memhook init` offers it). The
copy plan is a pure transform in `src/skills.ts`; `src/skillsCmd.ts` is the I/O
shell. Behaviour:

- **install** — copies absent skills into `~/.claude/skills/<name>/`. Idempotent
  (skips an identical skill). A skill that **differs** from shipped (a user edit
  or older version) is left untouched and reported; `--force` overwrites it,
  backing up the existing file first. `--dry-run` prints the plan only.
- **uninstall** — removes only the files memhook ships, backing up a user-edited
  file (outside the skill dir) first, then removes the dir once empty. User-added
  files are left alone.
- **list** — shows each skill's status (not installed / up to date / differs).

The bundled `skills/` directory is shipped in the npm tarball (`package.json`
`files`). `bundledSkillsDir()` resolves it from both `src/` (dev/tests) and
`dist/src/` (published).

### `/curate` nudge

When the catalog passes `MEMHOOK_CURATE_NUDGE_TOKENS` (estimated catalog tokens,
default 15 000) **or** `MEMHOOK_CURATE_NUDGE_FILES` (memory-file count, default
250), the router attaches a one-line `systemMessage` suggesting `/curate`, then
respects a cooldown (`MEMHOOK_CURATE_NUDGE_COOLDOWN_DAYS`, default 7) tracked by
a stamp file in the cache dir. It is **local-only** (no outbound call, §6.2),
**additive** (§10.2), and **fully wrapped** so it can never break fail-soft
(§6.1). Disable with `MEMHOOK_CURATE_NUDGE=false`. See `maybeCurateNudge` in
`src/router.ts`.

### Future option: distribute as a plugin

Claude Code plugins are the canonical way to share a bundle of skills + a hook,
with versioned marketplace installs — but plugin skills are namespaced
(`/memhook:wrap`). Shipping memhook as a plugin (skills + a `hooks/hooks.json`
wiring `memhook run`) is a possible future track; it would trade the bare names
for marketplace distribution. Out of scope for v0.4 (D25).

---

_End of specification. First frozen 2026-06-01; refreshed for v0.2 on 2026-06-02; companion skills (v0.4) on 2026-06-02._
