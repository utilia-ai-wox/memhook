# Changelog

All notable changes to memhook are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0](https://github.com/cyprien-bussy/memhook/compare/v0.5.0...v0.6.0) (2026-06-08)


### Features

* **catalog:** per-file autoload predicate + cursor preset ([#48](https://github.com/cyprien-bussy/memhook/issues/48)) ([4b921aa](https://github.com/cyprien-bussy/memhook/commit/4b921aa88aed0ec70f79b74c5c85491893d7b4c9))
* **catalog:** widen routable source extensions to .md/.mdc/.txt ([#45](https://github.com/cyprien-bussy/memhook/issues/45)) ([1439b7d](https://github.com/cyprien-bussy/memhook/commit/1439b7d424e8196efec64aaad6222dc8aa34e515))


### Documentation

* strip emojis from section headers and feature bullets ([5ab730f](https://github.com/cyprien-bussy/memhook/commit/5ab730fee8098d5d18c3454b7e8c0057da8d1679))
* sync README/CLAUDE/SPEC to the v0.5.0 source registry ([#47](https://github.com/cyprien-bussy/memhook/issues/47)) ([ec5a9ca](https://github.com/cyprien-bussy/memhook/commit/ec5a9ca60189517cdc39955c8cb72b9ea05aeaa4))

## [0.5.0](https://github.com/utilia-ai-wox/memhook/compare/v0.4.1...v0.5.0) (2026-06-03)


### Features

* **catalog:** add built-in host presets ([#41](https://github.com/utilia-ai-wox/memhook/issues/41)) ([596aa11](https://github.com/utilia-ai-wox/memhook/commit/596aa112e691bd94348e0883f12f09950bbe1f99))
* **catalog:** add custom memory sources ([#40](https://github.com/utilia-ai-wox/memhook/issues/40)) ([fde6507](https://github.com/utilia-ai-wox/memhook/commit/fde6507741f89286c20c31d143cc78eb0f5aff0a))
* **catalog:** add preset discovery command (presets list/detect) ([#42](https://github.com/utilia-ai-wox/memhook/issues/42)) ([9ce7c1c](https://github.com/utilia-ai-wox/memhook/commit/9ce7c1cb7903c5a7cce204dfdec5809bd1f98b09))
* **catalog:** add presets:[auto] zero-config preset routing ([#44](https://github.com/utilia-ai-wox/memhook/issues/44)) ([9b6f50a](https://github.com/utilia-ai-wox/memhook/commit/9b6f50ad6eeb1576b4e4da3c0542aeac6589dbd1))
* **catalog:** omit host-autoloaded rule zones by default ([#39](https://github.com/utilia-ai-wox/memhook/issues/39)) ([0b6dee0](https://github.com/utilia-ai-wox/memhook/commit/0b6dee0a274e497c20070cdea22ecee87e6187ba))
* **router:** add presets nudge for unrouted host memory ([#43](https://github.com/utilia-ai-wox/memhook/issues/43)) ([f76d159](https://github.com/utilia-ai-wox/memhook/commit/f76d159411e0b65d4c7fcfcfb40bad064700df6a))
* **router:** introduce a harness-adapter seam with Claude Code as adapter [#1](https://github.com/utilia-ai-wox/memhook/issues/1) ([#38](https://github.com/utilia-ai-wox/memhook/issues/38)) ([cebe646](https://github.com/utilia-ai-wox/memhook/commit/cebe646868ca2f502ffeabe9abf9f9ddc97753a3))


### Documentation

* clarify the README value proposition ([#36](https://github.com/utilia-ai-wox/memhook/issues/36)) ([f663237](https://github.com/utilia-ai-wox/memhook/commit/f663237de7cd3727db7715faf36309fc83a77fcd))

## [0.4.1](https://github.com/utilia-ai-wox/memhook/compare/v0.4.0...v0.4.1) (2026-06-02)


### Bug Fixes

* harden parsing, packaging, and CI; expand test coverage ([#34](https://github.com/utilia-ai-wox/memhook/issues/34)) ([9c4fd7f](https://github.com/utilia-ai-wox/memhook/commit/9c4fd7f463504d25eb669d26528228e92cd8a4a9))

## [0.4.0](https://github.com/utilia-ai-wox/memhook/compare/v0.3.0...v0.4.0) (2026-06-02)


### Features

* companion skills (/wrap /curate /relay) + installer + nudge ([#32](https://github.com/utilia-ai-wox/memhook/issues/32)) ([3ede75d](https://github.com/utilia-ai-wox/memhook/commit/3ede75dd94cd5383a54dd0540b34b308e649a696))

## [0.3.0](https://github.com/utilia-ai-wox/memhook/compare/v0.2.2...v0.3.0) (2026-06-02)


### Features

* add init/uninstall setup + tail live monitor ([#29](https://github.com/utilia-ai-wox/memhook/issues/29)) ([e895c9a](https://github.com/utilia-ai-wox/memhook/commit/e895c9a44fb46a141a20f1716999be3a0208bb89))


### Bug Fixes

* harden hook path against file-system races and stdin errors ([#30](https://github.com/utilia-ai-wox/memhook/issues/30)) ([8a0f10e](https://github.com/utilia-ai-wox/memhook/commit/8a0f10e1d7a7184b7cc5fdcb4eb20ae4be516b0d))


### Documentation

* refresh all docs for v0.2.2 and revamp the README ([#27](https://github.com/utilia-ai-wox/memhook/issues/27)) ([ad1106a](https://github.com/utilia-ai-wox/memhook/commit/ad1106a3a0cea47ce75201a781fdf5eda80324b2))

## [0.2.2](https://github.com/utilia-ai-wox/memhook/compare/v0.2.1...v0.2.2) (2026-06-02)


### Bug Fixes

* **ci:** use npm install in publish job (repo ships no lockfile) ([#25](https://github.com/utilia-ai-wox/memhook/issues/25)) ([b12f873](https://github.com/utilia-ai-wox/memhook/commit/b12f873c2a83c9656134910a2971117687992f1e))

## [0.2.1](https://github.com/utilia-ai-wox/memhook/compare/v0.2.0...v0.2.1) (2026-06-02)


### Bug Fixes

* clean dist before build to avoid shipping stale artifacts ([#23](https://github.com/utilia-ai-wox/memhook/issues/23)) ([e34e7ad](https://github.com/utilia-ai-wox/memhook/commit/e34e7ad08688f7d687dd2e42ebe62b52bbbac660))

## [0.2.0](https://github.com/utilia-ai-wox/memhook/compare/v0.1.0-preview.0...v0.2.0) (2026-06-02)


### Features

* **providers:** add multi-provider support and optional YAML config ([97920e4](https://github.com/utilia-ai-wox/memhook/commit/97920e4dc5680dd403336b0a9c44a021fe193de3))
* **providers:** add OpenAI and Ollama providers + optional YAML config ([8bc5555](https://github.com/utilia-ai-wox/memhook/commit/8bc5555ad73130267984b0d18660a630fdb409d3))


### Bug Fixes

* **config:** clamp numeric knobs and widen boolean env vocabulary ([0ad7c6f](https://github.com/utilia-ai-wox/memhook/commit/0ad7c6f13ada7c33933fd8ef70fdf20d35e1f882))
* **config:** clamp numeric knobs and widen boolean env vocabulary ([ea386c0](https://github.com/utilia-ai-wox/memhook/commit/ea386c0247fc8746908635d0362cff3f01b34be2))
* point package exports at the compiled dist/src layout ([970ee71](https://github.com/utilia-ai-wox/memhook/commit/970ee711685baaaf63967afb8c5d696a9688486b))
* point package exports at the compiled dist/src layout ([57e1ff4](https://github.com/utilia-ai-wox/memhook/commit/57e1ff469e4eeb25cbca568f9a390cac690c759a))


### Documentation

* document v0.2 multi-provider and YAML config ([63e6d1b](https://github.com/utilia-ai-wox/memhook/commit/63e6d1b709f2f405b1f18c18958fe28979d57702))


### Chore

* graduate release line to clean 0.2.0 ([f0a07e5](https://github.com/utilia-ai-wox/memhook/commit/f0a07e51fe5792df4efd7af9d59452d97603b675))

## [0.1.0-preview.0](https://github.com/utilia-ai-wox/memhook/releases/tag/v0.1.0-preview.0) (2026-05-28)

Initial public preview: Anthropic Haiku provider, fail-soft pipeline, cap-A1
projection fix, JSONL observability log, catalog builder, local LRU cache,
trivial-prompt pre-filter, and the `memhook run | build-catalog | version`
CLI.
