---
name: wrap
description: End-of-session wrap-up for Claude Code. Detects what changed during the session (git commits, working-tree edits, new/edited memory & rule files) and proposes structured updates to your memory directory, MEMORY.md index, and a dated journal entry. Proposes only — never writes without your approval. Invoke at the end of a work session, when you say "wrap up", "end session", or "/wrap".
disable-model-invocation: true
allowed-tools: Read Glob Grep Bash Edit Write
argument-hint: [optional one-line note about the session]
---

# /wrap — end-of-session wrap-up

A companion skill for [memhook](https://github.com/utilia-ai-wox/memhook).
memhook routes your `feedback_*.md` / `project_*.md` / `rule_*.md` files into
each prompt; this skill keeps that memory current. Run it at the end of a
session so the lessons of the session are captured before the context is gone.

## Objective

Close the session loop: collect what changed (commits, working-tree edits,
detected lessons), propose a set of structured updates to **your memory
system** (memory files, `MEMORY.md` index, a dated journal entry), and let
**you** approve each one before anything is written.

## Cardinal constraint — nothing is written without approval

**No file is modified before explicit user approval.** The skill produces a
report and a plan; you approve, reject, or amend each proposal. It is
idempotent: running it again after a session is already wrapped should produce
an empty or minimal report.

## Scope

This skill touches **memory + doctrine + journal** only. It never edits your
application code (`src/`, `apps/`, `packages/`, tests).

| Category      | Path                                           | What to detect                                              |
| ------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Memory        | `~/.claude/projects/<project>/memory/*.md`     | New lessons to capture; `MEMORY.md` index drift             |
| Global rules  | `~/.claude/rules/*.md`                         | A rule edited this session; an anti-pattern worth recording |
| Project rules | `<repo>/.claude/rules/*.md`                    | Same, scoped to the current repo                            |
| Journal       | `~/.claude/projects/<project>/memory/journal/` | Today's journal entry missing after a real session          |
| Skills        | `~/.claude/skills/*/SKILL.md`                  | A repeated pattern worth formalising into a skill           |

The `<project>` directory is the sanitised form of the current working
directory used by Claude Code (e.g. `/Users/me/dev/app` →
`-Users-me-dev-app`). When unsure, glob `~/.claude/projects/*/memory/` and pick
the one matching the cwd.

## Workflow

### Phase 1 — capture session state

1. **Estimate session start.** Heuristic: the oldest mtime among files touched
   under `.claude/` this session, or fall back to the last few hours.

2. **List commits made during the session** in the current repo:

   ```bash
   git -C "$(pwd)" log --since="<session_start>" --oneline
   ```

3. **List changed / created files:**
   - `git -C "$(pwd)" status --short` (uncommitted)
   - `git -C "$(pwd)" log --name-only --since="<session_start>"` (committed)
   - `find ~/.claude/rules ~/.claude/skills -newer <marker>` (global doctrine)
   - `find ~/.claude/projects/<project>/memory -maxdepth 1 -name '*.md' -newer <marker>` (memory)

4. **Cross-reference each change** to a cause: which decision motivated a rule
   edit? Which lesson does a new memory capture? A correction repeated 3+ times
   is a candidate anti-pattern worth formalising.

### Phase 2 — detect weak signals

For each category, ask what _should_ be recorded but isn't:

| Signal                                                     | Proposed action                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- |
| A technical decision made in conversation with no trace    | Propose a `project_*.md` memory                                        |
| A user preference expressed ("stop doing X") with no trace | Propose a `feedback_*.md` memory                                       |
| A correction repeated 3+ times                             | Propose an anti-pattern note in the relevant rule                      |
| A rule mentions something the code no longer contains      | Propose trimming the stale mention (verify with Grep first)            |
| Today's journal entry missing after a real session         | Propose `journal/YYYY-MM-DD.md` (Decided / Learned / Blocked, ≤ 50 ln) |

### Phase 3 — structured report

Present a single report:

````markdown
## Session wrap — YYYY-MM-DD HH:MM (duration ~Xh)

### Activity

- Commits: N in <repo>
- System files touched: P rules, Q memory, R skills
- Note: "<optional argument>"

### Signals detected (N proposals)

1. **[CATEGORY]** what was detected
   - Source: <file:line or commit hash>
   - Action: create / edit / delete
   - Target: <path>
   - Diff:
     ```diff
     - <old>
     + <new>
     ```

### Approval

- "ok 1, 2, 5" → apply 1, 2, 5
- "ok all" → apply everything
- "skip 3" → leave it out
- "change X…" → adjust before applying
````

### Phase 4 — apply approved changes

For each approved proposal:

- Read the target (when editing), then Edit / Write the exact approved diff.
- A new memory file **must keep a one-line `description:` in its frontmatter**
  — memhook's catalog and router read that line to decide relevance, so an
  empty or missing description makes the memory invisible to routing.
- A journal entry uses three fixed sections (Decided / Learned / Blocked),
  capped at ~50 lines.
- **After any memory create / edit / delete, rebuild the catalog** so memhook
  routes against the new state:

  ```bash
  memhook build-catalog
  ```

- Add the new memory to the `MEMORY.md` index (one line: `- [Title](file.md)`).
- **Never commit automatically** — the user keeps control of the git message and scope.

### Phase 5 — recap

```markdown
## Applied

- ✅ memory/feedback_x.md created (+ MEMORY.md index + catalog rebuilt)
- ✅ ~/.claude/rules/y.md: stale mention removed
- ✅ journal/2026-06-02.md created

## To commit (your call)

git add … && git commit -m "…"
```

## Rules

- **Explicit approval required** — `/wrap` writes nothing without confirmation.
- **Idempotent** — re-running after a wrapped session yields an empty report.
- **Cap the report at ~200 lines** — if there are > 10 proposals, batch and
  prioritise (high / medium / low).
- **Source every signal** on a real `file:line` or commit hash — never invent one.
- **Preserve `description:`** on every memory file (load-bearing for memhook).
- **Rebuild the catalog** (`memhook build-catalog`) after memory changes.
- **No automatic commits** — leave the final git decision to the user.

## Anti-patterns

- Writing to the memory system without approval.
- Proposing 30 trivial edits instead of a prioritised handful.
- Inventing a signal with no verifiable source.
- Editing application code (out of scope).
- Forgetting the catalog rebuild after deleting or merging a memory.

## Related skills

- `/curate` — periodic memory hygiene (dedupe, stale, index sync). Chains well
  after `/wrap`.
- `/relay` — generate a handoff prompt to continue in a fresh session.
