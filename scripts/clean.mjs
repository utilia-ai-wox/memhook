// Remove the build output directory before `tsc` runs so a stale artifact from
// a since-renamed/deleted source file can never linger in `dist/` (and thus
// never be shipped, since the npm tarball includes the whole `dist/` tree).
// Cross-platform (works on the Linux/macOS/Windows CI matrix) and zero-dep.
import { rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
