// Keep Node's runtime semantics for the existing backend and node:test suite.
// Bun still installs dependencies and orchestrates all project commands.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
export function nodeCommand(): string[] {
  if (process.platform === "win32" && process.arch === "x64") {
    try {
      return [require.resolve("node-win-x64/bin/node.exe")];
    } catch {}
  }
  const installed = Bun.which("node");
  if (
    installed &&
    !Bun.spawnSync([installed, "-p", 'process.versions.bun || ""'])
      .stdout.toString()
      .trim()
  )
    return [installed];
  throw new Error(
    "Node 22+ é necessário para preservar a compatibilidade do backend. No Windows x64, execute bun install para instalar o binário opcional.",
  );
}
