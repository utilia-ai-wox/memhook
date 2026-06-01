// Flat config — eslint 9+ with typescript-eslint v8+.
// https://typescript-eslint.io/getting-started

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      ".vitest-cache/**",
      "**/*.d.ts",
      ".claude/private/**",
      "docs/private/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // Allow unused args when they start with _ (interface conformance pattern)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Fail-soft: empty catch blocks are a legitimate pattern for hook
      // best-effort cleanup. Require a comment though, enforced via lint.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Tests often need to assert on values that the type system thinks
      // can't be null; allow ! in tests only.
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
