#!/usr/bin/env node
/**
 * Keep the overlay tied to the agent IDE lifetime.
 *
 * - any supported agent process running → ensure overlay is up
 * - all gone for GRACE_MS → stop the overlay and exit
 *
 * Started by the hook bridge (or manually). The overlay never launches this
 * script itself, so there is no recursion.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.env.PETDEX_HOME
  ? join(process.env.PETDEX_HOME)
  : join(homedir(), ".petdex");
const RUNTIME = join(ROOT, "runtime");
const WATCHDOG_PID = join(ROOT, "watchdog.pid");
const CLI = join(ROOT, "overlay", "petdex.mjs");
const LOG = join(RUNTIME, "watchdog.log");
const AGENT_PROCESSES =
  process.env.PETDEX_AGENT_PROCESSES || "Cursor,Kimi Code,Codex,ZCode";

const POLL_MS = 2500;
const GRACE_MS = 12000; // tolerate IDE restart / brief gaps

function log(msg) {
  mkdirSync(RUNTIME, { recursive: true });
  try {
    writeFileSync(LOG, `${new Date().toISOString()} ${msg}\n`, { flag: "a" });
  } catch {
    /* ignore */
  }
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function agentRunning() {
  const names = AGENT_PROCESSES.split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((n) => `'${n.replace(/'/g, "''")}'`)
    .join(",");
  if (!names) return false;
  const out = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Name ${names} -ErrorAction SilentlyContinue | Measure-Object).Count`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 8000 },
  );
  const n = Number((out.stdout || "").trim());
  return Number.isFinite(n) && n > 0;
}

function runCli(cmd) {
  spawnSync(process.execPath, [CLI, cmd], {
    stdio: "ignore",
    windowsHide: true,
    timeout: 15000,
    env: { ...process.env, PETDEX_HOME: ROOT, PETDEX_WATCHDOG_SELF: "1" },
  });
}

function alreadyWatching() {
  try {
    const pid = Number(readFileSync(WATCHDOG_PID, "utf8").trim());
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid && isAlive(pid)) {
      return pid;
    }
  } catch {
    /* no pid file */
  }
  return null;
}

function mainLoop() {
  let missingSince = null;
  let lastAgent = false;

  const tick = () => {
    let up;
    try {
      up = agentRunning();
    } catch (e) {
      log(`agent check failed: ${e}`);
      return;
    }

    if (up) {
      missingSince = null;
      if (!lastAgent) {
        log("agent IDE detected → overlay up");
        runCli("up");
      }
      lastAgent = true;
      return;
    }

    lastAgent = false;
    if (!missingSince) missingSince = Date.now();
    if (Date.now() - missingSince >= GRACE_MS) {
      log("agent IDE gone → overlay down + watchdog exit");
      runCli("down");
      process.exit(0);
    }
  };

  tick();
  setInterval(tick, POLL_MS);
}

const existing = alreadyWatching();
if (existing) {
  process.stdout.write(`watchdog already running pid=${existing}\n`);
  process.exit(0);
}
if (!existsSync(CLI)) {
  process.stderr.write(`missing ${CLI}\n`);
  process.exit(1);
}

mkdirSync(RUNTIME, { recursive: true });
writeFileSync(WATCHDOG_PID, String(process.pid), "utf8");
log(`watchdog start pid=${process.pid} agents=${AGENT_PROCESSES}`);

process.on("exit", () => {
  try {
    const cur = Number(readFileSync(WATCHDOG_PID, "utf8").trim());
    if (cur === process.pid) rmSync(WATCHDOG_PID, { force: true });
  } catch {
    /* ignore */
  }
});

mainLoop();
