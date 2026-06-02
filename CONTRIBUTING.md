# Contributing to memhook

memhook is an early-stage tool (v0.1 preview). Contributions are welcome,
but please open an issue first to discuss substantial changes.

By participating you agree to abide by our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Development setup

```bash
git clone https://github.com/utilia-ai-wox/memhook.git
cd memhook
npm install          # also runs `husky` via the `prepare` script
npm run typecheck
npm run lint
npm test
npm run build
```

The package targets **Node 18+** and is published as ESM only. CI tests
**Linux + macOS + Windows × Node 18 / 20 / 22** on GitHub-hosted runners.

## Branch naming

| Prefix      | Purpose                                   |
| ----------- | ----------------------------------------- |
| `feature/`  | new capability or API                     |
| `fix/`      | bug fix                                   |
| `perf/`     | performance improvement, no API change    |
| `refactor/` | internal restructure, no behaviour change |
| `chore/`    | maintenance, deps, tooling                |
| `docs/`     | documentation only                        |
| `ci/`       | CI / build pipeline only                  |

Slugs are short, kebab-case, lowercase. Example: `feature/openai-provider`.

Direct commits to `main` are blocked by branch protection and by the
local `git-workflow-guard` hook. Always work on a branch and open a PR.

## Commit messages — Conventional Commits

All commits MUST follow [Conventional Commits 1.0](https://www.conventionalcommits.org/).
Format is enforced locally by `commitlint` (via the `commit-msg` Husky hook)
and remotely on PR titles (because we squash-merge).

```
type(scope): subject

Optional body. Wrap at 100 chars per line.

BREAKING CHANGE: description (if applicable)
Co-Authored-By: Name <email@example.org>
```

### Allowed types

| Type       | Meaning                               | Release impact   |
| ---------- | ------------------------------------- | ---------------- |
| `feat`     | new feature                           | minor            |
| `fix`      | bug fix                               | patch            |
| `perf`     | performance improvement               | patch            |
| `refactor` | restructure without behaviour change  | none             |
| `chore`    | maintenance, deps, tooling            | none             |
| `docs`     | documentation only                    | none             |
| `style`    | formatting only                       | none             |
| `test`     | tests only                            | none             |
| `build`    | build system or external dependencies | none             |
| `ci`       | CI configuration                      | none             |
| `revert`   | revert a previous commit              | matches reverted |

`feat!:` or a `BREAKING CHANGE:` footer triggers a **major** bump.

### Allowed scopes

`router`, `catalog`, `cache`, `prefilter`, `providers`, `bin`, `config`,
`hooks`, `deps`, `ci`, `docs`, `tests`, `release`, `.claude`, `spec`.

Scope is optional. If used, it must come from the list above (enforced
by `commitlint.config.js`).

### Subject rules

- Lowercase only.
- No trailing period.
- ≤ 72 characters.
- Imperative mood: "add" not "added" or "adds".

## Pull request workflow

1. Branch from `main`, push, open the PR.
2. **PR title** must be Conventional Commits format. If the bundle contains
   any `feat()`, the PR title MUST be `feat(...)` — release-please reads
   the squash-commit (= PR title) and would otherwise skip the release.
3. Fill in the [pull request template](.github/PULL_REQUEST_TEMPLATE.md).
4. Wait for CI to pass on Linux + macOS + Windows × Node 18/20/22.
5. **Squash-merge** when approved. No "merge commit" or "rebase" options.

## Code style

- **Strict TypeScript**: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes` are all enabled in `tsconfig.json`.
- **ESM only**: `import`/`export`. Relative imports use the `.js`
  extension (TypeScript resolves the `.ts` file at compile time).
- **No silent catch**: every `catch` must either log to stderr, set a
  status, or rethrow. Empty `catch {}` blocks must include a comment
  justifying why silence is correct (only allowed for fail-soft cleanup).
- **Hook fail-soft contract**: the router and CLI must never crash,
  hang, exit non-zero, or pollute stdout. Every error path falls back
  to an empty `additionalContext`. The `failsoft-auditor` agent
  (`.claude/agents/failsoft-auditor.md`) checks for violations.
- **No telemetry**: the only outbound calls are to the user's configured LLM
  provider — `api.anthropic.com` by default, or `api.openai.com` / a local
  Ollama (`localhost:11434`) when explicitly selected — using the user's own
  key. No analytics, no phone-home. Any new outbound call must be opt-in by
  config and documented in the README.
- **Lint + format on save** via `lint-staged` (configured in `package.json`,
  triggered by the Husky `pre-commit` hook on every commit).

## CI / CD

- Workflows live in `.github/workflows/`:
  - `ci.yml` — lint + format + typecheck + test + build on every push to
    `main`, `feature/**`, `fix/**`, and every PR to `main`.
  - `release-please.yml` — opens an automatic release PR when releasable
    commits land on `main`.
  - `codeql.yml` — weekly security scan + on every push/PR.
- Runners are **GitHub-hosted** (Linux + macOS + Windows) — free for this
  public repository.
- Concurrency cancels the previous CI run when a new push lands on a PR.

## Release process

memhook uses [release-please](https://github.com/googleapis/release-please)
in **manifest mode**, configured in `release-please-config.json`.

1. When commits matching `feat()` or `fix()` land on `main`, a bot opens a
   release PR titled `chore(main): release X.Y.Z`.
2. The release PR updates `package.json` version, regenerates `CHANGELOG.md`,
   bumps `.release-please-manifest.json`, and (via `extra-files`) rewrites the
   `MEMHOOK_VERSION` constant in `src/version.ts` so the runtime version never
   drifts from the published one.
3. Merging the release PR creates a tag `vX.Y.Z` and a GitHub Release with the
   changelog notes.
4. `npm publish` is **not** automated yet. Until then, maintainers publish
   manually with `npm publish`.

### Versioning policy (SemVer)

memhook follows [SemVer 2.0.0](https://semver.org). While in `0.x` the public
API is not yet stable ([SemVer §4](https://semver.org/#spec-item-4)), so the
bump mapping (driven by [Conventional Commits](https://www.conventionalcommits.org)
via `bump-minor-pre-major`) is:

| Commit                        | Bump in `0.x` | Example         |
| ----------------------------- | ------------- | --------------- |
| `fix:` / `perf:`              | patch         | `0.2.0 → 0.2.1` |
| `feat:`                       | **minor**     | `0.1.0 → 0.2.0` |
| `feat!:` / `BREAKING CHANGE:` | minor         | `0.2.0 → 0.3.0` |

There are **no pre-release suffixes** — `0.x` already signals an unstable API,
so a feature is simply the next minor (`0.2.0`, `0.3.0`, …). We cut `1.0.0`
manually when we commit to API stability, after which `feat!:` bumps major.

## What we will not merge

- Features that introduce a hard runtime dependency on a specific Claude
  Code version (the hook contract should stay loose).
- Changes that ship secrets, API keys, or paths specific to a single user.
- "Cleanups" that touch unrelated files in the same PR.
- Telemetry, analytics, phone-home behaviour.
- PRs that bypass the fail-soft contract for "convenience".

## Security

For security issues, see [SECURITY.md](SECURITY.md). Please do **not**
open a public GitHub issue; use the private advisory channel instead.

## License

By contributing you agree your contributions are licensed under the MIT
License (see [LICENSE](LICENSE)).
