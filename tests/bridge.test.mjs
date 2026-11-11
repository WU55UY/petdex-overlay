import test from "node:test";
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { applyEvent } from "../overlay/bridge-core.mjs";

const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const homes = [];

function setup() {
  const home = mkdtempSync(join(tmpdir(), "petdex-bridge-"));
  homes.push(home);
  const overlay = join(home, "overlay");
  mkdirSync(overlay, { recursive: true });
  mkdirSync(join(home, "runtime"), { recursive: true });
  mkdirSync(join(home, "delta"), { recursive: true });
  for (const file of ["petdex.mjs", "loot.mjs", "novel.mjs", "bridge-core.mjs"]) {
    cpSync(join(repo, "overlay", file), join(overlay, file));
  }
  cpSync(join(repo, "hooks", "delay-down.mjs"), join(overlay, "delay-down.mjs"));
  cpSync(join(repo, "data", "items.json"), join(home, "delta", "items.json"));
  cpSync(join(repo, "pets", "sample"), join(home, "pets", "sample"), { recursive: true });
  writeFileSync(join(home, "active.json"), '{"slug":"sample"}');
  process.env.PETDEX_HOME = home;
  return home;
}

function readJson(home, name) {
  return JSON.parse(readFileSync(join(home, "runtime", name), "utf8"));
}

async function send(home, agent, event, payload = {}) {
  return applyEvent({ agent, event, payload, root: home, startOverlay: false });
}

async function loadLoot(home) {
  return import(pathToFileURL(join(home, "overlay", "loot.mjs")).href);
}

test.after(() => {
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

test("cursor events drive state and bank a crate", async () => {
  const home = setup();
  const payload = { conversation_id: "conv-1" };

  await send(home, "cursor", "workspace-open", payload);
  assert.equal(readJson(home, "state.json").state, "idle");

  await send(home, "cursor", "user-prompt", payload);
  assert.equal(readJson(home, "state.json").state, "jumping");
  assert.match(readJson(home, "bubble.json").text, /Thinking/);

  await send(home, "cursor", "pre", payload);
  await send(home, "cursor", "pre", payload);
  assert.equal(readJson(home, "state.json").state, "running-left");
  assert.equal(readJson(home, "bubble.json").text, "Calling tool");

  await send(home, "cursor", "post", payload);
  await send(home, "cursor", "post", payload);
  assert.equal(readJson(home, "state.json").state, "idle");
  assert.equal(readJson(home, "bubble.json").text, "");

  await send(home, "cursor", "stop", payload);
  assert.match(readJson(home, "bubble.json").text, /入库/);
  assert.equal(readJson(home, "state.json").state, "waving");

  const loot = await loadLoot(home);
  assert.equal(loot.pendingCount(), 1);
  const opened = loot.openPendingCrate();
  assert.equal(opened.empty, false);
  assert.equal(loot.pendingCount(), 0);
  assert.equal(loot.getStats().opens, 1);
});

test("codex session_id banks one crate", async () => {
  const home = setup();
  const payload = { session_id: "thr_123" };

  await send(home, "codex", "workspace-open", payload);
  assert.equal(readJson(home, "state.json").state, "idle");

  await send(home, "codex", "user-prompt", payload);
  assert.equal(readJson(home, "state.json").state, "jumping");

  await send(home, "codex", "pre", payload);
  await send(home, "codex", "notification", payload);
  assert.equal(readJson(home, "state.json").state, "waiting");

  await send(home, "codex", "stop", payload);
  assert.match(readJson(home, "bubble.json").text, /入库/);
  const loot = await loadLoot(home);
  assert.equal(loot.pendingCount(), 1);
});

test("kimi interrupt also settles the turn", async () => {
  const home = setup();
  const payload = { session_id: "kimi-1" };

  await send(home, "kimi", "user-prompt", payload);
  await send(home, "kimi", "pre", payload);
  await send(home, "kimi", "interrupt", payload);

  assert.match(readJson(home, "bubble.json").text, /入库/);
  const loot = await loadLoot(home);
  assert.equal(loot.pendingCount(), 1);
});

test("two conversations share one busy pet", async () => {
  const home = setup();
  await send(home, "cursor", "user-prompt", { conversation_id: "a" });
  await send(home, "cursor", "user-prompt", { conversation_id: "b" });
  await send(home, "cursor", "pre", { conversation_id: "a" });
  await send(home, "cursor", "pre", { conversation_id: "b" });

  const session = readJson(home, "session.json");
  assert.equal(session.inflight, 2);
  assert.equal(readJson(home, "bubble.json").text, "Calling tool");

  await send(home, "cursor", "post", { conversation_id: "a" });
  assert.equal(readJson(home, "state.json").state, "running-right");
  await send(home, "cursor", "post", { conversation_id: "b" });
  assert.equal(readJson(home, "state.json").state, "idle");
});

test("unknown events are rejected", async () => {
  const home = setup();
  await assert.rejects(
    () => send(home, "cursor", "not-a-real-event"),
    /unknown bridge event/,
  );
});
