/**
 * Blind-box loot engine for the petdex overlay.
 *
 * Quality ladder: white < green < blue < purple < gold < red.
 * State lives in <PETDEX_HOME>/delta/ so the overlay and hooks can share it.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.PETDEX_HOME
  ? join(process.env.PETDEX_HOME)
  : join(homedir(), ".petdex");
const DELTA = join(ROOT, "delta");
const ITEMS_PATH = join(DELTA, "items.json");
const STASH_PATH = join(DELTA, "stash.json");
const CODEX_PATH = join(DELTA, "codex.json");
const LAST_LOOT = join(DELTA, "last-loot.json");

// Algo v2: base quality chances are fixed; soft pity shortens red droughts,
// and duplicate reds are nudged toward new codex entries.
export const PITY_REDS = 60; // hard pity — guaranteed red after this many non-red opens
export const DUP_RED_PITY = 2; // consecutive duplicate reds → next red is forced NEW
export const NEW_RED_WEIGHT_MULT = 3.5; // unfound reds weighted up when rolling red
export const FOUND_RED_WEIGHT_MULT = 0.45; // already-owned reds weighted down
const QUALITY_LABEL = {
  white: "白",
  green: "绿",
  blue: "蓝",
  purple: "紫",
  gold: "金",
  red: "红",
};
const QUALITY_RANK = { white: 1, green: 2, blue: 3, purple: 4, gold: 5, red: 6 };

/**
 * Per-crate quality CDF targets (in-game container names, high→low):
 * - 保险柜 ≈ 顶级：紫保底感，红 ~2.5%–3%，金较多（出非洲之心等）
 * - 小保险箱 ≈ 中高：红 ~1%，紫金可见
 * - 手提箱 ≈ 普通：红 ~0.5%，金很少，白绿为主
 */
export const QUALITY_CHANCE = {
  safe: [
    ["white", 0.4],
    ["green", 0.32],
    ["blue", 0.18],
    ["purple", 0.07],
    ["gold", 0.025],
    ["red", 0.005],
  ],
  advanced: [
    ["white", 0.15],
    ["green", 0.25],
    ["blue", 0.32],
    ["purple", 0.18],
    ["gold", 0.09],
    ["red", 0.01],
  ],
  ultimate: [
    ["white", 0.04],
    ["green", 0.1],
    ["blue", 0.22],
    ["purple", 0.38],
    ["gold", 0.23],
    ["red", 0.03],
  ],
};

const RED_TIER_WEIGHT = { T0: 1, T1: 5, T2: 12, T3: 22 };
export const CRATE_TIERS = ["safe", "advanced", "ultimate"];

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  renameSync(tmp, path);
}

export function loadCatalog() {
  if (!existsSync(ITEMS_PATH)) {
    throw new Error(`missing loot table: ${ITEMS_PATH}`);
  }
  const raw = readJson(ITEMS_PATH, {});
  // v2: flat items[]; v1 fallback junk/reds
  let items = Array.isArray(raw.items) ? raw.items : [];
  if (!items.length) {
    items = [
      ...(raw.junk || []).map((it) => ({ ...it, quality: it.quality || "white" })),
      ...(raw.reds || []).map((it) => ({ ...it, quality: "red" })),
    ];
  }
  return { ...raw, items };
}

function allItems() {
  return loadCatalog().items || [];
}

function redItems() {
  return allItems().filter((it) => (it.quality || "") === "red");
}

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayStartMs(dateKey) {
  const [y, m, d] = String(dateKey || "").split("-").map((n) => Number(n));
  if (!y || !m || !d) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
  }
  return new Date(y, m - 1, d).getTime();
}

function emptyRedsTodayBag() {
  return {};
}

/** Reds opened on statsDate. null means the bag still needs a one-time backfill. */
function touchDailyStats(stash) {
  const today = todayKey();
  if (stash.statsDate !== today) {
    stash.statsDate = today;
    stash.opensToday = 0;
    stash.hafCoinsToday = 0;
    stash.redsToday = emptyRedsTodayBag();
  } else if (
    !stash.redsToday ||
    typeof stash.redsToday !== "object" ||
    Array.isArray(stash.redsToday)
  ) {
    stash.redsToday = null;
  }
  if (typeof stash.opensToday !== "number") stash.opensToday = 0;
  if (typeof stash.hafCoinsToday !== "number") stash.hafCoinsToday = 0;
  return stash;
}

function addRedToday(bag, id, row) {
  const prev = bag[id] || {
    count: 0,
    name: row.name,
    value: row.value || 0,
    lastAt: row.lastAt || row.at || 0,
  };
  prev.count = (prev.count || 0) + (row.count || 1);
  prev.name = row.name || prev.name;
  prev.value = row.value || prev.value || 0;
  const at = row.lastAt || row.at || 0;
  if (at > (prev.lastAt || 0)) prev.lastAt = at;
  bag[id] = prev;
  return bag;
}

/**
 * Recover today's reds once, for saves that predate redsToday.
 * History is capped, so a red whose latest drop is today but fell out of
 * history is counted as 1.
 */
function backfillRedsToday(stash) {
  const start = dayStartMs(stash.statsDate || todayKey());
  const bag = emptyRedsTodayBag();
  for (const h of stash.history || []) {
    if (!h?.id || !h.at || h.at < start) continue;
    if (h.quality !== "red" && !h.isRed) continue;
    addRedToday(bag, h.id, h);
  }
  for (const [id, it] of Object.entries(stash.items || {})) {
    if (bag[id]) continue;
    const q = it.quality || (it.tier ? "red" : "");
    if (q !== "red" || !it.lastAt || it.lastAt < start) continue;
    addRedToday(bag, id, { ...it, count: 1 });
  }
  stash.redsToday = bag;
  return stash;
}

function recordRedToday(stash, item, now) {
  if (!stash.redsToday || typeof stash.redsToday !== "object" || Array.isArray(stash.redsToday)) {
    stash.redsToday = emptyRedsTodayBag();
  }
  addRedToday(stash.redsToday, item.id, {
    name: item.name,
    value: item.value || 0,
    count: 1,
    lastAt: now,
  });
}

function todayRedRows(stash) {
  return Object.entries(stash?.redsToday || {})
    .map(([id, it]) => ({ id, ...it }))
    .filter((it) => (it.count || 0) > 0)
    .sort(
      (a, b) =>
        (b.value || 0) - (a.value || 0) || String(a.name).localeCompare(String(b.name), "zh"),
    );
}

function backfillHafCoins(stash) {
  if ((stash.hafCoins || 0) > 0 || !(stash.opens > 0) || stash.hafCoinsBackfilled) {
    return stash;
  }
  let sum = 0;
  for (const it of Object.values(stash.items || {})) {
    sum += (it.value || 0) * (it.count || 0);
  }
  stash.hafCoins = sum;
  stash.hafCoinsBackfilled = true;
  return stash;
}

/** Align stash item values with items.json; adjust lifetime/today haf totals. */
function reconcileStashValues(stash, byId) {
  if (!stash.items || typeof stash.items !== "object") stash.items = {};
  if (!Array.isArray(stash.history)) stash.history = [];

  let hafAdjust = 0;
  let todayAdjust = 0;
  let changed = false;
  for (const [id, row] of Object.entries(stash.items)) {
    const ref = byId[id];
    if (!ref) continue;
    const oldVal = row.value || 0;
    const newVal = ref.value || 0;
    if (
      oldVal !== newVal ||
      row.name !== ref.name ||
      row.quality !== ref.quality ||
      row.tier !== (ref.tier || null) ||
      row.slots !== ref.slots
    ) {
      hafAdjust += (newVal - oldVal) * (row.count || 0);
      row.value = newVal;
      row.name = ref.name;
      row.quality = ref.quality || row.quality;
      row.tier = ref.tier || null;
      row.slots = ref.slots;
      changed = true;
    }
  }

  if (changed) {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayMs = dayStart.getTime();
    for (const h of stash.history) {
      if (!h?.at || h.at < dayMs) continue;
      const ref = byId[h.id];
      if (!ref) continue;
      const oldVal = h.value || 0;
      if (oldVal !== ref.value) {
        todayAdjust += ref.value - oldVal;
        h.value = ref.value;
      }
    }
    stash.hafCoins = Math.max(0, (stash.hafCoins || 0) + hafAdjust);
    stash.hafCoinsToday = Math.max(0, (stash.hafCoinsToday || 0) + todayAdjust);
  }
  return { changed, hafAdjust, todayAdjust };
}

function reconcileCodexValues(codex, byId) {
  let changed = false;
  for (const [id, ent] of Object.entries(codex.entries || {})) {
    const ref = byId[id];
    if (!ref) continue;
    if (ent.value !== ref.value || ent.name !== ref.name || ent.tier !== (ref.tier || null)) {
      ent.value = ref.value;
      ent.name = ref.name;
      ent.tier = ref.tier || null;
      changed = true;
    }
  }
  return changed;
}

export function reconcileItemValuesFromCatalog() {
  const byId = Object.fromEntries(allItems().map((it) => [it.id, it]));
  const stash = { ...defaultStash(), ...readJson(STASH_PATH, {}) };
  const stashResult = reconcileStashValues(stash, byId);
  const codex = loadCodex();
  const codexChanged = reconcileCodexValues(codex, byId);
  if (stashResult.changed) saveStash(stash);
  if (codexChanged) saveCodex(codex);
  return {
    stashChanged: stashResult.changed,
    codexChanged,
    hafAdjust: stashResult.hafAdjust,
    todayAdjust: stashResult.todayAdjust,
  };
}

function defaultStash() {
  return {
    version: 3,
    hafCoins: 0,
    hafCoinsToday: 0,
    opens: 0,
    opensToday: 0,
    statsDate: todayKey(),
    opensSinceRed: 0,
    dupRedsSinceNew: 0, // consecutive reds that were already in codex
    items: {},
    history: [],
    pendingCrates: [],
    redsToday: {},
  };
}

function defaultCodex(reds) {
  const entries = {};
  for (const it of reds) {
    entries[it.id] = {
      found: false,
      count: 0,
      firstAt: null,
      name: it.name,
      tier: it.tier || null,
      quality: "red",
      value: it.value,
      limited: !!it.limited,
    };
  }
  return { version: 2, entries };
}

export function loadStash() {
  const raw = readJson(STASH_PATH, {});
  const s = { ...defaultStash(), ...raw };
  if (!s.items || typeof s.items !== "object") s.items = {};
  if (!Array.isArray(s.history)) s.history = [];
  if (!Array.isArray(s.pendingCrates)) s.pendingCrates = [];
  if (typeof s.dupRedsSinceNew !== "number") s.dupRedsSinceNew = 0;
  const beforeHaf = s.hafCoins || 0;
  const beforeDate = s.statsDate;
  const beforeDup = raw.dupRedsSinceNew;
  const hadRedsToday =
    !!raw.redsToday && typeof raw.redsToday === "object" && !Array.isArray(raw.redsToday);
  touchDailyStats(s);
  let redsBackfilled = false;
  // defaultStash() fills a missing bag with {}, so use the raw file to detect first migration.
  if (s.redsToday == null || (!hadRedsToday && beforeDate === s.statsDate)) {
    backfillRedsToday(s);
    redsBackfilled = true;
  }
  backfillHafCoins(s);
  const byId = Object.fromEntries(allItems().map((it) => [it.id, it]));
  const reconciled = reconcileStashValues(s, byId);
  if (
    s.hafCoins !== beforeHaf ||
    reconciled.changed ||
    beforeDate !== s.statsDate ||
    raw.version !== 3 ||
    beforeDup === undefined ||
    redsBackfilled ||
    !hadRedsToday
  ) {
    s.version = 3;
    saveStash(s);
  }
  return s;
}

export function loadCodex() {
  const base = defaultCodex(redItems());
  const saved = readJson(CODEX_PATH, null);
  if (!saved || !saved.entries) return base;
  for (const [id, ent] of Object.entries(saved.entries)) {
    if (base.entries[id]) {
      base.entries[id] = { ...base.entries[id], ...ent };
    }
  }
  const byId = Object.fromEntries(allItems().map((it) => [it.id, it]));
  const changed = reconcileCodexValues(base, byId);
  const sizeChanged =
    !saved?.entries || Object.keys(base.entries).length !== Object.keys(saved.entries).length;
  if (changed || sizeChanged) saveCodex(base);
  return base;
}

function saveStash(stash) {
  atomicWrite(STASH_PATH, stash);
}

function saveCodex(codex) {
  atomicWrite(CODEX_PATH, codex);
}

function pickWeighted(list, weightFn) {
  let total = 0;
  const weights = list.map((it) => {
    const w = Math.max(0, weightFn(it));
    total += w;
    return w;
  });
  if (!list.length) return null;
  if (total <= 0) return list[Math.floor(Math.random() * list.length)];
  let r = Math.random() * total;
  for (let i = 0; i < list.length; i++) {
    r -= weights[i];
    if (r <= 0) return list[i];
  }
  return list[list.length - 1];
}

export function crateTierFromTools(toolCount) {
  const n = Math.max(0, Number(toolCount) || 0);
  if (n >= 10) return "ultimate";
  if (n >= 3) return "advanced";
  return "safe";
}

export function crateLabel(tier) {
  return (
    {
      // tools↑ → better container (保险柜 is best)
      safe: "手提箱",
      advanced: "小保险箱",
      ultimate: "保险柜",
      nest: "手提箱",
      small: "小保险箱",
      large: "保险柜",
    }[tier] || "手提箱"
  );
}

export function formatHaf(value) {
  const v = Number(value) || 0;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${Math.round(v / 1e4)}万`;
  return `${v}`;
}

export function qualityOf(item) {
  return item?.quality || (item?.tier ? "red" : "white");
}

function compareStashRows(a, b) {
  const qa = QUALITY_RANK[qualityOf(a)] || 0;
  const qb = QUALITY_RANK[qualityOf(b)] || 0;
  if (qb !== qa) return qb - qa;
  const va = (a.value || 0) * (a.count || 0);
  const vb = (b.value || 0) * (b.count || 0);
  if (vb !== va) return vb - va;
  return String(a.name || "").localeCompare(String(b.name || ""), "zh");
}

/**
 * Roll one item by Delta-like quality ladder.
 * - Low crates: mostly white/green/blue, tiny chance gold/red
 * - Ultimate: purple-floor feel (reroll white/green → purple), red still rare
 * - Soft pity boosts red weight after dry streak; hard pity at PITY_REDS
 * - When red: bias toward unfound codex; after DUP_RED_PITY dup reds, force NEW
 */
export function rollItem(toolCount = 0, opts = {}) {
  const items = allItems();
  const stash = opts.stash || loadStash();
  const codex = opts.codex || loadCodex();
  const crate = opts.crate || crateTierFromTools(toolCount);
  const dry = stash.opensSinceRed || 0;
  const forceRed = dry >= PITY_REDS;
  const forceNewRed =
    (stash.dupRedsSinceNew || 0) >= DUP_RED_PITY && hasUnfoundReds(codex);

  let quality;
  if (forceRed) {
    quality = "red";
  } else {
    quality = rollQuality(crate, dry);
    // 保险柜「出紫打底」手感 — 白/绿抬到紫
    if (crate === "ultimate" && (quality === "white" || quality === "green")) {
      quality = "purple";
    }
  }

  let pool = items.filter((it) => qualityOf(it) === quality);
  if (!pool.length) pool = items.filter((it) => qualityOf(it) === "white");
  if (!pool.length) pool = items;

  let forcedNew = false;
  if (quality === "red") {
    const unfound = pool.filter((it) => !isCodexFound(codex, it.id));
    if (forceNewRed && unfound.length) {
      pool = unfound;
      forcedNew = true;
    }
  }

  const item = pickWeighted(pool, (it) => {
    if (quality === "red") {
      let w = RED_TIER_WEIGHT[it.tier] || 10;
      if (it.limited) w *= 0.5;
      // T0 再稀一点
      if (it.tier === "T0") w *= 0.35;
      if (isCodexFound(codex, it.id)) w *= FOUND_RED_WEIGHT_MULT;
      else w *= NEW_RED_WEIGHT_MULT;
      return w;
    }
    // 同品质内略偏贵的
    return 1 + Math.log10((it.value || 1000) + 1);
  });

  const q = qualityOf(item);
  const firstFindCandidate =
    q === "red" && item && !isCodexFound(codex, item.id);
  return {
    item: { ...item, quality: q },
    isRed: q === "red",
    quality: q,
    crate,
    forcedPity: forceRed && q === "red",
    forcedNewRed: forcedNew && q === "red",
    firstFindCandidate,
  };
}

function isCodexFound(codex, id) {
  return !!(codex?.entries?.[id]?.found);
}

function hasUnfoundReds(codex) {
  const entries = Object.values(codex?.entries || {});
  if (!entries.length) return redItems().length > 0;
  return entries.some((e) => !e.found);
}

function rollQuality(crate, dryOpens) {
  const table = QUALITY_CHANCE[crate] || QUALITY_CHANCE.safe;
  // soft pity: slightly stronger than v1 ( /40 vs /50 ) with hard pity at 60
  const soft = Math.min(2.8, 1 + dryOpens / 40);
  const boosted = table.map(([q, p]) => {
    if (q === "red") return [q, p * soft];
    if (q === "gold") return [q, p * (1 + (soft - 1) * 0.4)];
    return [q, p];
  });
  const sum = boosted.reduce((s, [, p]) => s + p, 0);
  let r = Math.random() * sum;
  for (const [q, p] of boosted) {
    r -= p;
    if (r <= 0) return q;
  }
  return boosted[boosted.length - 1][0];
}

export function applyLoot(result) {
  const { item, isRed, crate, quality } = result;
  const q = quality || qualityOf(item);
  const stash = loadStash();
  const codex = loadCodex();
  const now = Date.now();

  touchDailyStats(stash);
  stash.opens = (stash.opens || 0) + 1;
  stash.opensToday = (stash.opensToday || 0) + 1;
  stash.hafCoins = (stash.hafCoins || 0) + (item.value || 0);
  stash.hafCoinsToday = (stash.hafCoinsToday || 0) + (item.value || 0);
  if (isRed || q === "red") {
    stash.opensSinceRed = 0;
    recordRedToday(stash, item, now);
  } else stash.opensSinceRed = (stash.opensSinceRed || 0) + 1;

  const prev = stash.items[item.id] || {
    count: 0,
    name: item.name,
    quality: q,
  };
  prev.count = (prev.count || 0) + 1;
  prev.name = item.name;
  prev.quality = q;
  prev.tier = item.tier || null;
  prev.value = item.value;
  prev.slots = item.slots;
  prev.lastAt = now;
  if (!prev.firstAt) prev.firstAt = now;
  stash.items[item.id] = prev;

  stash.history.unshift({
    at: now,
    id: item.id,
    name: item.name,
    quality: q,
    tier: item.tier || null,
    value: item.value,
    crate,
    isRed: q === "red",
  });
  stash.history = stash.history.slice(0, 40);

  let firstFind = false;
  if (q === "red" && codex.entries[item.id]) {
    const ent = codex.entries[item.id];
    if (!ent.found) {
      ent.found = true;
      ent.firstAt = now;
      firstFind = true;
    }
    ent.count = (ent.count || 0) + 1;
    codex.entries[item.id] = ent;
  }

  if (q === "red") {
    stash.dupRedsSinceNew = firstFind ? 0 : (stash.dupRedsSinceNew || 0) + 1;
  }

  saveStash(stash);
  saveCodex(codex);

  const payload = {
    at: now,
    crate,
    crateLabel: crateLabel(crate),
    item: { ...item, quality: q },
    quality: q,
    isRed: q === "red",
    firstFind,
    forcedPity: !!result.forcedPity,
    forcedNewRed: !!result.forcedNewRed,
    opens: stash.opens,
    opensSinceRed: stash.opensSinceRed,
    dupRedsSinceNew: stash.dupRedsSinceNew || 0,
    pity: PITY_REDS,
    dupRedPity: DUP_RED_PITY,
  };
  atomicWrite(LAST_LOOT, payload);
  return payload;
}

export function openCrate(toolCount = 0) {
  return applyLoot(rollItem(toolCount));
}

export function awardCrate(toolCount = 0) {
  const stash = loadStash();
  const crate = crateTierFromTools(toolCount);
  const entry = {
    id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    crate,
    crateLabel: crateLabel(crate),
    tools: Math.max(0, Number(toolCount) || 0),
    at: Date.now(),
  };
  stash.pendingCrates.push(entry);
  saveStash(stash);
  return { ...entry, pending: stash.pendingCrates.length };
}

export function openPendingCrate() {
  const stash = loadStash();
  if (!stash.pendingCrates.length) {
    return { empty: true, pending: 0, quality: "white" };
  }
  const entry = stash.pendingCrates.shift();
  saveStash(stash);
  const loot = applyLoot(
    rollItem(entry.tools || 0, { crate: entry.crate, stash: loadStash() }),
  );
  return {
    empty: false,
    pending: loadStash().pendingCrates.length,
    awarded: entry,
    ...loot,
  };
}

export function pendingCount() {
  return loadStash().pendingCrates.length;
}

export function bubbleTextForAward(award) {
  const box = award.crateLabel || "手提箱";
  const n = award.pending ?? pendingCount();
  return `入库「${box}」待开 x${n}`;
}

export function bubbleMetaForLoot(loot) {
  if (loot.empty) {
    return { text: "没有待开的箱子", quality: "white", value: 0 };
  }
  const q = loot.quality || qualityOf(loot.item);
  const label = QUALITY_LABEL[q] || "?";
  const box = loot.crateLabel || loot.awarded?.crateLabel || "手提箱";
  const name = loot.item?.name || "?";
  const val = formatHaf(loot.item?.value);
  const pity = loot.forcedPity ? "保底 " : "";
  const newForce = loot.forcedNewRed ? "图鉴保底 " : "";
  const star = loot.firstFind ? "NEW " : "";
  const left = typeof loot.pending === "number" ? ` ·剩${loot.pending}` : "";
  const text = `${pity}${newForce}开箱「${box}」【${label}】${star}${name} ≈${val}${left}`;
  return { text, quality: q, value: loot.item?.value || 0 };
}

export function bubbleTextForLoot(loot) {
  return bubbleMetaForLoot(loot).text;
}

export function getStats() {
  const stash = loadStash();
  const rows = Object.entries(stash.items).map(([id, it]) => ({ id, ...it }));
  const totalValue = rows.reduce((s, it) => s + (it.value || 0) * (it.count || 0), 0);
  const codex = loadCodex();
  const entries = Object.values(codex.entries || {});
  return {
    opensToday: stash.opensToday || 0,
    opens: stash.opens || 0,
    hafCoins: stash.hafCoins || 0,
    hafCoinsToday: stash.hafCoinsToday || 0,
    pending: (stash.pendingCrates || []).length,
    unique: rows.length,
    totalValue,
    opensSinceRed: stash.opensSinceRed || 0,
    pity: PITY_REDS,
    dupRedsSinceNew: stash.dupRedsSinceNew || 0,
    dupRedPity: DUP_RED_PITY,
    codexFound: entries.filter((e) => e.found).length,
    codexTotal: entries.length,
    redsToday: todayRedRows(stash).reduce((n, it) => n + (it.count || 0), 0),
    redsTodayRows: todayRedRows(stash),
  };
}

export function formatStatsHud() {
  const s = getStats();
  return `今开${s.opensToday} · 红${s.redsToday} · 累计${formatHaf(s.hafCoinsToday)} · 待开${s.pending}`;
}

export function formatStash(limit = 20) {
  const stash = loadStash();
  const rows = Object.entries(stash.items)
    .map(([id, it]) => ({ id, ...it }))
    .sort(compareStashRows);
  const shown = limit == null || limit < 0 ? rows : rows.slice(0, limit);
  const totalValue = rows.reduce((s, it) => s + (it.value || 0) * (it.count || 0), 0);
  const pending = stash.pendingCrates || [];
  const pendingByTier = {};
  for (const c of pending) {
    const k = c.crateLabel || c.crate || "?";
    pendingByTier[k] = (pendingByTier[k] || 0) + 1;
  }
  return {
    opens: stash.opens || 0,
    opensToday: stash.opensToday || 0,
    opensSinceRed: stash.opensSinceRed || 0,
    pity: PITY_REDS,
    dupRedsSinceNew: stash.dupRedsSinceNew || 0,
    dupRedPity: DUP_RED_PITY,
    unique: rows.length,
    totalValue,
    hafCoins: stash.hafCoins || 0,
    hafCoinsToday: stash.hafCoinsToday || 0,
    pending: pending.length,
    pendingByTier,
    pendingCrates: pending.slice(0, 20),
    rows: shown,
    history: (stash.history || []).slice(0, 8),
    redsToday: todayRedRows(stash).reduce((n, it) => n + (it.count || 0), 0),
    redsTodayRows: todayRedRows(stash),
  };
}

export function formatStashPanel() {
  const s = formatStash(null);
  const lines = [
    `【仓库】今开${s.opensToday} · 累计${formatHaf(s.hafCoinsToday)}`,
  ];
  if (!s.redsToday) {
    lines.push("今开红 无");
  } else {
    lines.push(`今开红 ${s.redsToday}`);
    for (const it of s.redsTodayRows) {
      lines.push(`红 ${it.name} x${it.count}`);
    }
  }
  lines.push(`种类${s.unique} · 在库≈${formatHaf(s.totalValue)} · 待开${s.pending}`);
  if (!s.rows.length) {
    lines.push("(空)");
  } else {
    for (const it of s.rows) {
      const q = QUALITY_LABEL[qualityOf(it)] || "?";
      lines.push(`${q} ${it.name} x${it.count}`);
    }
  }
  lines.push("单击切换 · 双击开箱");
  return lines.join("\n");
}

export function formatCodex() {
  const codex = loadCodex();
  const entries = Object.values(codex.entries || {});
  const total = entries.length;
  const found = entries.filter((e) => e.found).length;
  const byTier = { T0: [], T1: [], T2: [], T3: [], other: [] };
  for (const e of entries) {
    const t = e.tier || "other";
    if (!byTier[t]) byTier[t] = [];
    byTier[t].push(e);
  }
  for (const t of Object.keys(byTier)) {
    byTier[t].sort(
      (a, b) => Number(b.found) - Number(a.found) || a.name.localeCompare(b.name, "zh"),
    );
  }
  return { total, found, byTier, pct: total ? Math.round((found / total) * 100) : 0 };
}

export function formatCodexPanel() {
  const c = formatCodex();
  const lines = [`【图鉴】大红 ${c.found}/${c.total} (${c.pct}%)`];
  for (const tier of ["T0", "T1", "T2", "T3"]) {
    const list = c.byTier[tier] || [];
    if (!list.length) continue;
    const got = list.filter((e) => e.found).length;
    lines.push(`${tier} ${got}/${list.length}`);
    for (const e of list) {
      const mark = e.found ? "●" : "○";
      const lim = e.limited ? "*" : "";
      lines.push(`${mark}${e.name}${lim}`);
    }
  }
  lines.push("单击切换 · 双击开箱");
  return lines.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2] || "open";
  if (cmd === "award") {
    console.log(JSON.stringify(awardCrate(Number(process.argv[3] || 5)), null, 2));
  } else if (cmd === "open") {
    console.log(JSON.stringify(openPendingCrate(), null, 2));
  } else if (cmd === "stash") {
    console.log(JSON.stringify(formatStash(), null, 2));
  } else if (cmd === "codex") {
    console.log(JSON.stringify(formatCodex(), null, 2));
  } else if (cmd === "stats") {
    console.log(JSON.stringify(getStats(), null, 2));
  } else if (cmd === "hud") {
    console.log(formatStatsHud());
  } else if (cmd === "panel-stash") {
    console.log(formatStashPanel());
  } else if (cmd === "panel-codex") {
    console.log(formatCodexPanel());
  } else {
    console.error("usage: delta-loot <award|open|stash|codex|stats|hud|panel-stash|panel-codex> [tools]");
    process.exitCode = 1;
  }
}
