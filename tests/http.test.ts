import { describe, it, expect, vi, afterEach } from "vitest";
import { postJsonWithRetry } from "../src/providers/http.js";

type FetchArgs = Parameters<typeof fetch>;

function stubFetch(impl: (...args: FetchArgs) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OPTS = {
  url: "https://example.test/api",
  headers: { "content-type": "application/json" },
  body: "{}",
  timeoutMs: 1000,
  retryStatuses: [429, 503] as const,
  backoffMs: 1,
};

describe("postJsonWithRetry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses a JSON body and reports status + latency", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ ok: true }, 200)));
    const res = await postJsonWithRetry({ ...OPTS });
    expect(res.json).toEqual({ ok: true });
    expect(res.httpStatus).toBe(200);
    expect(typeof res.latencyMs).toBe("number");
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("retries once on a retryable status, then returns the second response without retrying again", async () => {
    let n = 0;
    const spy = stubFetch(() => {
      n += 1;
      // Both attempts return a retryable status; attempt 2 is NOT retried again.
      return Promise.resolve(jsonResponse({ attempt: n }, 503));
    });
    const res = await postJsonWithRetry({ ...OPTS });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.httpStatus).toBe(503);
    expect(res.json).toEqual({ attempt: 2 });
  });

  it("retries once on a network error, then succeeds", async () => {
    let n = 0;
    const spy = stubFetch(() => {
      n += 1;
      if (n === 1) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    const res = await postJsonWithRetry({ ...OPTS });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.json).toEqual({ ok: true });
  });

  it("rethrows when both attempts throw (caller's catch -> fail-soft)", async () => {
    const spy = stubFetch(() => Promise.reject(new Error("down")));
    await expect(postJsonWithRetry({ ...OPTS })).rejects.toThrow("down");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("resolves json to null when the body is not JSON", async () => {
    stubFetch(() =>
      Promise.resolve(
        new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
      ),
    );
    const res = await postJsonWithRetry({ ...OPTS });
    expect(res.json).toBeNull();
    expect(res.httpStatus).toBe(200);
  });

  it("aborts on timeout and rethrows after exhausting both attempts", async () => {
    // A fetch that never resolves on its own but rejects when the AbortController fires.
    const spy = stubFetch((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });
    await expect(postJsonWithRetry({ ...OPTS, timeoutMs: 20 })).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
