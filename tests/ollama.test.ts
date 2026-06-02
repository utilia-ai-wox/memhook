import { describe, it, expect, vi, afterEach } from "vitest";
import { OllamaProvider } from "../src/providers/ollama.js";

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

describe("OllamaProvider", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("POSTs /api/chat with NO auth header, stream:false + format:json", async () => {
    const spy = stubFetch(() =>
      Promise.resolve(
        jsonResponse({
          message: { role: "assistant", content: '["feedback_alpha.md"]' },
          prompt_eval_count: 42,
          eval_count: 7,
          done: true,
        }),
      ),
    );
    const p = new OllamaProvider({ model: "llama3.1" });
    const res = await p.select({
      systemPrompt: "CATALOG",
      userPrompt: "hi",
      maxOutputTokens: 256,
      timeoutMs: 30000,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toBe("http://localhost:11434/api/chat");
    const init = spy.mock.calls[0]?.[1];
    const headers = init?.headers as Record<string, string>;
    expect(headers["Authorization"]).toBeUndefined();
    const body = JSON.parse(String(init?.body)) as {
      stream: boolean;
      format: string;
      options: { temperature: number; num_predict: number };
      messages: { role: string; content: string }[];
    };
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.options.temperature).toBe(0);
    expect(body.options.num_predict).toBe(256);
    expect(body.messages[0]).toEqual({ role: "system", content: "CATALOG" });

    expect(res.rawText).toBe('["feedback_alpha.md"]');
    expect(res.usage).toEqual({
      inputTokens: 42,
      outputTokens: 7,
      cacheCreateTokens: 0,
      cacheReadTokens: 0,
    });
  });

  it("returns empty rawText on a malformed body (fail-soft)", async () => {
    stubFetch(() => Promise.resolve(jsonResponse({ error: "model 'x' not found" }, 404)));
    const p = new OllamaProvider({ model: "x" });
    const res = await p.select({
      systemPrompt: "s",
      userPrompt: "u",
      maxOutputTokens: 50,
      timeoutMs: 30000,
    });
    expect(res.rawText).toBe("");
    expect(res.httpStatus).toBe(404);
  });

  it("throws when model is missing", () => {
    expect(() => new OllamaProvider({ model: "" })).toThrow();
  });
});
