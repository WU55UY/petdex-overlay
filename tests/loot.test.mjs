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

const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const catalog = join(repo, "data", "items.json");
let counter = 0;
const homes = [];

function freshHome() {
  const home = mkdtempSync(join(tmpdir(), "petdex-loot-"));
  homes.push(home);
  mkdirSync(join(home, "delta"), { recursive: true });
  cpSync(catalog, join(home, "delta", "items.json"));
  process.env.PETDEX_HOME = home;
  return home;
}

async function loadLoot() {
  // A query string busts the ESM cache so each test gets a fresh ROOT.
  counter += 1;
  return import(
    pathToFileURL(join(repo, "overlay", "loot.mjs")).href + `?t=${counter}`
  );
}

test.after(() => {
  delete process.env.PETDEX_HOME;
  for (const home of homes) rmSync(home, { recursive: true, force: true });
});

test("award banks a sealed crate and open consumes it", async () => {
  const home = freshHome();
  const loot = await loadLoot();

  const award = loot.awardCrate(5);
  assert.equal(award.crate, "advanced");
  assert.equal(loot.pendingCount(), 1);
  assert.match(loot.bubbleTextForAward(award), /入库/);

  const opened = loot.openPendingCrate();
  assert.equal(opened.empty, false);
  assert.equal(loot.pendingCount(), 0);
  assert.equal(opened.opens, 1);
  assert.ok(opened.item.id);
  assert.ok(["white", "green", "blue", "purple", "gold", "red"].includes(opened.quality));

  const stash = JSON.parse(readFileSync(join(home, "delta", "stash.json"), "utf8"));
  assert.equal(stash.opens, 1);
  assert.equal(stash.history.length, 1);
  assert.equal(stash.history[0].id, opened.item.id);
});

test("hard pity forces a red after the configured drought", async () => {
  const home = freshHome();
  const loot = await loadLoot();
  const today = new Date();
  const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate(),
  ).padStart(2, "0")}`;
  writeFileSync(
    join(home, "delta", "stash.json"),
    JSON.stringify({
      version: 3,
      opens: 60,
      opensSinceRed: loot.PITY_REDS,
      statsDate: key,
      opensToday: 0,
      hafCoins: 0,
      hafCoinsToday: 0,
      items: {},
      history: [],
      pendingCrates: [],
      redsToday: {},
    }),
  );

  const opened = loot.openCrate(0);
  assert.equal(opened.quality, "red");
  assert.equal(opened.isRed, true);
  assert.equal(opened.forcedPity, true);
});

test("crate tier follows tool count", async () => {
  freshHome();
  const loot = await loadLoot();
  assert.equal(loot.crateTierFromTools(0), "safe");
  assert.equal(loot.crateTierFromTools(2), "safe");
  assert.equal(loot.crateTierFromTools(3), "advanced");
  assert.equal(loot.crateTierFromTools(9), "advanced");
  assert.equal(loot.crateTierFromTools(10), "ultimate");
  assert.equal(loot.crateLabel("ultimate"), "保险柜");
});

test("panel text lists the warehouse and codex", async () => {
  const home = freshHome();
  const loot = await loadLoot();
  loot.awardCrate(12);
  loot.openPendingCrate();

  const stash = loot.formatStashPanel();
  assert.match(stash, /【仓库】/);
  assert.match(stash, /单击切换/);

  const codex = loot.formatCodex();
  assert.ok(codex.total > 0);
  const panel = loot.formatCodexPanel();
  assert.match(panel, /【图鉴】/);

  const stats = loot.getStats();
  assert.equal(stats.opens, 1);
  assert.ok(readFileSync(join(home, "delta", "codex.json"), "utf8").includes("entries"));
});
