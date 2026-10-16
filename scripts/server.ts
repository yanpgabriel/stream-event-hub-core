import { resolve } from "node:path";
import { nodeCommand } from "./node";
const child = Bun.spawn(
  [
    ...nodeCommand(),
    ...(process.argv.includes("--watch") ? ["--watch"] : []),
    "index.js",
  ],
  {
    cwd: resolve(import.meta.dir, "../server"),
    stdout: "inherit",
    stderr: "inherit",
  },
);
process.on("SIGINT", () => child.kill());
process.on("SIGTERM", () => child.kill());
process.exit(await child.exited);
