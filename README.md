<div align="center">

# memhook

**Stop telling Claude to check its memory. memhook auto-injects the notes relevant to each prompt — so it already knows what you told it.**

<p align="center">
  <a href="https://www.npmjs.com/package/memhook"><img src="https://img.shields.io/npm/v/memhook?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/memhook"><img src="https://img.shields.io/npm/dm/memhook?color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/utilia-ai-wox/memhook/actions/workflows/ci.yml"><img src="https://github.com/utilia-ai-wox/memhook/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/utilia-ai-wox/memhook/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/memhook?color=blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/node/v/memhook" alt="Node version">
  <a href="https://github.com/utilia-ai-wox/memhook/stargazers"><img src="https://img.shields.io/github/stars/utilia-ai-wox/memhook?style=social" alt="GitHub stars"></a>
</p>

A semantic memory router for [Claude Code](https://claude.com/claude-code) — a
`UserPromptSubmit` hook that picks the `feedback_*.md` & `rule_*.md` notes relevant
to _this_ prompt and injects them as `additionalContext`. Your memory gets consulted
automatically — you stop saying _"go read your memory."_

</div>

## ✨ Features

- 🎯 **Right note, right moment** — auto-selects the 0–5 memory files relevant to _this_ prompt and injects them. No more "go read your memory."
- 🧠 **Gets better as your memory grows** — relevance is picked per prompt, so a large memory helps instead of drowning the model.
- 🛡️ **Fail-soft** — never blocks Claude Code; every error path falls back to empty context.
- 🔌 **Multi-provider** — Anthropic (default), OpenAI, or local Ollama. Your key, your endpoint.
- 💸 **Light on context** — injects ~2k tokens of signal instead of a 10–14k-token catalog dump.
- 🤫 **Zero telemetry** — the only outbound call is the LLM endpoint _you_ chose.
- 🪶 **One dependency** — `yaml`, with zero sub-deps.
- ⚡ **Cached & pre-filtered** — an LRU cache + a trivial-prompt skip keep latency near zero.
- 🧰 **One-command setup** — `memhook init` wires the hooks (with backup); `memhook tail` shows routing live.
- 🧩 **Companion skills** — optional `/wrap`, `/curate`, `/relay` to capture, tidy, and hand off your memory.
- 🔗 **Cables onto memory you already have** — point memhook at extra `.md`/`.mdc`/`.txt` directories (`customSources`), or enable a built-in host preset by name (`presets: [...]`, experimental). It installs mid-project and routes the memory that's already there.
- 🔎 **Preset discovery** — `memhook presets detect` scans your project for known-tool memory dirs and prints the `presets:` snippet to enable them.
- 🚫 **No double-injection** — rule zones Claude Code already auto-loads at launch are omitted by default, so memhook routes only what the host doesn't already have (`MEMHOOK_RESURFACE_HOST_LOADED` to re-surface).

## 🤔 Why

Claude Code's `~/.claude/` directory accumulates a growing set of
`feedback_*.md` (behavioural corrections) and `rule_*.md` (project doctrine)
files. The problem isn't their size — it's that Claude doesn't know what's in
there: it misses notes that apply, so you keep telling it _"you wrote that
down, go read it."_

memhook removes that chore. A cheap router model (**Haiku 4.5** by default)
matches each prompt against a one-line catalog of all your memory files and
injects just the relevant ones — so the right note is already in context,
automatically. The rest sit on disk, invisible until they matter.

| Approach              | What Claude sees                | Tokens / prompt |
| --------------------- | ------------------------------- | --------------- |
| Load all memory files | mostly irrelevant noise         | 10–14k          |
| **memhook**           | only what matches _this_ prompt | ~2k             |

## 🚀 Quick start

```bash
npm install -g memhook
export ANTHROPIC_API_KEY=sk-ant-…   # or see Providers for OpenAI / Ollama
memhook init
```

`memhook init` detects your Claude Code config, wires the two hooks into
`~/.claude/settings.json` (backing it up first, never clobbering existing
hooks), and builds the initial catalog. It is idempotent and supports
`--dry-run`. Restart Claude Code and you're done — then watch it work live
with [`memhook tail`](#-observability).

<details>
<summary>Manual setup (what <code>init</code> automates)</summary>

1. **Build the initial catalog**

   ```bash
   memhook build-catalog
   # → ~/.claude/cache/memory-catalog.txt
   ```

2. **Wire the hooks** in `~/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "memhook run" }] }],
       "SessionStart": [{ "hooks": [{ "type": "command", "command": "memhook build-catalog" }] }]
     }
   }
   ```

Remove it all later with `memhook uninstall` (also backs up first).

</details>

<details>
<summary>From source (for contributors)</summary>

```bash
git clone https://github.com/utilia-ai-wox/memhook.git
cd memhook
bun install
bun run build
npm link
```

</details>

## 🔍 How it works

```
UserPromptSubmit hook
    │
    ▼
┌────────────────────────────────────────┐
│ 1. Pre-filter trivial prompts          │ ── "ok" / "merci" → skip LLM
│ 2. Check local LRU cache               │ ── identical prompt < 60min → hit
│ 3. Call the router with catalog        │ ── ephemeral 1h cache control
│ 4. Parse JSON array of basenames       │ ── ["feedback_X.md", "rule_Y.md"]
│ 5. Read files, cap by token budget     │ ── max 9.5k chars or 5 files
│ 6. Emit additionalContext              │
└────────────────────────────────────────┘
```

## ⚙️ Configuration

Every knob is an env var, and optionally a YAML file. Precedence per key is
**env var > YAML file > built-in default**, so an env-var-only setup behaves
exactly as before. Sensible defaults work for most users.

| Variable                         | Default                         | Purpose                                                                     |
| -------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `MEMHOOK_ENABLED`                | `true`                          | Master toggle                                                               |
| `MEMHOOK_PROVIDER`               | `anthropic`                     | `anthropic` \| `openai` \| `ollama`                                         |
| `MEMHOOK_MODEL`                  | per-provider                    | Model id (provider default if unset)                                        |
| `MEMHOOK_API_KEY_ENV`            | per-provider                    | Name of env var holding the API key                                         |
| `MEMHOOK_BASE_URL`               | per-provider                    | Override the provider API endpoint                                          |
| `MEMHOOK_CONFIG`                 | `~/.config/memhook/config.yaml` | Path to the optional YAML config file                                       |
| `MEMHOOK_MAX_FILES`              | `5`                             | Hard cap on injected files                                                  |
| `MEMHOOK_MAX_ADDITIONAL_CHARS`   | `9500`                          | Soft cap on injected chars (≈2.4k tok)                                      |
| `MEMHOOK_MAX_OUTPUT_TOKENS`      | `200`                           | Model output cap for the selection                                          |
| `MEMHOOK_TIMEOUT_MS`             | `8000` (`30000` for ollama)     | Per-request timeout                                                         |
| `MEMHOOK_DISABLE_CACHE=true`     | _(off)_                         | Skip local LRU cache                                                        |
| `MEMHOOK_DISABLE_PREFILTER=true` | _(off)_                         | Skip trivial-prompt skip                                                    |
| `MEMHOOK_RESURFACE_HOST_LOADED`  | `false`                         | Route rules the host auto-loads at launch (off = no double-injection)       |
| `MEMHOOK_CURATE_NUDGE`           | `true`                          | Suggest `/curate` when the catalog grows large (local-only)                 |
| `MEMHOOK_PRESETS_NUDGE`          | `true`                          | Suggest `memhook presets detect` when host memory isn't routed (local-only) |
| `MEMHOOK_DEBUG=true`             | _(off)_                         | Print errors to stderr                                                      |

### YAML config (optional)

memhook works with **no config file at all**. If you prefer YAML, copy
[`config.example.yaml`](config.example.yaml) to `~/.config/memhook/config.yaml`
(or point `MEMHOOK_CONFIG` at it). A missing or malformed file is ignored
silently — memhook falls back to env vars and defaults, never blocking your
prompt.

```yaml
provider:
  type: openai
  # model + apiKeyEnv default to gpt-4o-mini + OPENAI_API_KEY
selection:
  maxFiles: 5

# Cable onto memory that already exists in this project (YAML-only — these two
# keys have no env-var equivalent):
customSources:
  - dir: ./docs/decisions # any directory of .md/.mdc/.txt notes
    glob: "*.md" # optional, default *.md
presets:
  [continue] # built-in host presets (experimental). `memhook presets list`
  # to see them, `memhook presets detect` to find which apply, or `[auto]` for all.
```

## 🔗 Cabling onto existing memory

memhook usually installs mid-project, so memory already exists — often produced
by another tool. Beyond the built-in `~/.claude` zones, you can route it:

- **`customSources`** — point memhook at any directory of `.md`/`.mdc`/`.txt`
  notes (YAML, with an optional glob).
- **`presets`** — built-in bundles for a known tool's atomic rule files, enabled
  by name (`presets: [continue, cline]`) or all at once (`presets: [auto]`). Every
  preset is **experimental** (doc-verified, not yet live-tested).
- **`memhook presets`** — `list` shows the built-ins; `detect` scans your project
  (and home) for the ones that actually have memory on disk and prints the
  `presets: [...]` snippet to paste. When a known tool's memory is present but not
  routed, memhook also nudges you to run `detect` (local-only; `MEMHOOK_PRESETS_NUDGE`).

```bash
memhook presets list      # the built-in per-host presets (all experimental)
memhook presets detect    # which apply to this project → a presets: snippet
```

## 🔌 Providers

The default provider is **Anthropic** — with no `MEMHOOK_PROVIDER` set, the
only outbound call memhook ever makes is to `api.anthropic.com`, using your own
key. Selecting another provider is **opt-in** and changes which endpoint is
contacted. memhook never phones home and has no telemetry; "provider" means the
LLM endpoint _you_ choose to route through.

| Provider  | `MEMHOOK_PROVIDER` | Default model      | API key             | Endpoint                                |
| --------- | ------------------ | ------------------ | ------------------- | --------------------------------------- |
| Anthropic | `anthropic`        | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` | `api.anthropic.com`                     |
| OpenAI    | `openai`           | `gpt-4o-mini`      | `OPENAI_API_KEY`    | `api.openai.com`                        |
| Ollama    | `ollama`           | `llama3.1`         | _none_ (local)      | `http://localhost:11434` (configurable) |

- **OpenAI** — set `MEMHOOK_PROVIDER=openai` and `OPENAI_API_KEY`. Uses the
  Chat Completions API; the catalog rides as the leading system message so
  OpenAI's automatic prompt caching can engage on a large catalog.
- **Ollama** — set `MEMHOOK_PROVIDER=ollama` and make sure the model is pulled
  (`ollama pull llama3.1`) with the daemon running. No API key required. Hits
  the native `/api/chat` endpoint with `stream:false`; the timeout defaults to
  30s to absorb cold model loads.

## 📊 Observability

Every invocation appends one JSON line to `~/.claude/logs/memhook.log`:

```json
{
  "ts": "2026-05-28T08:41:18Z",
  "prompt_preview": "fix the OPAQUE wire format drift…",
  "selected": ["opaque-interop-rust-ts.md"],
  "latency_ms": 1727,
  "tokens_in": 12,
  "tokens_out": 28,
  "cache_create": 0,
  "cache_read": 13398,
  "additional_size_chars": 20225,
  "additional_size_tokens_est": 5056,
  "status": "ok",
  "model": "claude-haiku-4-5"
}
```

### Live view — `memhook tail`

Watch routing decisions as they happen, in colour:

```bash
memhook tail                          # follow live (Ctrl-C to quit)
memhook tail --no-follow              # print recent log + summary, then exit
memhook tail --status ok,cache_hit    # filter by status
memhook tail -n 50                    # show more history first
```

Each row shows the time, status, prompt preview, latency, and model, plus the
memories that were injected; a summary line reports the cache-hit rate and
p50/p95 latency. Colour degrades to plain text when piped or under `NO_COLOR`.
`tail` only reads the log, so it can never affect the hook. For raw analysis,
the log is plain JSONL — e.g. the last 7 days by status:

```bash
jq -c 'select((.ts | fromdateiso8601) > (now - 7*86400)) | .status' \
  ~/.claude/logs/memhook.log | sort | uniq -c
```

### Status values

| `status`               | Meaning                                               |
| ---------------------- | ----------------------------------------------------- |
| `ok`                   | Files injected from a fresh model selection           |
| `cache_hit`            | Files injected from local LRU cache                   |
| `pre_filter_skip`      | Trivial prompt, LLM call skipped                      |
| `empty_selection`      | The model returned `[]` (no memory needed)            |
| `all_unfound`          | The model returned basenames that don't exist on disk |
| `no_catalog`           | Catalog missing — run `memhook build-catalog`         |
| `no_api_key`           | API key env var not set (not needed for ollama)       |
| `provider_init_failed` | Provider couldn't be constructed (bad config)         |
| `api_no_response`      | Network error or timeout                              |
| `api_no_content`       | API returned 200 but no text                          |
| `parse_invalid`        | Response wasn't a valid JSON array                    |

## 🧩 Companion skills

Routing only works well when your memory stays healthy. memhook ships three
optional Claude Code skills for that — install them with one command:

```bash
memhook skills install      # copy them into ~/.claude/skills
memhook skills list         # show install status
memhook skills uninstall    # remove them (backs up any edits first)
```

`memhook init` also offers to install them.

| Skill     | What it does                                                                                                                 |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `/wrap`   | End-of-session wrap-up — captures the session's lessons into memory + a dated journal entry. Proposes; never writes unasked. |
| `/curate` | Memory hygiene — dedupes, fixes the `MEMORY.md` index, splits oversized files, then rebuilds the catalog.                    |
| `/relay`  | Generates a self-contained prompt to resume work in a fresh session. Read-only.                                              |

They're standalone skills, so you invoke them directly as `/wrap`, `/curate`,
`/relay`. They are user-invoked only — Claude won't trigger them on its own.

When your catalog grows large, memhook also adds a one-line reminder to run
`/curate` (a local-only `systemMessage`, 7-day cooldown — toggle with
`MEMHOOK_CURATE_NUDGE`).

## 🛡️ Fail-soft

memhook never blocks Claude Code. On any error — missing key, network
timeout, malformed JSON, broken filesystem — it emits an empty
`additionalContext` and logs the status. **Your prompt always reaches the
model**, just without injected memories for that turn.

## 🗺️ Roadmap

- `v0.2` ✅ — YAML config file, OpenAI provider, Ollama local provider (published on npm)
- `v0.3` ✅ — `memhook init` / `memhook uninstall` setup wizard + zero-dep live monitor (`memhook tail`)
- `v0.4` ✅ — Companion skills (`/wrap`, `/curate`, `/relay`) + `memhook skills` installer + `/curate` nudge
- `v0.5` ✅ — Source registry: `customSources`, built-in host `presets` (experimental), `memhook presets list/detect`, the presets nudge, and host-autoloaded rule-zone omission by default (`MEMHOOK_RESURFACE_HOST_LOADED`)
- `v0.6` 🚧 — `.mdc`/`.txt` source extensions (shipped to `main`); a Cursor preset to follow
- `v1.0` — API frozen, cross-platform validated, polished docs

## 🤝 Contributing

Contributions welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first.
The hook contract (fail-soft, no telemetry, strict TypeScript) is
non-negotiable; the [`failsoft-auditor`](.claude/agents/failsoft-auditor.md)
agent guards it on every PR.

> [!TIP]
> ⭐ If memhook keeps Claude on-context without the "go read your memory" nudges, **star the repo** — it helps other Claude Code users find it.

## License

MIT © wox
