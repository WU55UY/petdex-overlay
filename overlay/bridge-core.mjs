#!/usr/bin/env node
/**
 * Core agent → overlay state machine.
 *
 * Kept separate from hooks/bridge.mjs so it can be unit-tested without reading
 * stdin or spawning processes. See applyEvent().
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const EVENTS = new Set([
  "boot",
  "workspace-open",
  "session-end",
  "user-prompt",
  "pre",
  "post",
  "notification",
  "stop",
  "interrupt",
  "stop-failure",
  "ensure-idle",
]);

export function readJson(path, fallback = {}) {
  try {
    return { ...fallback, ...JSON.parse(readFileSync(path, "utf8")) };
  } catch {
    return { ...fallback };
  }
}

function atomicWrite(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj), "utf8");
  renameSync(tmp, path);
}

function bump(session) {
  session.seq = (session.seq || 0) + 1;
  return session.seq;
}

function convId(payload) {
  return (
    payload?.conversation_id ||
    payload?.session_id ||
    payload?.composerId ||
    "default"
  );
}

function ensureConv(session, id) {
  if (!session.byId || typeof session.byId !== "object") session.byId = {};
  if (!session.byId[id]) session.byId[id] = { inflight: 0, toolsThisTurn: 0 };
  return session.byId[id];
}

function totalInflight(session) {
  let n = 0;
  for (const conv of Object.values(session.byId || {})) {
    n += Math.max(0, Number(conv.inflight) || 0);
  }
  return n;
}

function agentProcessCount(name) {
  const quoted = name.replace(/'/g, "''");
  const out = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `(Get-Process -Name '${quoted}' -ErrorAction SilentlyContinue | Measure-Object).Count`,
    ],
    { encoding: "utf8", windowsHide: true, timeout: 5000 },
  );
  const n = Number((out.stdout || "").trim());
  return Number.isFinite(n) ? n : 0;
}

export async function applyEvent({
  agent = "generic",
  event,
  payload = {},
  root,
  startOverlay = true,
}) {
  if (!EVENTS.has(event)) throw new Error(`unknown bridge event: ${event}`);
  const home =
    root ||
    process.env.PETDEX_HOME ||
    join(process.env.USERPROFILE || homedir(), ".petdex");
  const runtime = join(home, "runtime");
  const statePath = join(runtime, "state.json");
  const bubblePath = join(runtime, "bubble.json");
  const sessionPath = join(runtime, "session.json");
  const cli = join(home, "overlay", "petdex.mjs");
  const noSpawn = process.env.PETDEX_NO_SPAWN === "1";

  const log = (msg) => {
    try {
      mkdirSync(runtime, { recursive: true });
      writeFileSync(join(runtime, "boot.log"), `${new Date().toISOString()} ${msg}\n`, {
        flag: "a",
      });
    } catch {
      /* ignore */
    }
  };

  const runCli = (cmd, args = []) => {
    if (!startOverlay || noSpawn || !existsSync(cli)) return;
    spawnSync(process.execPath, [cli, cmd, ...args], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15000,
      env: { ...process.env, PETDEX_HOME: home },
    });
  };

  const writeState = (session, state, duration = null) => {
    const counter = bump(session);
    atomicWrite(statePath, { state, duration, updatedAt: Date.now(), counter });
    return counter;
  };

  const writeBubble = (session, text) => {
    const counter = bump(session);
    atomicWrite(bubblePath, {
      text: text ?? "",
      agent_source: agent,
      updatedAt: Date.now(),
      counter,
    });
    return counter;
  };

  const session = readJson(sessionPath, {
    seq: 0,
    byId: {},
    inflight: 0,
    toolsThisTurn: 0,
  });
  if (!session.byId) session.byId = {};
  if (
    Object.keys(session.byId).length === 0 &&
    (Number(session.inflight) || 0) > 0
  ) {
    session.byId.default = {
      inflight: Number(session.inflight) || 0,
      toolsThisTurn: Number(session.toolsThisTurn) || 0,
    };
  }

  const id = convId(payload);
  const conv = ensureConv(session, id);
  session.activeId = id;

  switch (event) {
    case "boot":
    case "workspace-open":
      log(`${event} → startOverlay (${agent})`);
      runCli("up", ["--managed"]);
      if (event === "boot") {
        session.byId = {};
        session.inflight = 0;
        session.toolsThisTurn = 0;
      } else {
        conv.inflight = 0;
        conv.toolsThisTurn = 0;
        session.byId[id] = conv;
      }
      writeState(session, "idle", null);
      writeBubble(session, "");
      break;

    case "session-end": {
      const reason = String(payload?.reason || "");
      if (agent === "cursor" && reason === "window_close") {
        const procs = agentProcessCount("Cursor");
        log(`session-end window_close cursorProcs=${procs}`);
        if (procs === 0) runCli("down");
        else {
          const delayDown = join(home, "overlay", "delay-down.mjs");
          if (startOverlay && !noSpawn && existsSync(delayDown)) {
            spawnSync(process.execPath, [delayDown, "cursor", "2500"], {
              stdio: "ignore",
              windowsHide: true,
              timeout: 15000,
              env: { ...process.env, PETDEX_HOME: home },
            });
          }
        }
        break;
      }
      delete session.byId[id];
      if (totalInflight(session) > 0) {
        showBusy(session, writeState, writeBubble);
      } else {
        writeState(session, "idle", null);
        writeBubble(session, "");
      }
      break;
    }

    case "user-prompt":
      runCli("up", ["--managed"]);
      conv.toolsThisTurn = 0;
      conv.inflight = 0;
      session.byId[id] = conv;
      writeState(session, "jumping", 800);
      writeBubble(session, "Thinking…");
      break;

    case "pre":
      conv.inflight = Math.max(0, Number(conv.inflight) || 0) + 1;
      conv.toolsThisTurn = (Number(conv.toolsThisTurn) || 0) + 1;
      session.byId[id] = conv;
      session.inflight = totalInflight(session);
      showBusy(session, writeState, writeBubble);
      break;

    case "post":
      conv.inflight = Math.max(0, (Number(conv.inflight) || 0) - 1);
      session.byId[id] = conv;
      session.inflight = totalInflight(session);
      if (totalInflight(session) === 0) {
        writeState(session, "idle", null);
        writeBubble(session, "");
      } else {
        showBusy(session, writeState, writeBubble);
      }
      break;

    case "notification":
      writeState(session, "waiting", null);
      writeBubble(session, "Waiting for you…");
      break;

    case "stop":
    case "interrupt":
    case "stop-failure": {
      const tools = Number(conv.toolsThisTurn) || 0;
      conv.inflight = 0;
      conv.toolsThisTurn = 0;
      session.byId[id] = conv;
      session.inflight = totalInflight(session);

      let text = "Done.";
      try {
        // loot.mjs reads PETDEX_HOME at import time; make sure an explicitly
        // supplied root (tests, portables) is honoured.
        const previousHome = process.env.PETDEX_HOME;
        process.env.PETDEX_HOME = home;
        let loot;
        try {
          loot = await import(
            pathToFileURL(join(home, "overlay", "loot.mjs")).href +
              `?root=${encodeURIComponent(home)}`
          );
        } finally {
          if (previousHome === undefined) delete process.env.PETDEX_HOME;
          else process.env.PETDEX_HOME = previousHome;
        }
        const award = loot.awardCrate(tools);
        text = loot.bubbleTextForAward(award);
        log(`${event} award tools=${tools} → ${text}`);
      } catch (e) {
        log(`${event} award failed: ${e?.message || e}`);
      }

      session.lootHoldUntil = Date.now() + 3500;
      writeState(session, "waving", 3500);
      writeBubble(session, text);
      break;
    }

    case "ensure-idle":
      if (totalInflight(session) <= 0) {
        if (Number(session.lootHoldUntil) > Date.now()) break;
        const st = readJson(statePath, { state: "idle" });
        if (st.state === "waving") break;
        writeState(session, "idle", null);
        writeBubble(session, "");
      }
      break;

    default:
      break;
  }

  session.inflight = totalInflight(session);
  atomicWrite(sessionPath, session);
  return { session, id };
}

function showBusy(session, writeState, writeBubble) {
  if (Number(session.lootHoldUntil) > Date.now()) return;
  const total = Object.values(session.byId || {}).reduce(
    (sum, c) => sum + Math.max(0, Number(c.inflight) || 0),
    0,
  );
  writeState(session, total % 2 === 0 ? "running-left" : "running-right", null);
  writeBubble(session, "Calling tool");
}

export async function removeBridgeLock(home) {
  try {
    rmSync(join(home, "runtime", "hook.lock"), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
