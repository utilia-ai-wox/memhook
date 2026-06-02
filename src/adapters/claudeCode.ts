/**
 * Claude Code adapter — memhook's first and reference harness adapter.
 *
 * Input  (stdin): the `UserPromptSubmit` hook JSON; only `prompt` + `cwd` are
 *   used (docs/SPECIFICATION.md §10.1).
 * Output (stdout): `{ hookSpecificOutput: { hookEventName: "UserPromptSubmit",
 *   additionalContext }, systemMessage? }` (§10.2). `systemMessage` is emitted
 *   only when the result carries one (the `/curate` nudge); absent otherwise, so
 *   the serialised shape is byte-identical to memhook's pre-adapter output.
 *
 * Contract source: https://code.claude.com/docs/en/hooks (mirrored in §10).
 */

import type { HookInput, HookOutput } from "../router.js";
import type { HarnessAdapter, HarnessInput, RouteResult } from "./types.js";

export const claudeCodeAdapter: HarnessAdapter<HookOutput> = {
  id: "claude-code",

  parseInput(stdinJson: string): HarnessInput | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdinJson);
    } catch {
      return null;
    }
    // Guard against non-object payloads (`"null"`, a bare number/string): they
    // are not usable hook inputs. This keeps `route()` from throwing on them —
    // a strict tightening of fail-soft, with the same empty output as before.
    if (typeof parsed !== "object" || parsed === null) return null;
    const obj = parsed as Partial<HookInput>;
    if (typeof obj.prompt !== "string") return null;
    const input: HarnessInput = { prompt: obj.prompt };
    // exactOptionalPropertyTypes: only set cwd when the host actually sent one.
    if (typeof obj.cwd === "string") input.cwd = obj.cwd;
    return input;
  },

  formatOutput(result: RouteResult): HookOutput {
    const output: HookOutput = {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: result.additionalContext,
      },
    };
    if (result.systemMessage !== undefined) {
      output.systemMessage = result.systemMessage;
    }
    return output;
  },
};
