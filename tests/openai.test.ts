import { describe, it, expect, vi, afterEach } from "vitest";
import { OpenAIProvider } from "../src/providers/openai.js";

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

describe("OpenAIProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs chat/completions with Bearer auth + system/user messages", async () => {
    const spy = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          choices: [{ message: { content: '["feedback_x.md"]' }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 1200,
            completion_tokens: 8,
            prompt_tokens_details: { cached_tokens: 1024 },
          },
        }),
      ),
    );
    const p = new OpenAIProvider({ apiKey: "sk-test", model: "gpt-4o-mini" });
    const res = await p.select({
      systemPrompt: "CATALOG",
      userPrompt: "hello",
      maxOutputTokens: 200,
      timeoutMs: 8000,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe("https://api.openai.com/v1/chat/completions");
    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      temperature: number;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.temperature).toBe(0);
    expect(body.messages[0]).toEqual({ role: "system", content: "CATALOG" });
    expect(body.messages[1]).toEqual({ role: "user", content: "hello" });

    expect(res.rawText).toBe('["feedback_x.md"]');
    expect(res.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 8,
      cacheCreateTokens: 0,
      cacheReadTokens: 1024,
    });
    expect(res.httpStatus).toBe(200);
  });

  it("returns empty rawText + zero usage on a malformed body (fail-soft)", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ unexpected: true })));
    const p = new OpenAIProvider({ apiKey: "k", model: "m" });
    const res = await p.select({
      systemPrompt: "s",
      userPrompt: "u",
      maxOutputTokens: 50,
      timeoutMs: 8000,
    });
    expect(res.rawText).toBe("");
    expect(res.usage.inputTokens).toBe(0);
  });

  it("throws when apiKey is missing (caller catches -> fail-soft)", () => {
    expect(() => new OpenAIProvider({ apiKey: "", model: "m" })).toThrow();
  });

  it("retries once on 429 then succeeds", async () => {
    let n = 0;
    const spy = stubFetch(() => {
      n += 1;
      if (n === 1) return Promise.resolve(jsonResponse({}, 429));
      return Promise.resolve(
        jsonResponse({ choices: [{ message: { content: "[]" } }], usage: {} }),
      );
    });
    const p = new OpenAIProvider({ apiKey: "k", model: "m" });
    const res = await p.select({
      systemPrompt: "s",
      userPrompt: "u",
      maxOutputTokens: 50,
      timeoutMs: 8000,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(res.rawText).toBe("[]");
  });
});
