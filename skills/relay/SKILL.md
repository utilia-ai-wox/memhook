---
name: relay
description: Generate a self-contained prompt to resume your work in a fresh Claude Code session. Anchors every fact on real state (current branch, commits since session start, uncommitted files, open PRs, today's journal). Read-only — writes nothing; the output is a copy-paste block. Invoke when the context is saturated but work continues, or say "/relay". Pairs with /wrap.
disable-model-invocation: true
allowed-tools: Read Glob Grep Bash
argument-hint: [optional note — a topic or next step to prioritise]
---

# /relay — handoff to a fresh session

A companion skill for [memhook](https://github.com/utilia-ai-wox/memhook). When
the current session's context fills up but the work isn't finished, `/relay`
produces a **ready-to-paste prompt** so a new Claude Code session can pick up
exactly where this one stopped — without access to this session's history.

Typical flow:

```
1. Current session: work in progress, context filling up
2. /wrap   → capture lessons into memory + journal
3. /relay  → generate a prompt to resume in a fresh session
4. Paste the block into a new Claude Code session
```

If the session is genuinely finished (nothing to resume), `/wrap` alone is
enough — `/relay` is for when work remains but this context must be abandoned.

## Cardinal constraint — writes nothing

**`/relay` never writes to disk.** Its only output is a text block shown to you.
No Edit, no Write. Idempotent by construction: re-run it any time and it
reflects the state at that moment.

## Scope — read-only, every fact sourced

Each fact in the generated prompt must be anchored on a real source:

| Source            | Tool                                                          | What to capture                     |
| ----------------- | ------------------------------------------------------------- | ----------------------------------- |
| Current branch    | `git -C "$(pwd)" branch --show-current`                       | Branch name                         |
| Session commits   | `git -C "$(pwd)" log --since=<start> --oneline`               | Verbatim — not paraphrased          |
| Uncommitted files | `git -C "$(pwd)" status --short`                              | Exact list                          |
| Work-in-progress  | `git -C "$(pwd)" stash list`                                  | Any stashed WIP                     |
| Today's journal   | `~/.claude/projects/<project>/memory/journal/YYYY-MM-DD.md`   | Decided / Learned / Blocked         |
| Open PRs          | `gh pr list --author @me --state open` (if `gh` is available) | URLs + titles + CI state            |
| User note         | the `$ARGUMENTS` hint                                         | Explicit priority for the next step |

Out of scope: reading application code in depth — the resuming session
re-explores that itself. Never infer a fact you can't source.

## Workflow

### Phase 1 — capture state

```bash
cd "$(pwd)"
git branch --show-current
git status --short
git log --since="<session_start>" --oneline   # session_start: oldest .claude/ mtime, else last few hours
git stash list
```

If `gh` is installed and authenticated, also capture open PRs and their CI
state. If it isn't, omit that section rather than guessing.

### Phase 2 — infer the next step

In priority order:

| Signal                                      | Inferred next step                                            |
| ------------------------------------------- | ------------------------------------------------------------- |
| `$ARGUMENTS` note provided                  | The user's note wins — put it at the top of "next step"       |
| Uncommitted changes on a feature/fix branch | Finish the in-progress commit (cite the files)                |
| Open PR with failing CI                     | Investigate the failure (cite the run URL + failing step)     |
| Open PR awaiting review                     | Wait / respond to review comments                             |
| Today's journal says "Blocked: X"           | Unblock X first                                               |
| Nothing clear                               | "Audit the state and decide direction" — honest, not invented |

### Phase 3 — write the prompt

Output format (the final block is the copy-paste payload):

````markdown
## Resume prompt — generated <ISO date>

Source: /relay from <repo> on branch `<branch>`

---

```
You are resuming a work session interrupted at <ISO date>.
The previous session was wrapped (memory + journal are up to date).
This context is fresh — re-load whatever you need with your tools.

## Where things stand (verbatim at handoff)

Repo:   <path>
Branch: <branch>
Open PR(s): <urls or "none">

### git status
<verbatim `git status --short`>

### Recent commits this session
<verbatim `git log --oneline`, de-duplicated>

### Today's journal
<Decided / Learned / Blocked, if the entry exists>

## What's left to do
<inferred next step — cite the source: "3 uncommitted files on branch X",
 or "PR #N CI failing at step Y", or the user's note>

### First concrete action
<an exact command or a precise instruction — e.g. `/wrap`, or
 `gh run view <id> --log-failed`, or "finish the commit for <files>">

## User note (explicit priority)
<the $ARGUMENTS note, verbatim — omit this section if none was given>
```

---

Copy the block between the `---` markers into a new Claude Code session.
If anything is missing or wrong, tell me and I'll regenerate.
````

### Phase 4 — self-check before showing

Re-read the generated prompt:

1. Does **every** factual line have a verbatim source? If not → re-capture.
2. Is it truly **self-contained**? The new session must resume with only its
   tools + this prompt.
3. Is the "first concrete action" **unambiguous**? If it's a placeholder, say so
   and ask the user to specify.
4. Are there **no implicit references** to this session ("as we saw", "the bug
   from earlier")?

If any check fails, rewrite — don't show it.

## Rules

- **Writes nothing** — output is a text block only.
- **Source every fact verbatim** — no paraphrase, no invention.
- **Cap output at ~200 lines** — if it's longer, the work should be split across
  two sessions.
- **The `$ARGUMENTS` note wins** over inference for the next step.
- **No git or `gh` mutations** — strictly read-only.

## Anti-patterns

- Inventing a branch, PR, or task to look complete.
- Paraphrasing a commit message instead of quoting it.
- Implicit references the new session can't resolve ("you know what we were doing").
- A vague next action ("continue the work") with no command or scope.
- Writing to any file (this skill is output-only).

## Related skills

- `/wrap` — run it **before** `/relay` to capture the session's lessons.
- `/curate` — periodic memory hygiene.
