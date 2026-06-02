/**
 * Shared HTTP transport for providers — one audited network path.
 *
 * Every provider POSTs JSON and wants the same behaviour: an AbortController
 * timeout, a single retry on a transient failure (network error or a
 * retryable status), latency measurement, and a tolerant JSON parse that
 * never throws on a malformed body. Centralising it keeps the fail-soft
 * contract verifiable in one place (failsoft-auditor rules 4 + 7) instead of
 * being re-implemented per adapter.
 *
 * Semantics (identical to memhook v0.1's Anthropic path):
 *   - max 2 attempts.
 *   - attempt 1 throws (network error) -> backoff, retry.
 *   - attempt 1 returns a retryable status -> backoff, retry.
 *   - attempt 2 throws -> rethrow (caller's try/catch -> fail-soft).
 *   - otherwise return the parsed body (or null if the body wasn't JSON).
 */

export interface PostJsonOptions {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  /** HTTP statuses worth a single retry (e.g. 429, 503). */
  retryStatuses: readonly number[];
  backoffMs: number;
}

export interface RawHttpResult {
  /** Parsed JSON body, or null when the body was absent/not valid JSON. */
  json: Record<string, unknown> | null;
  httpStatus: number;
  latencyMs: number;
}

export async function postJsonWithRetry(opts: PostJsonOptions): Promise<RawHttpResult> {
  let last: RawHttpResult | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(opts.url, {
        method: "POST",
        headers: opts.headers,
        body: opts.body,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (attempt === 1) {
        await sleep(opts.backoffMs);
        continue;
      }
      throw err;
    }
    clearTimeout(timer);
    const latencyMs = Date.now() - started;
    const status = resp.status;

    if (attempt === 1 && opts.retryStatuses.includes(status)) {
      await sleep(opts.backoffMs);
      continue;
    }

    const json = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
    last = { json, httpStatus: status, latencyMs };
    break;
  }
  if (!last) {
    throw new Error("postJsonWithRetry: no response after retries");
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
