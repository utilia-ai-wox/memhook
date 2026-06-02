<div align="center">

# memhook

**Stop loading every memory file on every prompt. memhook routes only the relevant ones.**

<p align="center">
  <a href="https://www.npmjs.com/package/memhook"><img src="https://img.shields.io/npm/v/memhook?color=cb3837&logo=npm" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/memhook"><img src="https://img.shields.io/npm/dm/memhook?color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/utilia-ai-wox/memhook/actions/workflows/ci.yml"><img src="https://github.com/utilia-ai-wox/memhook/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/utilia-ai-wox/memhook/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/memhook?color=blue" alt="License: MIT"></a>
  <img src="https://img.shields.io/node/v/memhook" alt="Node version">
  <a href="https://github.com/utilia-ai-wox/memhook/stargazers"><img src="https://img.shields.io/github/stars/utilia-ai-wox/memhook?style=social" alt="GitHub stars"></a>
</p>

A semantic memory router for [Claude Code](https://claude.com/claude-code) — a
`UserPromptSubmit` hook that picks the relevant `feedback_*.md` & `rule_*.md`
files for each prompt and injects them as `additionalContext`.

</div>

<!-- TODO(demo): record an asciinema of `tail -f ~/.claude/logs/memhook.log`
     while prompting Claude Code — it shows the router picking files live.
     Embed: [![asciicast](https://asciinema.org/a/XXXXX.svg)](https://asciinema.org/a/XXXXX) -->

## ✨ Features

- 🎯 **Relevant-only injection** — a cheap model picks the 0–5 memory files that matter for _this_ prompt.
- 💸 **Token-frugal** — skips the 10–14k-token catalog dump; injects ~2k tokens of signal.
- 🛡️ **Fail-soft** — never blocks Claude Code; every error path falls back to empty context.
- 🔌 **Multi-provider** — Anthropic (default), OpenAI, or local Ollama. Your key, your endpoint.
- 🤫 **Zero telemetry** — the only outbound call is the LLM endpoint _you_ chose.
- 🪶 **One dependency** — `yaml`, with zero sub-deps.
- ⚡ **Cached & pre-filtered** — an LRU cache + a trivial-prompt skip keep latency near zero.

## 🤔 Why

Claude Code's `~/.claude/` directory accumulates a growing set of
`feedback_*.md` (behavioural corrections) and `rule_*.md` (project doctrine)
files. Loading all of them on every prompt is wasteful — most of it is
irrelevant to the question at hand.

memhook uses a cheap router model (**Haiku 4.5** by default) to match each
prompt against a one-line catalog of all your memory files, and injects only
the most relevant ones. The rest sit on disk, invisible until they matter.

| Approach              | Tokens / prompt | Relevance         |
| --------------------- | --------------- | ----------------- |
| Load all memory files | 10–14k          | mostly irrelevant |
| **memhook**           | ~2k             | only what matches |

## 🚀 Quick start

```bash
npm install -g memhook
```

Then:

1. **Set your API key** (Anthropic by default — see [Providers](#-providers) for OpenAI / Ollama)

   ```bash
   export ANTHROPIC_API_KEY=sk-ant-…
   ```

2. **Build the initial catalog**

   ```bash
   memhook build-catalog
   # → ~/.claude/cache/memory-catalog.txt
   ```

3. **Wire the hooks** in `~/.claude/settings.json`:

   ```json
   {
     "hooks": {
       "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "memhook run" }] }],
       "SessionStart": [{ "hooks": [{ "type": "command", "command": "memhook build-catalog" }] }]
     }
   }
   ```

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

| Variable                         | Default                         | Purpose                                |
| -------------------------------- | ------------------------------- | -------------------------------------- |
| `MEMHOOK_ENABLED`                | `true`                          | Master toggle                          |
| `MEMHOOK_PROVIDER`               | `anthropic`                     | `anthropic` \| `openai` \| `ollama`    |
| `MEMHOOK_MODEL`                  | per-provider                    | Model id (provider default if unset)   |
| `MEMHOOK_API_KEY_ENV`            | per-provider                    | Name of env var holding the API key    |
| `MEMHOOK_BASE_URL`               | per-provider                    | Override the provider API endpoint     |
| `MEMHOOK_CONFIG`                 | `~/.config/memhook/config.yaml` | Path to the optional YAML config file  |
| `MEMHOOK_MAX_FILES`              | `5`                             | Hard cap on injected files             |
| `MEMHOOK_MAX_ADDITIONAL_CHARS`   | `9500`                          | Soft cap on injected chars (≈2.4k tok) |
| `MEMHOOK_MAX_OUTPUT_TOKENS`      | `200`                           | Model output cap for the selection     |
| `MEMHOOK_TIMEOUT_MS`             | `8000` (`30000` for ollama)     | Per-request timeout                    |
| `MEMHOOK_DISABLE_CACHE=true`     | _(off)_                         | Skip local LRU cache                   |
| `MEMHOOK_DISABLE_PREFILTER=true` | _(off)_                         | Skip trivial-prompt skip               |
| `MEMHOOK_DEBUG=true`             | _(off)_                         | Print errors to stderr                 |

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
  "status": "ok"
}
```

Useful one-liner to inspect the last 7 days:

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

## 🛡️ Fail-soft

memhook never blocks Claude Code. On any error — missing key, network
timeout, malformed JSON, broken filesystem — it emits an empty
`additionalContext` and logs the status. **Your prompt always reaches the
model**, just without injected memories for that turn.

## 🗺️ Roadmap

- `v0.2` ✅ — YAML config file, OpenAI provider, Ollama local provider (published on npm)
- `v0.3` — `memhook init` setup wizard + TUI live monitor (`memhook tail`)
- `v0.4` — Companion skills (`/wrap`, `/curate`, `/relay`)
- `v1.0` — API frozen, cross-platform validated, listed on awesome-lists

## 🤝 Contributing

Contributions welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first.
The hook contract (fail-soft, no telemetry, strict TypeScript) is
non-negotiable; the [`failsoft-auditor`](.claude/agents/failsoft-auditor.md)
agent guards it on every PR.

> [!TIP]
> ⭐ If memhook saves you tokens, **star the repo** — it helps other Claude Code users find it.

## License

MIT © wox
