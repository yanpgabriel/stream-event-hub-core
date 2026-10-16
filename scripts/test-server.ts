import { resolve } from "node:path";
import { nodeCommand } from "./node";

// Each legacy node:test file gets its own process, preserving module/env isolation.
const cwd = resolve(import.meta.dir, "../server");
const files = [...new Bun.Glob("test/*.test.js").scanSync(cwd)].sort();
const child = Bun.spawn([...nodeCommand(), "--test", ...files], {
  cwd,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
