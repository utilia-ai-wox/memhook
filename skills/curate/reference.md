# /curate — detection heuristics

Detailed reference for the `/curate` skill. Loaded on demand, so it can be as
long as it needs to be without costing context on every prompt.

## Semantic duplicate detection

Two memory files are candidate duplicates when **any** of these hold:

- **Title near-match** — normalise both H1 titles (lowercase, strip punctuation,
  collapse whitespace); a Levenshtein distance < 3 is a strong signal.
- **Same claim, different words** — both assert the same rule or fact (e.g. two
  files that both say "never force-push to main"). Read both bodies; if one is a
  strict superset of the other, the narrower one is redundant.
- **Same target** — both files govern the same file / command / workflow and
  give the same guidance.

When duplicates are found, propose a **merge** (not a blind delete):

1. Keep the file whose `description:` is the most precise router hint — or write
   a better combined `description:` than either had.
2. Fold any unique detail from the other file into the kept one.
3. Delete the redundant file and fix its `MEMORY.md` entry.

Do **not** auto-merge files that merely share a topic but make _different_
points — overlap is not duplication.

## Split criteria (files > ~200 lines)

A memory file should hold roughly one fact or one coherent topic. Split when:

- It exceeds ~200 lines, **and**
- It contains two or more independently-routable topics (each could be relevant
  to a different prompt on its own).

When splitting:

- Give each resulting file a **distinct, specific `description:`** — generic
  descriptions ("notes about the project") make routing useless.
- Trim the original to the remaining topic, or delete it if fully redistributed.
- Update `MEMORY.md`: one index line per resulting file.
- Rebuild the catalog afterwards.

Do **not** split a long-but-single-topic file just to hit a line count — a
coherent 250-line doctrine file is fine.

## Override conflicts

Two `feedback_*` files conflict when they give contradictory instructions for
the same situation (e.g. one says "always ask before committing", another says
"commit without asking").

- If one file **explicitly declares** it overrides the other (a line like
  "overrides feedback_X"), that is intentional — leave it.
- Otherwise, **flag it as unresolved** and surface both to the user. An override
  encodes human intent; never pick a winner automatically.

Present a conflict like this:

```markdown
### Unresolved conflict

- feedback_A.md: "<verbatim instruction>"
- feedback_B.md: "<verbatim contradicting instruction>"
  → Which wins? (or declare an explicit override in one of them)
```

## Stale-entry detection

A memory is a stale candidate when:

- It is a `project_*` memory referencing a **deadline or date that has passed**
  with no "resolved" / "done" marker, **or**
- It references a **file, function, route, or symbol that no longer exists** —
  prove this with a `Grep` across the relevant repo before proposing removal.

Always prefer **update over delete** when the underlying fact still matters but
the details drifted.

## Backup before destructive changes

Before a delete / merge / split, keep a local backup so a mistaken curation is
recoverable:

```bash
# Timestamped copy alongside the file, ignored by the catalog (not *.md in the
# memory dir root).
cp memory/feedback_x.md "/tmp/curate-backup-$(date +%Y%m%dT%H%M%S)-feedback_x.md"
```

State each backup path in the final report. These backups live outside the
memory directory, so `memhook build-catalog` never indexes them.

## Why the catalog rebuild is mandatory

`memhook build-catalog` regenerates the one-line-per-file catalog that the
router feeds to its model. If you delete or rename a memory and skip the
rebuild:

- the router may still pick a basename that no longer exists on disk (the
  router treats that as `all_unfound` and injects nothing), and
- a freshly-added memory stays invisible until the next rebuild.

So: any create / delete / merge / split → `memhook build-catalog` immediately,
and note it in the report.
