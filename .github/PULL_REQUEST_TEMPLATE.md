<!--
  Thank you for contributing to memhook.

  PR title MUST follow Conventional Commits (enforced on squash-merge):
    feat(scope): subject     — minor bump
    fix(scope): subject      — patch bump
    chore(scope): subject    — no release
    feat!: subject           — major bump (or "BREAKING CHANGE:" in body)

  If the PR bundle contains any feat(), the PR title MUST be feat() so
  release-please picks it up. See CONTRIBUTING.md.
-->

## Summary

<!-- One or two sentences. What changes, why now? -->

## Changes

<!-- Bullet list. Focus on the WHY behind each change. -->

-
-

## Test plan

<!-- How did you verify this works? Mark non-applicable items "n/a". -->

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes (X/X)
- [ ] `npm run build` succeeds
- [ ] If the hook contract changed: `/smoke` was run against a sandbox
- [ ] If `src/router.ts` or `src/providers/*` changed: the `failsoft-auditor` agent found zero violations
- [ ] CHANGELOG impact — release-please will pick this up via Conventional Commits

## Breaking changes

<!-- If applicable, describe what users have to do. Otherwise leave empty. -->

## Related issues

<!-- Closes #N, Refs #M -->
