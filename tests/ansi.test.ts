import { describe, it, expect } from "vitest";
import { makeAnsi, colorEnabled, visibleWidth, padStart, padEnd, truncate } from "../src/ansi.js";

describe("ansi", () => {
  it("colorEnabled honours FORCE_COLOR / NO_COLOR / TERM / TTY", () => {
    expect(colorEnabled({ isTTY: true, env: {} })).toBe(true);
    expect(colorEnabled({ isTTY: false, env: {} })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: { NO_COLOR: "1" } })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: { MEMHOOK_NO_COLOR: "1" } })).toBe(false);
    expect(colorEnabled({ isTTY: true, env: { TERM: "dumb" } })).toBe(false);
    // FORCE_COLOR wins even over a non-TTY.
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: "1" } })).toBe(true);
    // FORCE_COLOR even overrides NO_COLOR (explicit opt-in beats opt-out).
    expect(colorEnabled({ isTTY: false, env: { FORCE_COLOR: "1", NO_COLOR: "1" } })).toBe(true);
  });

  it("emits SGR when enabled and is the identity when disabled", () => {
    const on = makeAnsi({ isTTY: true, env: { FORCE_COLOR: "1" } });
    const off = makeAnsi({ isTTY: false, env: {} });
    const g = on.green("ok");
    expect(on.enabled).toBe(true);
    expect(off.enabled).toBe(false);
    expect(g).not.toBe("ok");
    expect(g.charCodeAt(0)).toBe(27); // ESC
    expect(off.green("ok")).toBe("ok");
    expect(off.bold(off.red("x"))).toBe("x");
  });

  it("visibleWidth ignores ANSI codes", () => {
    const on = makeAnsi({ isTTY: true, env: { FORCE_COLOR: "1" } });
    expect(visibleWidth(on.green("hello"))).toBe(5);
    expect(visibleWidth("plain")).toBe(5);
  });

  it("padStart / padEnd pad to visible width even with colour", () => {
    const on = makeAnsi({ isTTY: true, env: { FORCE_COLOR: "1" } });
    expect(visibleWidth(padStart(on.green("x"), 4))).toBe(4);
    expect(visibleWidth(padEnd(on.red("yz"), 5))).toBe(5);
    expect(padEnd("ab", 1)).toBe("ab"); // never truncates
  });

  it("truncate appends an ellipsis only when cut", () => {
    expect(truncate("hello world", 8)).toBe("hello w…");
    expect(truncate("hi", 8)).toBe("hi");
  });
});
