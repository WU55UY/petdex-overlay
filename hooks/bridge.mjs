#!/usr/bin/env node
/**
 * Agent → overlay hook entry point.
 *
 * Usage:
 *   node bridge.mjs <codex|cursor|kimi> <event>   # preferred
 *   node bridge.mjs <event>                 # agent defaults to "generic"
 *
 * The state machine lives in ../overlay/bridge-core.mjs. This wrapper only
 * reads the hook payload from stdin and serialises concurrent hook calls with
 * a directory lock.
 */
import {
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { applyEvent, EVENTS } from "../overlay/bridge-core.mjs";

const first = process.argv[2] || "";
let agent = "generic";
let event = "pre";
if (EVENTS.has(first)) {
  event = first;
} else {
  agent = first || "generic";
  event = process.argv[3] || "pre";
}

const ROOT = process.env.PETDEX_HOME
  ? join(process.env.PETDEX_HOME)
  : join(homedir(), ".petdex");
const RUNTIME = join(ROOT, "runtime");
const LOCK = join(RUNTIME, "hook.lock");
const DISABLED = join(RUNTIME, "hooks-disabled");

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function acquireLock() {
  mkdirSync(RUNTIME, { recursive: true });
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(LOCK);
      return () => rmSync(LOCK, { recursive: true, force: true });
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > 15000) {
          rmSync(LOCK, { recursive: true, force: true });
          continue;
        }
      } catch {
        /* lock disappeared between checks */
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  return null;
}

if (existsSync(DISABLED)) process.exit(0);
if (!EVENTS.has(event)) {
  process.stderr.write(`unknown bridge event: ${event}\n`);
  process.exit(1);
}

const payload = await readStdinJson();
const release = await acquireLock();
try {
  await applyEvent({ agent, event, payload, root: ROOT });
} catch (e) {
  // Hooks must never break the agent.
  try {
    mkdirSync(RUNTIME, { recursive: true });
    const line = `${new Date().toISOString()} bridge failed: ${e?.stack || e}\n`;
    const { appendFileSync } = await import("node:fs");
    appendFileSync(join(RUNTIME, "boot.log"), line, "utf8");
  } catch {
    /* ignore */
  }
} finally {
  if (release) release();
}
process.exit(0);
