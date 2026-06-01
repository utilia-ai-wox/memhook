// Commit message linting for Conventional Commits.
// Enforced via .husky/commit-msg hook.

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Header
    "header-max-length": [2, "always", 100],
    // subject-case disabled so proper nouns (OpenAI, Haiku, ESM) and
    // acronyms can be used naturally in commit subjects. Conventional
    // Commits spec only requires the type to be lowercase.
    "subject-case": [0],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],

    // Type
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "perf",
        "refactor",
        "chore",
        "docs",
        "style",
        "test",
        "build",
        "ci",
        "revert",
      ],
    ],
    "type-empty": [2, "never"],
    "type-case": [2, "always", "lower-case"],

    // Scope — optional, but if present must match memhook scopes
    "scope-enum": [
      2,
      "always",
      [
        "router",
        "catalog",
        "cache",
        "prefilter",
        "providers",
        "bin",
        "config",
        "hooks",
        "deps",
        "ci",
        "docs",
        "tests",
        "release",
        ".claude",
        "spec",
      ],
    ],
    "scope-case": [2, "always", "lower-case"],

    // Body
    "body-leading-blank": [2, "always"],
    "body-max-line-length": [2, "always", 100],

    // Footer
    "footer-leading-blank": [2, "always"],
    "footer-max-line-length": [2, "always", 100],
  },
};
