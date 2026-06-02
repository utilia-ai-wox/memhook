# Security Policy

## Supported versions

memhook is in `0.x` (pre-1.0). Only the latest minor version receives
security fixes. Once memhook reaches `1.0.0`, this policy will be
updated to clarify the support window for previous minors.

| Version | Supported               |
| ------- | ----------------------- |
| `0.4.x` | ✅ active               |
| older   | ❌ no longer maintained |

## Reporting a vulnerability

**Please do NOT open a public GitHub issue for security reports.**

If you believe you've found a security vulnerability in memhook:

1. Use GitHub's **Private vulnerability reporting** for this repository:
   https://github.com/utilia-ai-wox/memhook/security/advisories/new
2. Alternatively, email the maintainer at the address listed in the
   `author` field of [`package.json`](package.json).

We'll acknowledge your report within **72 hours** and aim to provide
a more detailed response within **7 days**, including an assessment
and an estimated timeline for a fix.

## What we treat as a vulnerability

memhook's threat surface is intentionally narrow. Issues we treat as
security-sensitive include:

- **Hook contract violations** that let a hook crash, hang, or
  exfiltrate data the user did not authorise.
- **Path traversal** in catalog or memory file reading.
- **Prompt injection** vectors that could trick the router into
  reading files outside the configured directories.
- **Supply-chain risks** in the package's published artifacts
  (post-install scripts, unexpected transitive deps, etc.).
- **Cache poisoning** that could trick the router into serving
  attacker-controlled `additionalContext`.

## What we will not treat as a vulnerability

- The Anthropic API call is **always** opt-in via the user's own
  `ANTHROPIC_API_KEY`. Calls to `api.anthropic.com` are by design and
  not a phone-home.
- Local `~/.claude/logs/memhook.log` writes are by design and contain
  only metadata + an 80-character prompt preview. If you want stricter
  redaction, configure `MEMHOOK_LOG_PATH` to `/dev/null`.
- `memhook init` / `memhook uninstall` modify `~/.claude/settings.json` only
  on explicit invocation. They back the file up first, never alter unrelated
  hooks or keys, and refuse to overwrite a file that isn't valid JSON.
- `memhook skills install` / `uninstall` write only the bundled companion
  skills under `~/.claude/skills/<name>/`, only on explicit invocation. They
  never overwrite a skill you have edited without `--force` (and back it up
  first), and only remove the files memhook ships.
- Behaviour observed only when the user has explicitly disabled the
  fail-soft path (e.g. forced `set -e` in a custom hook wrapper).

## Coordinated disclosure

For severe issues, we follow a 90-day coordinated disclosure window:
the issue stays embargoed until a fix is available, then we publish
a security advisory with credit to the reporter (unless they request
otherwise).

Thank you for taking the time to make memhook safer.
