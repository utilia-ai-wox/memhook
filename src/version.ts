/**
 * Single source of truth for memhook's version string at runtime.
 *
 * Imported by `src/config.ts` (the cache-key `scriptVersion` token) and
 * `bin/memhook.ts` (the `version` / `--help` banner). This constant reflects
 * the LAST RELEASED version and is bumped automatically by release-please: it
 * is listed in `release-please-config.json` `extra-files`, and the
 * `x-release-please-version` annotation below tells release-please to rewrite
 * the literal in lockstep with `package.json` + `.release-please-manifest.json`.
 * Do not bump it by hand.
 */
export const MEMHOOK_VERSION = "0.4.1"; // x-release-please-version
