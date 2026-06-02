import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicProvider } from "../src/providers/anthropic.js";

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

const OK = {
  content: [{ type: "text", text: '["feedback_x.md"]' }],
  usage: {
    input_tokens: 1200,
    output_tokens: 8,
    cache_creation_input_tokens: 64,
    cache_read_input_tokens: 1024,
  },
};

describe("AnthropicProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /v1/messages with x-api-key + anthropic-version and an ephemeral cache_control system block", async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse(OK)));
    const p = new AnthropicProvider(
      { apiKey: "sk-ant-test", model: "claude-haiku-4-5" },
      { cacheControlTtl: "1h" },
    );
    const res = await p.select({
      systemPrompt: "CATALOG",
      userPrompt: "hello",
      maxOutputTokens: 200,
      timeoutMs: 8000,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://api.anthropic.com/v1/messages");
    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(headers["anthropic-beta"]).toBeUndefined();
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      max_tokens: number;
      system: { type: string; text: string; cache_control: { type: string; ttl?: string } }[];
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("claude-haiku-4-5");
    expect(body.max_tokens).toBe(200);
    expect(body.system[0]).toEqual({
      type: "text",
      text: "CATALOG",
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    expect(body.messages[0]).toEqual({ role: "user", content: "hello" });

    expect(res.rawText).toBe('["feedback_x.md"]');
    expect(res.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 8,
      cacheCreateTokens: 64,
      cacheReadTokens: 1024,
    });
    expect(res.httpStatus).toBe(200);
  });

  it("maps a non-empty betaHeaders list to the anthropic-beta header", async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse(OK)));
    const p = new AnthropicProvider(
      { apiKey: "k", model: "m" },
      { betaHeaders: ["foo-2026", "bar-2026"] },
    );
    await p.select({ systemPrompt: "s", userPrompt: "u", maxOutputTokens: 50, timeoutMs: 8000 });
    const headers = spy.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["anthropic-beta"]).toBe("foo-2026,bar-2026");
  });

  it("omits the ttl when no cacheControlTtl is given (still ephemeral)", async () => {
    const spy = stubFetch(() => Promise.resolve(jsonResponse(OK)));
    const p = new AnthropicProvider({ apiKey: "k", model: "m" });
    await p.select({ systemPrompt: "s", userPrompt: "u", maxOutputTokens: 50, timeoutMs: 8000 });
    const body = JSON.parse(String(spy.mock.calls[0]?.[1]?.body)) as {
      system: { cache_control: { type: string; ttl?: string } }[];
    };
    expect(body.system[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("returns empty rawText + zero usage on a malformed body (fail-soft)", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ unexpected: true })));
    const p = new AnthropicProvider({ apiKey: "k", model: "m" });
    const res = await p.select({
      systemPrompt: "s",
      userPrompt: "u",
      maxOutputTokens: 50,
      timeoutMs: 8000,
    });
    expect(res.rawText).toBe("");
    expect(res.usage.inputTokens).toBe(0);
  });

  it("retries once on 503 then succeeds", async () => {
    let n = 0;
    const spy = stubFetch(() => {
      n += 1;
      if (n === 1) return Promise.resolve(jsonResponse({}, 503));
      return Promise.resolve(jsonResponse({ content: [{ type: "text", text: "[]" }], usage: {} }));
    });
    const p = new AnthropicProvider({ apiKey: "k", model: "m" });
    const res = await p.select({
      systemPrompt: "s",
      userPrompt: "u",
      maxOutputTokens: 50,
      timeoutMs: 8000,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.rawText).toBe("[]");
  });

  it("throws when apiKey or model is missing (caller catches -> fail-soft)", () => {
    expect(() => new AnthropicProvider({ apiKey: "", model: "m" })).toThrow();
    expect(() => new AnthropicProvider({ apiKey: "k", model: "" })).toThrow();
  });
});
