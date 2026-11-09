#!/usr/bin/env node
/**
 * Stop the overlay after an IDE window closes, but only when no other window
 * of that IDE is still open. Used by the Cursor bridge because Cursor sends
 * sessionEnd(window_close) per window.
 *
 * Usage: node delay-down.mjs [agent] [delayMs]
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const agent = process.argv[2] || "cursor";
const delayMs = Number(process.argv[3] || 2500);
const ROOT = process.env.PETDEX_HOME
  ? join(process.env.PETDEX_HOME)
  : join(homedir(), ".petdex");
const CLI = join(ROOT, "overlay", "petdex.mjs");
const AGENT_PROCESSES =
  process.env.PETDEX_AGENT_PROCESSES || "Cursor,Kimi Code,ZCode";

await new Promise((resolve) => setTimeout(resolve, delayMs));

const names = AGENT_PROCESSES.split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((n) => `'${n.replace(/'/g, "''")}'`)
  .join(",");
if (!names) process.exit(0);

const out = spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-Command",
    `(Get-Process -Name ${names} -ErrorAction SilentlyContinue | Measure-Object).Count`,
  ],
  { encoding: "utf8", windowsHide: true, timeout: 8000 },
);
const n = Number((out.stdout || "").trim() || 0);
if (n === 0 && existsSync(CLI)) {
  spawnSync(process.execPath, [CLI, "down"], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 8000,
    env: { ...process.env, PETDEX_HOME: ROOT },
  });
}
