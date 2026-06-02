import { describe, it, expect } from "vitest";
import { route } from "../src/router.js";

// `memhook/hook` (package.json "exports") maps to the router module. This guards
// that its entry point `route` exists and is callable, so the published subpath
// can't silently rot if the router is refactored.
describe("hook entry (memhook/hook -> router)", () => {
  it("exports route as a function", () => {
    expect(typeof route).toBe("function");
  });
});
