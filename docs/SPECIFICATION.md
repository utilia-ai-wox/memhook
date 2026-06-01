# memhook — project specification

> This document is the **frozen development contract** for memhook.
> Any Claude Code instance working on this repository MUST read it
> before writing code, opening PRs, or changing public surfaces.
> Changes to this spec happen through dedicated PRs labelled `spec`,
> never as a side-effect of feature work.
>
> **Status**: v0.1 spec, frozen 2026-06-01. **Implementation status**:
> v0.1.0-preview.0 in progress; see [§22 Roadmap](#22-roadmap) for
> the version-by-version delivery plan.

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

| Field           | Value                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Name**        | `memhook`                                                                                                                            |
| **Tagline**     | Semantic memory router for Claude Code                                                                                               |
| **One-liner**   | A `UserPromptSubmit` hook that asks Haiku to pick 0–5 relevant memory files per user prompt and injects them as `additionalContext`. |
| **License**     | MIT                                                                                                                                  |
| **Repository**  | https://github.com/utilia-ai-wox/memhook                                                                                             |
| **npm package** | `memhook` (scope `none`)                                                                                                             |
| **Bin command** | `memhook`                                                                                                                            |
| **Status**      | `v0.1.0-preview` — extracted from a private daily-use hook; API surface may shift before `1.0.0`.                                    |

### Naming rationale

Picked after a 2026-06-01 audit of OSS comparables. `memflow` (the
original working name) is taken on multiple fronts:

- `memflow/memflow` Rust physical-memory introspection (1 K stars, dedicated org)
- 2 ML papers
- 2 npm squatters (`memflow-mcp`, `memflow-cli`)

`memhook` is short (7 chars), unambiguous (memory + hook = exactly what
this project does), free on npm, and SEO-clean. Alternative finalists
that remain available if `memhook` ever collides: `recallhook`,
`memcurate`, `claude-memhook`.

---

## 2. Stack

| Layer             | Choice                                                                | Rationale                                                                                                   |
| ----------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Runtime           | **Node 18+** (LTS line)                                               | Active LTS through 2027. Required `fs.watch` recursive support.                                             |
| Language          | **TypeScript strict ESM**                                             | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` enabled. ESM only — no CommonJS.         |
| Build             | **`tsc -p tsconfig.json`** → `dist/`                                  | No bundler. Distribution as ESM with `.d.ts`.                                                               |
| Tests             | **vitest**                                                            | Fast, ESM-native, mock-friendly. Snapshot only when justified.                                              |
| Package manager   | **npm** (primary)                                                     | `package-lock.json` committed for reproducibility. `bun` allowed for local dev acceleration (not required). |
| Lint              | **eslint** flat config + `typescript-eslint` strict + stylistic       |                                                                                                             |
| Format            | **prettier**                                                          | Config: 2-space indent, semicolons, trailing commas, line width 100.                                        |
| Commit hooks      | **husky** v9 + **commitlint** + **lint-staged**                       |                                                                                                             |
| Release           | **release-please-action** v4, manifest mode                           | Pre-release tags `0.X.Y-preview.N`.                                                                         |
| CI                | **GitHub Actions** matrix Linux + macOS + Windows × Node 18 / 20 / 22 | GitHub-hosted runners — free for a public repo.                                                             |
| Security scanning | **CodeQL** weekly + on push/PR                                        |                                                                                                             |
| Dependency bumps  | **Dependabot** weekly, grouped by category                            |                                                                                                             |

### Runtime dependency policy

- **Zero runtime dependencies** in the core router as of v0.1.
- Provider adapters may bring their own optional deps, documented per
  provider in [`docs/PROVIDERS.md`](PROVIDERS.md).
- No transitive dep introducing telemetry / phone-home. Every dep bump
  reviewed against this rule.

---

## 3. Versioning

memhook follows **SemVer 2.0** strictly.

### Pre-1.0 phase

- Tag format: `v0.X.Y-preview.N` (e.g. `v0.1.0-preview.0`).
- Any `feat` → minor bump. Any `fix` → patch bump.
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
5. `npm publish` is **manual** in v0.1 (deferred automation to v0.3).
   Command: `npm publish --tag preview` until v1.0.0; then `npm publish`.

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
   config.ts   preFilter.ts   cache.ts    providers/anthropic.ts
                                          providers/openai.ts (v0.2)
                                          providers/ollama.ts (v0.2)
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
│   ├── config.ts             — env-driven config loader (§8.6)
│   └── providers/
│       ├── types.ts          — Provider interface (§8.5)
│       ├── anthropic.ts      — Anthropic Messages adapter (ship v0.1)
│       ├── openai.ts         — OpenAI Chat Completions adapter (v0.2)
│       └── ollama.ts         — Ollama HTTP adapter (v0.2)
│
├── bin/
│   └── memhook.ts            — CLI entrypoint
│
├── tests/
│   ├── router.test.ts
│   ├── cache.test.ts
│   ├── preFilter.test.ts
│   ├── catalog.test.ts       — v0.2
│   └── providers/
│       └── anthropic.test.ts — v0.2
│
├── dist/                     — tsc output, gitignored, built on publish
│
└── docs/
    ├── SPECIFICATION.md      — THIS FILE
    ├── CONFIG.md             — env var reference (v0.2)
    ├── PROVIDERS.md          — provider setup guides (v0.2)
    └── BENCH.md              — bench methodology (v0.2)
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

| Status            | Meaning                                               |
| ----------------- | ----------------------------------------------------- |
| `ok`              | Files injected from a fresh provider selection.       |
| `cache_hit`       | Files injected from local LRU cache.                  |
| `pre_filter_skip` | Trivial prompt; LLM call skipped.                     |
| `empty_selection` | Provider returned `[]`.                               |
| `all_unfound`     | Provider returned basenames that don't exist on disk. |
| `no_catalog`      | Catalog file missing.                                 |
| `no_api_key`      | `$ANTHROPIC_API_KEY` (or configured env) absent.      |
| `api_no_response` | Provider HTTP error / network timeout.                |
| `api_no_content`  | Provider 200 but no text returned.                    |
| `parse_invalid`   | Response wasn't a valid JSON array.                   |

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
key = sha256(prompt + "|" + catalog_mtime + "|" + cwd + "|" + script_version)
```

Each component is required: changing any one invalidates the entry.
The `script_version` field comes from `package.json:version` so a
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
`maxOutputTokens`, `cacheControlTtl`, `timeoutMs`. `SelectionResponse`
carries `rawText`, `usage` (input / output / cache_create / cache_read
tokens), `latencyMs`, `httpStatus`.

The router selects a provider based on `config.provider.type` and
constructs it with `apiKey` resolved from `env[config.provider.apiKeyEnv]`.

**v0.1 ships**: `anthropic` only. **v0.2 will ship**: `openai`, `ollama`.

### 8.6 `src/config.ts`

Env-driven config loader. **No YAML in v0.1** (deferred to v0.2 with
`yaml` or `js-yaml`). Single exported function:

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

| Command                 | Status | Purpose                                                                                                                                            |
| ----------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `memhook run`           | v0.1   | Read hook JSON from stdin, emit `additionalContext`.                                                                                               |
| `memhook build-catalog` | v0.1   | (Re)build `~/.claude/cache/memory-catalog.txt`.                                                                                                    |
| `memhook version`       | v0.1   | Print `package.json:version`.                                                                                                                      |
| `memhook help`          | v0.1   | Print this command list + env var reference.                                                                                                       |
| `memhook init`          | v0.3   | Interactive setup: detect Claude Code paths, write hook to `~/.claude/settings.json` (with backup), validate API key, bootstrap empty memory dirs. |
| `memhook uninstall`     | v0.3   | Remove hooks from `~/.claude/settings.json` (with backup), prompt for cache + log cleanup.                                                         |
| `memhook tail`          | v0.4   | Live TUI tail of the JSONL log (status distribution, p50/p95 latency, top memories, daily cost).                                                   |
| `memhook bench`         | v0.5   | Run the 50-prompt bench suite against the configured provider; output recall + cost table.                                                         |

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
  }
}
```

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

### 11.1 Anthropic (ships v0.1)

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

### 11.2 OpenAI (v0.2)

- Model default: `gpt-4o-mini`.
- Endpoint: `https://api.openai.com/v1/chat/completions`.
- Cost: ~$0.15 input / $0.60 output per MTok. ~33 % cheaper than Haiku.
- Recall measured at **77.8 %** vs 88.9 % for Haiku (bench v2, 9 prompts).

### 11.3 Ollama (v0.2)

- Model default: `qwen2.5:1.5b` (986 MB disk Q4, ~1.2 GB RAM resident).
- Endpoint: `http://localhost:11434/api/chat`.
- Cost: zero — local inference.
- Recall: provider-dependent; document a measured baseline before shipping.
- No `cache_control` field — the cache feature is Anthropic-specific.

---

## 12. Cache contract

See [§8.3](#83-srccachets) for implementation. Invariants:

- One JSON file per key.
- The file's payload is a JSON array of basenames (e.g.
  `["feedback_x.md", "rule_y.md"]`).
- Empty arrays (`[]`) are **not cached** (a `[]` from the provider
  usually means "nothing relevant" — re-asking next time costs ~zero).
- A `script_version` change retires every cached entry transparently.
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
  "status": "ok"
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
| `status`                     | string                  | One of the 10 values in [§8.1](#81-srcrouterts).                                           |

This log is the primary observability surface. Cost dashboards and
the `memhook tail` TUI both parse it. The schema is **frozen**: new
fields may be added, existing fields may not be renamed or removed
without a major version bump.

---

## 15. Configuration

All knobs are env vars in v0.1 (no config file). Sensible defaults
work for most users.

| Variable                       | Default                                   | Type   | Purpose                                                       |
| ------------------------------ | ----------------------------------------- | ------ | ------------------------------------------------------------- |
| `MEMHOOK_ENABLED`              | `true`                                    | bool   | Master toggle.                                                |
| `MEMHOOK_MODEL`                | `claude-haiku-4-5`                        | string | Provider model id.                                            |
| `MEMHOOK_API_KEY_ENV`          | `ANTHROPIC_API_KEY`                       | string | Name of env var holding the API key.                          |
| `MEMHOOK_BASE_URL`             | `https://api.anthropic.com/v1/messages`   | string | Provider endpoint.                                            |
| `MEMHOOK_MAX_FILES`            | `5`                                       | int    | Hard cap on number of files injected.                         |
| `MEMHOOK_MAX_ADDITIONAL_CHARS` | `9500`                                    | int    | Soft cap on injection size (Claude Code stdout cap = 10 000). |
| `MEMHOOK_MAX_OUTPUT_TOKENS`    | `200`                                     | int    | Provider's `max_tokens`.                                      |
| `MEMHOOK_TIMEOUT_MS`           | `8000`                                    | int    | Provider call timeout.                                        |
| `MEMHOOK_DISABLE_CACHE`        | `false`                                   | bool   | Skip the local LRU cache.                                     |
| `MEMHOOK_DISABLE_PREFILTER`    | `false`                                   | bool   | Skip the trivial-prompt filter.                               |
| `MEMHOOK_CACHE_TTL_MIN`        | `60`                                      | int    | Cache freshness in minutes.                                   |
| `MEMHOOK_CACHE_EVICT_DAYS`     | `7`                                       | int    | Evict cache entries older than N days.                        |
| `MEMHOOK_CACHE_DIR`            | `$HOME/.cache/memhook`                    | path   | Cache root.                                                   |
| `MEMHOOK_CATALOG_PATH`         | `$HOME/.claude/cache/memory-catalog.txt`  | path   | Catalog file.                                                 |
| `MEMHOOK_LOG_PATH`             | `$HOME/.claude/logs/memhook.log`          | path   | JSONL log file.                                               |
| `MEMHOOK_TRIVIAL_FILE`         | `$HOME/.config/memhook/trivial-words.txt` | path   | User-editable trivial words.                                  |
| `MEMHOOK_PROJECTS_ROOT`        | `$HOME/.claude/projects`                  | path   | Memory zones root (override for tests / sandbox).             |
| `MEMHOOK_GLOBAL_RULES_DIR`     | `$HOME/.claude/rules`                     | path   | Global rules dir.                                             |
| `MEMHOOK_DEBUG`                | `false`                                   | bool   | Print errors to stderr (default silent fail-soft).            |

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

| Gate               | Tool                                          | Trigger                         | Enforced where |
| ------------------ | --------------------------------------------- | ------------------------------- | -------------- |
| Format             | prettier                                      | `pre-commit` (lint-staged) + CI | both           |
| Lint               | eslint flat config + typescript-eslint strict | `pre-commit` + CI               | both           |
| Typecheck          | `tsc --noEmit`                                | CI                              | CI             |
| Test               | vitest                                        | CI on every push/PR             | CI             |
| Commit format      | commitlint                                    | `commit-msg` (husky)            | local          |
| PR title format    | commitlint via Action (v0.2)                  | PR sync                         | CI             |
| Security scan      | CodeQL                                        | weekly + push/PR                | CI             |
| Supply chain       | Dependabot                                    | weekly                          | bot PRs        |
| Fail-soft contract | `failsoft-auditor` agent                      | manual on router/CLI PRs        | dev            |

---

## 22. Roadmap

| Version              | Scope                                                                                                                                                                                                                            | Target             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **v0.1.0-preview.0** | Initial public preview: Anthropic Haiku provider, fail-soft pipeline, cap-A1 fix, JSONL log, smoke command, failsoft-auditor agent, CI on GitHub-hosted (Linux + macOS + Windows). **NO npm publish yet** — install from source. | Shipped 2026-06-XX |
| **v0.1.0-preview.N** | Bug fixes, observability tweaks, doc polish. No new features.                                                                                                                                                                    | continuous         |
| **v0.1.0**           | First stable preview. Smoke harness for hook contract. Bench v2 ported to 50 prompts. `npm publish --tag preview`.                                                                                                               | 2026-06            |
| **v0.2.0**           | OpenAI provider + Ollama provider. YAML config file. `docs/PROVIDERS.md` + `docs/CONFIG.md` + `docs/BENCH.md`. README cost table.                                                                                                | 2026-07            |
| **v0.3.0**           | `memhook init` (Claude Code settings.json wizard with backup) + `memhook uninstall`. `npm publish --tag latest`. PR to `hesreallyhim/awesome-claude-code`.                                                                       | 2026-08            |
| **v0.4.0**           | `memhook tail` TUI (Ink). Live status distribution + p50/p95 latency + top memories. **Descoped from v0.1.5 after the 2026-06-01 audit** (footprint 18 MB / 40 deps transitives — wait until adoption justifies it).             | 2026-09            |
| **v0.5.0**           | Companion skills: `/wrap` (end-of-session journaling), `/curate` (memory hygiene audit), `/relay` (cross-session handoff prompt). Documented as optional.                                                                        | 2026-10            |
| **v1.0.0**           | API freeze. SemVer commitment. Cross-OS testing. Bench v3 (100+ prompts). Polished README. Listing on awesome-lists.                                                                                                             | 2026-Q4            |

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
- **NEVER** publish to npm without a green CI on Linux + macOS.
- **NEVER** merge to `main` without a PR.
- **NEVER** force-push to `main`.
- **NEVER** delete or rewrite history of a tagged release.
- **NEVER** commit a `*.local.json`, `.env`, or any file that could
  carry an API key.
- **NEVER** claim support for an OS that is not in the CI matrix with a
  green test suite — supported means tested, not "probably works".
- **NEVER** rename a logging field without a major version bump.
- **NEVER** change the hook's stdout shape without a major version bump.

---

## 25. Decision log

Each row is a one-line decision with a date and a rationale link. Edits
to this section are append-only — past decisions don't get rewritten.

| ID  | Date       | Decision                                                       | Rationale                                                                                                                                                                                                                                                    |
| --- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | 2026-06-01 | Renamed `memflow` → `memhook`                                  | npm + GitHub squatters + Rust forensics SEO collision. See [audit §3](private/MEMORY-GUARD-PLAN-AUDIT-2026-06-01.md#3-differentiator-vs-oss-comparables) (private).                                                                                          |
| D2  | 2026-06-01 | `MEMHOOK_MAX_ADDITIONAL_CHARS` default 9 500 (was 32 000)      | Claude Code stdout cap = 10 000 chars; beyond that, spill-to-file silently. See [audit §1 F1](private/MEMORY-GUARD-PLAN-AUDIT-2026-06-01.md#1-factual-freshness--claims-vs-réalité-2026) (private).                                                          |
| D3  | 2026-06-01 | Removed `anthropic-beta: extended-cache-ttl-2025-04-11` header | 1 h TTL is GA in 2026; the beta header is obsolete.                                                                                                                                                                                                          |
| D4  | 2026-06-01 | macOS + Linux only; Windows explicitly dropped                 | No Windows runner; POSIX assumed throughout.                                                                                                                                                                                                                 |
| D5  | 2026-06-01 | TUI demoted from v0.1.5 to v0.4                                | 18 MB / 40 transitive deps for Ink not justified before adoption. CLI + `--json` first.                                                                                                                                                                      |
| D6  | 2026-06-01 | Removed `@file` streaming claim                                | No Anthropic documentation guarantees `@file` resolution inside `additionalContext` injected by a hook.                                                                                                                                                      |
| D7  | 2026-06-01 | Default model alias `claude-haiku-4-5` (un-snapshotted)        | Avoids 404 if Anthropic retires a dated snapshot.                                                                                                                                                                                                            |
| D8  | 2026-06-01 | `MEMHOOK_LOG_PATH` field schema frozen                         | Renaming a field requires a major version bump.                                                                                                                                                                                                              |
| D9  | 2026-06-01 | npm publish gated to v0.1.0 (not preview.0)                    | Preview tag is for installs-from-source; publish only when the install one-liner is honest.                                                                                                                                                                  |
| D10 | 2026-06-01 | Bench grown from 9 to 50 prompts at v0.1.0                     | Stat power too low at n=9 for CI reproducibility.                                                                                                                                                                                                            |
| D11 | 2026-06-01 | Reversed D4 — Windows re-added as a supported OS               | GitHub Actions is free for public repos, so the CI-credit + runner constraint behind D4 no longer applies. memhook is a dependency-free Node CLI; only `cwdToSlug` needed backslash-normalisation. CI runs Linux + macOS + Windows on github-hosted runners. |

---

_End of specification. Total ~620 lines, frozen 2026-06-01._
