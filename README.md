# memhook

> Semantic memory router for Claude Code — picks the relevant feedbacks &
> rules for each prompt via Haiku, injects them as `additionalContext`.

**Status**: `v0.1.0-preview` — extracted from a private hook used daily across
3 large repos. API surface and naming may shift before `v1.0.0`.

## Why

Claude Code's `~/.claude/` directory accumulates a growing set of
`feedback_*.md` (behavioural corrections) and `rule_*.md` (project doctrine)
files. Loading all of them on every prompt is wasteful (10–14k tokens of
catalog overhead, most of it irrelevant to the current question).

memhook uses **Haiku 4.5** as a cheap router: each user prompt is matched
against a one-line catalog of all available memory files, and only the 0–5
most relevant ones are read and injected into `additionalContext`. The rest
sit on disk, invisible to Claude until they matter.

## How it works

```
UserPromptSubmit hook
    │
    ▼
┌────────────────────────────────────────┐
│ 1. Pre-filter trivial prompts          │ ── "ok" / "merci" → skip LLM
│ 2. Check local LRU cache               │ ── identical prompt < 60min → hit
│ 3. Call Haiku with catalog as system   │ ── ephemeral 1h cache control
│ 4. Parse JSON array of basenames       │ ── ["feedback_X.md", "rule_Y.md"]
│ 5. Read files, cap by token budget     │ ── max 9.5k chars or 5 files
│ 6. Emit additionalContext              │
└────────────────────────────────────────┘
```

## Install

```bash
npm install -g memhook      # not yet published — see "From source" below
```

### From source (preview)

```bash
git clone https://github.com/utilia-ai-wox/memhook.git
cd memhook
bun install
bun run build
npm link
```

## Setup

1. **Set your API key**

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
       "SessionStart": [
         {
           "hooks": [{ "type": "command", "command": "memhook build-catalog" }]
         }
       ]
     }
   }
   ```

## Configuration

Every knob is an env var, and (since `v0.2`) optionally a YAML file.
Precedence per key is **env var > YAML file > built-in default**, so an
env-var-only setup behaves exactly as before. Sensible defaults work for most
users.

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

## Providers

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

## Observability

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

## Status values

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

## Fail-soft

memhook never blocks Claude Code. On any error — missing key, network
timeout, malformed JSON, broken filesystem — it emits an empty
`additionalContext` and logs the status. Your prompt always reaches the
model, just without injected memories for that turn.

## Roadmap

- `v0.2` ✅ — YAML config file, OpenAI provider, Ollama local provider
- `v0.3` — TUI live monitor (`memhook tail`)
- `v0.4` — Companion skills (`/wrap`, `/curate`, `/relay`)
- `v0.5` — Auto-bootstrap (`memhook init` detects empty memory dirs)
- `v1.0` — Cross-platform validated, published to npm

## License

MIT © wox
