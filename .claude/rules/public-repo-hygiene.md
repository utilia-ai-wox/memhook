# Public repo hygiene — everything you write here is world-visible

> memhook is a **public** open-source repository. Treat every artifact you
> create — code, code comments, docs, **commit messages, PR titles, PR
> descriptions**, issues, and review comments — as permanently world-readable.
> Anyone, including authors of peer projects, can read it.

## Why this matters extra here

The repo squash-merges with `squash_merge_commit_message = PR_BODY` (GitHub
repo setting). So a **PR description becomes the squash commit message on
`main`** — doubly permanent and public. A throwaway PR body is not throwaway.

## The rule

Public artifacts (commits, PR titles/bodies, issues, comments) stay **factual
and professional**: _what_ changed, _why_, and _how it was verified_. Nothing
else.

## NEVER in a public artifact

- **Name or analyse peer / competitor projects.** No "benchmarked against X /
  Y / Z", no "X does this so we copied it", no comparison framing that singles
  out other repos.
- **Expose strategy or positioning intent** — "discoverability", "SEO",
  "growth", "marketing", "make it cool/attractive", "adoption tactics",
  listing-submission plans, etc. The _result_ (a clear README, good docs) is
  public; the _intent/strategy_ behind it is not.
- **Reveal anything you would not want a competitor or a stranger to read** —
  internal trade-offs, embarrassing incidents, half-formed plans.

## Where the strategy reasoning lives instead

Competitive comparisons, discoverability/positioning tactics, awesome-list
submission plans, benchmark notes — keep them in the conversation with the
maintainer, or in the **gitignored** zones (`.claude/private/`,
`docs/private/`). **Never** in a committed file or a public PR/commit/issue.

## README & docs content

A crisp value proposition, a Features list, and a star CTA are good and
expected. Competitor-bashing, "inspired by X's README", or visible marketing
copy are not — let the tool speak for itself.

## How to apply (before `gh pr create` / `gh pr edit` / any commit)

Re-read the title and body as if a competitor or a stranger will read it —
because they will. If a sentence reveals strategy, names a peer project, or
reads as marketing, cut it. Keep only the factual changelog of what changed
and why.
