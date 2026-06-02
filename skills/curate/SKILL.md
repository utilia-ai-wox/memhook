---
name: curate
description: Audit and tidy your Claude Code memory directory so memhook routes against a clean catalog. Detects MEMORY.md index drift, unindexed files, semantic duplicates, conflicting overrides, stale entries, and oversized files; proposes merges, deletions, and splits. Proposes only — destructive changes need your approval. Invoke when you want to clean up, consolidate, or audit your memories, or say "/curate".
disable-model-invocation: true
allowed-tools: Read Glob Grep Edit Write Bash WebFetch
argument-hint: [current|all]
---

# /curate — memory hygiene

A companion skill for [memhook](https://github.com/utilia-ai-wox/memhook).
memhook only routes well when the memory directory is clean: one fact per file,
an accurate `MEMORY.md` index, a meaningful `description:` on every file, and no
duplicates. This skill keeps it that way.

## Objective

Keep the memory directory **minimal and coherent**: `MEMORY.md` reflects exactly
the files present, no semantic duplicates, no unresolved override conflicts,
oversized files split, stale entries removed — and the memhook catalog rebuilt
so routing matches reality.

## Scope

The `$ARGUMENTS` value selects the scope:

| Scope               | Directories                                  |
| ------------------- | -------------------------------------------- |
| `current` (default) | `~/.claude/projects/<cwd-sanitised>/memory/` |
| `all`               | every `~/.claude/projects/*/memory/`         |

If no argument is given, default to `current`.

## Facts to keep in mind

1. **`description:` frontmatter is load-bearing.** `memhook build-catalog` reads
   the one-line `description:` of each memory file into the catalog, and the
   router uses it to decide relevance. Any merge / rewrite **must preserve or
   improve** the `description:`, never strip it.
2. **`MEMORY.md` is maintained by hand**, not auto-generated — edits stay
   conservative.
3. **The first ~200 lines of `MEMORY.md`** load every session; anything beyond
   is read on demand. Keep it lean.
4. **Memory files over ~200 lines** should be split into focused topic files,
   each with its own distinct `description:`.
5. **The `journal/` subdirectory is out of scope.** `journal/YYYY-MM-DD.md`
   entries are session logs written by `/wrap`, not topic memories — never flag
   them as orphaned, stale, or unindexed.
6. **`feedback_` / `project_` / `rule_` prefixes and a `metadata.type`** are a
   convention, not a hard requirement — don't force them onto files that don't
   use them.

## Optional — refresh the official guidance

If the network is available, you may fetch the current Claude Code memory docs
to confirm size limits and best practices:

- `https://code.claude.com/docs/en/memory`

This is **optional and non-blocking**: if the fetch fails, proceed on the
conventions in this skill. Never abort the audit just because a doc fetch failed.

## Process (7 steps)

See [reference.md](reference.md) for the detection heuristics (duplicate
similarity, split criteria, override handling, backup template).

### 1. Inventory

```bash
# Exclude journal/ — those are session logs, not topic memories.
find <scope-dir> -maxdepth 1 -name '*.md' -type f
```

For each file: line count, bytes, frontmatter (`name`, `description`, `type`),
the H1 title, last-modified time. Read `MEMORY.md` in full and extract every
indexed entry (`- [Title](file.md)`).

### 2. Detect problems

Five classes (heuristics in [reference.md](reference.md)):

- **Index ↔ filesystem sync** — entry in `MEMORY.md` pointing at a missing file
  (orphan); a `*.md` file present but absent from `MEMORY.md` (unindexed).
- **Line budget** — `MEMORY.md` > 200 lines, or a memory file > 200 lines.
- **Semantic duplicates** — near-identical H1 titles, or two files saying the
  same thing in different words.
- **Override conflicts** — two `feedback_*` files that contradict each other with
  no explicit override declared. Flag as unresolved; ask the user.
- **Stale entries** — a `project_*` memory past its deadline with no "resolved"
  note, or a reference to a file / function that no longer exists (verify with
  Grep before proposing removal).

### 3. Plan

```markdown
## Curate plan for <scope>

### Delete — file.md (orphan)

### Add to index — other.md (present but unindexed, topic = X)

### Merge — a.md + b.md → a.md (semantic duplicate, ~85% overlap)

### Split (>200ln) — big.md → big-topic1.md + big-topic2.md

### Unresolved conflicts (need your decision)

- feedback_A.md vs feedback_B.md: contradiction on <subject>

### Leave as-is — <list>
```

### 4. Approval

Wait for the go-ahead. Apply non-conflicting changes once approved; **override
conflicts always require an explicit user decision** (an override encodes human
intent).

### 5. Apply

- **Delete**: remove the file (report each deletion).
- **Merge**: create the merged file, delete the sources. Keep the most precise
  `description:` (or write a better one — it drives routing, not just humans).
- **Split**: create topic files (each with its own distinct `description:`),
  trim the original, update `MEMORY.md`.
- **Index**: Edit `MEMORY.md`, preserving existing sections.
- **Rebuild the catalog after any destructive change** so the router stops
  pointing at deleted files (and picks up new ones):

  ```bash
  memhook build-catalog
  ```

  Log the rebuild in the final report.

### 6. Report

```markdown
# Curate report

**Scope**: <path> **Date**: <ISO>

## Before → After

- files: N → N' total lines: M → M' index entries: K → K'
- problems: O → 0 orphan, 0 unindexed

## Changes

<table>

## Unresolved conflicts (still open)

<list>
```

## Rules

- **Preserve `description:`** on every file — it is what memhook routes on.
- **Never touch `journal/`** — session logs, out of scope.
- **Always rebuild the catalog** (`memhook build-catalog`) after delete / merge /
  split / create.
- **Never delete a memory** without stating the reason (and keeping a backup —
  see [reference.md](reference.md)).
- **Never resolve an override conflict** without user validation.
- **Source every "stale" claim** with a Grep that proves the reference is dead.

## Anti-patterns

- Stripping a `description:` (breaks memhook routing silently).
- Flagging `journal/` files as orphaned or stale.
- Forgetting the catalog rebuild — leaves the router pointing at deleted files.
- Forcing a frontmatter convention onto files that never used it.
- Resolving a contradiction the user explicitly declared as an override.

## Related skills

- `/wrap` — end-of-session capture; run `/curate` periodically to tidy what it
  accumulates.
- `/relay` — generate a handoff prompt for a fresh session.
