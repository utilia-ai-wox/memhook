/**
 * Harness adapter contract.
 *
 * memhook's selection pipeline is harness-agnostic: it consumes a normalised
 * `{prompt, cwd}` and produces a `RouteResult`. The ONLY harness-specific
 * surface is (a) parsing the host's hook stdin into that normalised input and
 * (b) serialising the result into the host's stdout envelope. A `HarnessAdapter`
 * captures exactly those two ends, so a new host (Codex, Gemini, …) is an
 * adapter, not a fork of the router.
 *
 * See docs/SPECIFICATION.md §5 (architecture) and §10 (hook contract).
 */

/** Normalised hook input. Every adapter maps its host's stdin to this shape. */
export interface HarnessInput {
  /** The verbatim user prompt. */
  prompt: string;
  /** The project working directory, when the host provides one. */
  cwd?: string;
}

/**
 * Harness-agnostic outcome of one routing pass. Adapters serialise this into
 * their host's stdout envelope.
 */
export interface RouteResult {
  /** Context to inject ahead of the user prompt. Empty string = inject nothing. */
  additionalContext: string;
  /**
   * Optional one-line notice to the user (the `/curate` nudge). Absent on every
   * normal turn, so a host whose envelope has no equivalent simply ignores it.
   */
  systemMessage?: string;
}

/**
 * The host-specific surface of the hook. `parseInput` reads the host's stdin
 * JSON into a `HarnessInput` (or `null` when it isn't a usable hook input);
 * `formatOutput` serialises a `RouteResult` into the host's stdout shape.
 */
export interface HarnessAdapter<TOutput = unknown> {
  /** Stable identifier, e.g. `"claude-code"`. */
  readonly id: string;
  /** Parse the host's hook stdin JSON into `{prompt, cwd}`, or `null` if unusable. */
  parseInput(stdinJson: string): HarnessInput | null;
  /** Serialise a routing result into the host's stdout envelope. */
  formatOutput(result: RouteResult): TOutput;
}
