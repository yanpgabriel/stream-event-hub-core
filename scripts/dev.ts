import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const children = [
  Bun.spawn([process.execPath, "scripts/server.ts", "--watch"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn([process.execPath, "run", "--cwd", "web", "dev"], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }),
];
function stop() {
  for (const child of children) child.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const result = await Promise.race(children.map((child) => child.exited));
stop();
process.exit(result);
