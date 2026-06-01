# Changelog

All notable changes to memhook are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Hardening pre-publish (CI, CHANGELOG, CONTRIBUTING, `.env.example`)

## [0.1.0-preview.0] — 2026-05-28

Initial public preview.

### Added

- `src/router.ts` — UserPromptSubmit hook entry point with cap-A1 projection
  fix (skip a file pre-injection if its content would push the cumulated
  injection past `maxAdditionalChars`, while always allowing at least one).
- `src/catalog.ts` — catalog builder with Q4 title-only reduction for
  non-CWD zones (~50% size cut on a typical 3-repo layout).
- `src/cache.ts` — local LRU cache keyed on
  `sha256(prompt + catalog_mtime + cwd + script_version)`. Stored as
  per-key JSON files. 60-min TTL by default, 7-day eviction floor.
- `src/preFilter.ts` — trivial-prompt pre-filter loaded from
  `~/.config/memhook/trivial-words.txt` with a sensible default list.
- `src/providers/anthropic.ts` — provider implementation for Anthropic
  Messages API. Uses `ephemeral` `1h` cache control on the system prompt
  (GA in 2026, no beta header) so the catalog sits in cache (10× cheaper
  writes amortised across the hour).
- `src/config.ts` — env-driven config loader. No YAML in v0.1; deferred to
  v0.2.
- `bin/memhook.ts` — CLI with `run`, `build-catalog`, `version`, `help`.
- JSONL observability log at `~/.claude/logs/memhook.log` including
  `additional_size_chars` + `additional_size_tokens_est` so users can audit
  the actual size of the injected `additionalContext` over time.
- 18 unit tests covering the router pipeline, pre-filter normalisation, and
  cache key derivation / TTL / eviction.

[Unreleased]: https://github.com/utilia-ai-wox/memhook/compare/v0.1.0-preview.0...HEAD
[0.1.0-preview.0]: https://github.com/utilia-ai-wox/memhook/releases/tag/v0.1.0-preview.0
