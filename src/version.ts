/**
 * Single source of truth for memhook's version string.
 *
 * Imported by `src/config.ts` (as the cache-key `scriptVersion` token) and
 * `bin/memhook.ts` (as the `version` / `--help` banner) so the two no longer
 * drift apart. `package.json` version + `.release-please-manifest.json` are
 * owned by release-please; bump this constant in the same release commit when
 * cutting a tagged version.
 */
export const MEMHOOK_VERSION = "0.2.0-preview.0";
