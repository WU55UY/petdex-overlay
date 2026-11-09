#!/usr/bin/env node
/**
 * petdex-overlay CLI — up / down / status / select / add / loot / panel / doctor
 *
 * The overlay itself is a tiny Python + Win32 process; this CLI owns lifecycle,
 * runtime state files, and the blind-box commands used by agent hooks.
 *
 * Usage: node petdex.mjs <command> [args...]
 */
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const ROOT = process.env.PETDEX_HOME
  ? join(process.env.PETDEX_HOME)
  : join(homedir(), ".petdex");
const OVERLAY_DIR = join(ROOT, "overlay");
const PETS = join(ROOT, "pets");
const RUNTIME = join(ROOT, "runtime");
const DELTA = join(ROOT, "delta");
const ACTIVE = join(ROOT, "active.json");
const OVERLAY_PY = join(OVERLAY_DIR, "petdex_overlay.py");
const CLI = join(OVERLAY_DIR, "petdex.mjs");
const WATCHDOG = join(OVERLAY_DIR, "watchdog.mjs");
const OVERLAY_PID = join(ROOT, "overlay.pid");
const WATCHDOG_PID = join(ROOT, "watchdog.pid");
const PANEL_PATH = join(RUNTIME, "panel.json");

const NO_SPAWN = process.env.PETDEX_NO_SPAWN === "1";
const WATCHDOG_SELF = process.env.PETDEX_WATCHDOG_SELF === "1";
const MANAGED_MARKER = join(RUNTIME, "managed");
const AGENT_PROCESSES =
  process.env.PETDEX_AGENT_PROCESSES || "Cursor,Kimi Code,ZCode";

const SPRITE_NAMES = [
  "spritesheet.webp",
  "spritesheet.png",
  "sprite.webp",
  "sprite.png",
];

function say(msg) {
  process.stdout.write(`${msg}\n`);
}

function readJson(path, fallback = {}) {
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

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(path) {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isFinite(pid) && pid > 0 && isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

function runPowerShell(query, timeout = 8000) {
  // Write to a file instead of capturing a pipe: works under restricted
  // environments where child-process pipes are unavailable.
  const file = join(tmpdir(), `petdex-ps-${process.pid}-${Date.now()}.txt`);
  try {
    rmSync(file, { force: true });
    const wrapped = `& { ${query} } | Out-File -FilePath '${file.replace(/'/g, "''")}' -Encoding utf8`;
    spawnSync("powershell.exe", ["-NoProfile", "-Command", wrapped], {
      stdio: "ignore",
      windowsHide: true,
      timeout,
    });
    return readFileSync(file, "utf8");
  } catch {
    return "";
  } finally {
    rmSync(file, { force: true });
  }
}

function findOverlayPids() {
  if (process.platform !== "win32") return [];
  const out = runPowerShell(
    "Get-CimInstance Win32_Process -Filter \"Name='pythonw.exe' OR Name='python.exe'\" | Where-Object { $_.CommandLine -match 'petdex_overlay' } | Select-Object -ExpandProperty ProcessId",
  );
  return out
    .split(/\r?\n/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function findWatchdogPid() {
  return readPid(WATCHDOG_PID);
}

export function findPythonw() {
  const fromEnv = process.env.PETDEX_PYTHONW;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const candidates = [];
  const local = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
  const pyRoots = [
    join(local, "Programs", "Python"),
    join(homedir(), "miniconda3"),
    join(homedir(), "anaconda3"),
    join(local, "miniconda3"),
    join(local, "anaconda3"),
    "C:\\Python312",
    "C:\\Python313",
    "C:\\Python314",
  ];
  for (const root of pyRoots) {
    if (!existsSync(root)) continue;
    try {
      for (const name of readdirSync(root)) {
        const p = join(root, name, "pythonw.exe");
        if (existsSync(p)) candidates.push(p);
      }
    } catch {
      /* ignore */
    }
    const p = join(root, "pythonw.exe");
    if (existsSync(p)) candidates.push(p);
  }
  for (const p of candidates) {
    if (p.toLowerCase().endsWith("pythonw.exe")) return p;
  }

  const wh = spawnSync("where.exe", ["pythonw"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const line = (wh.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find(Boolean);
  return line && existsSync(line) ? line : null;
}

export function pythonDepsOk(pyw) {
  if (!pyw) return false;
  // pythonw.exe has no reliable exit status for `-c`, so prefer python.exe.
  const python = join(dirname(pyw), "python.exe");
  if (existsSync(python)) {
    const out = spawnSync(python, ["-c", "import PIL, win32gui, win32con"], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 15000,
    });
    return out.status === 0;
  }
  const marker = join(tmpdir(), `petdex-deps-${process.pid}-${Date.now()}.txt`);
  try {
    rmSync(marker, { force: true });
    const code = `import PIL, win32gui, win32con\nopen(${JSON.stringify(marker)}, "w").write("ok")`;
    spawnSync(pyw, ["-c", code], { stdio: "ignore", windowsHide: true, timeout: 15000 });
    return existsSync(marker);
  } finally {
    rmSync(marker, { force: true });
  }
}

function resetRuntime() {
  mkdirSync(RUNTIME, { recursive: true });
  const sessionPath = join(RUNTIME, "session.json");
  let session = { seq: 0 };
  try {
    session = { ...session, ...JSON.parse(readFileSync(sessionPath, "utf8")) };
  } catch {
    /* first run */
  }
  session.inflight = 0;
  session.toolsThisTurn = 0;
  session.byId = {};
  session.seq = (session.seq || 0) + 1;
  atomicWrite(join(RUNTIME, "state.json"), {
    state: "idle",
    duration: null,
    updatedAt: Date.now(),
    counter: session.seq,
  });
  session.seq += 1;
  atomicWrite(join(RUNTIME, "bubble.json"), {
    text: "",
    agent_source: "cli",
    updatedAt: Date.now(),
    counter: session.seq,
  });
  session.seq += 1;
  atomicWrite(sessionPath, session);
}

function startWatchdog() {
  if (NO_SPAWN || WATCHDOG_SELF) return;
  if (findWatchdogPid()) return;
  if (!existsSync(WATCHDOG)) return;
  const child = spawn(process.execPath, [WATCHDOG], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, PETDEX_HOME: ROOT },
  });
  child.unref();
}

function up({ managed = false } = {}) {
  mkdirSync(OVERLAY_DIR, { recursive: true });
  mkdirSync(RUNTIME, { recursive: true });

  const existing = readPid(OVERLAY_PID) || findOverlayPids()[0];
  if (existing) {
    if (managed) {
      mkdirSync(RUNTIME, { recursive: true });
      writeFileSync(MANAGED_MARKER, "1", "utf8");
      startWatchdog();
    }
    say(`● overlay already running (pid ${existing})`);
    return true;
  }
  if (!existsSync(OVERLAY_PY)) {
    say(`✗ missing ${OVERLAY_PY} — run install.ps1 first`);
    process.exitCode = 1;
    return false;
  }
  if (NO_SPAWN) {
    say(`○ [dry-run] would start overlay (managed=${managed})`);
    return true;
  }

  const pyw = findPythonw();
  if (!pyw) {
    say("✗ pythonw.exe not found");
    say("  Install Python 3.10+ and run: python -m pip install pillow pywin32");
    process.exitCode = 1;
    return false;
  }
  if (!pythonDepsOk(pyw)) {
    say(`✗ ${pyw} is missing Pillow / pywin32`);
    say("  Run: python -m pip install pillow pywin32");
    process.exitCode = 1;
    return false;
  }

  const logPath = join(RUNTIME, "overlay.log");
  let logFd = null;
  try {
    logFd = openSync(logPath, "a");
  } catch {
    /* logging is optional */
  }
  const child = spawn(pyw, [OVERLAY_PY], {
    detached: true,
    stdio: ["ignore", "ignore", logFd === null ? "ignore" : logFd],
    windowsHide: true,
    env: {
      ...process.env,
      PETDEX_HOME: ROOT,
      PETDEX_AUTO_EXIT: managed ? "1" : "0",
      PETDEX_AGENT_PROCESSES: AGENT_PROCESSES,
      PYTHONUNBUFFERED: "1",
    },
  });
  child.unref();
  if (logFd !== null) closeSync(logFd);

  resetRuntime();
  mkdirSync(RUNTIME, { recursive: true });
  if (managed) writeFileSync(MANAGED_MARKER, "1", "utf8");
  else rmSync(MANAGED_MARKER, { force: true });
  if (managed) startWatchdog();
  say(`✓ overlay started (pid ${child.pid}${managed ? ", managed" : ""})`);
  return true;
}

function down() {
  const pids = new Set(findOverlayPids());
  const pid = readPid(OVERLAY_PID);
  if (pid) pids.add(pid);
  for (const p of pids) {
    try {
      process.kill(p);
    } catch {
      /* already gone */
    }
  }
  try {
    rmSync(OVERLAY_PID, { force: true });
    rmSync(MANAGED_MARKER, { force: true });
  } catch {
    /* ignore */
  }

  let stoppedWatchdog = null;
  if (!WATCHDOG_SELF) {
    stoppedWatchdog = findWatchdogPid();
    if (stoppedWatchdog) {
      try {
        process.kill(stoppedWatchdog);
      } catch {
        /* ignore */
      }
      rmSync(WATCHDOG_PID, { force: true });
    }
  }
  say(
    pids.size || stoppedWatchdog
      ? `✓ overlay stopped${pids.size ? ` (${[...pids].join(", ")})` : ""}`
      : "○ overlay was not running",
  );
}

function toggle() {
  if (readPid(OVERLAY_PID) || findOverlayPids().length) down();
  else up();
}

function listPets() {
  mkdirSync(PETS, { recursive: true });
  return readdirSync(PETS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((slug) =>
      SPRITE_NAMES.some((n) => existsSync(join(PETS, slug, n))),
    );
}

function activePet() {
  const slug = String(readJson(ACTIVE, {}).slug || "");
  if (slug && listPets().includes(slug)) return slug;
  return listPets()[0] || "";
}

async function lootApi() {
  return import(pathToFileURL(join(OVERLAY_DIR, "loot.mjs")).href);
}

async function novelApi() {
  return import(pathToFileURL(join(OVERLAY_DIR, "novel.mjs")).href);
}

async function status() {
  const pid = readPid(OVERLAY_PID) || findOverlayPids()[0] || null;
  const wd = findWatchdogPid();
  say(pid ? `● overlay running (pid ${pid})` : "○ overlay not running");
  if (wd) say(`  watchdog: running (pid ${wd})`);
  say(`  home: ${ROOT}`);
  say(`  active pet: ${activePet() || "(none)"}`);
  const pets = listPets();
  say(`  installed pets: ${pets.length ? pets.join(", ") : "(none)"}`);
  try {
    const st = readJson(join(RUNTIME, "state.json"));
    const bub = readJson(join(RUNTIME, "bubble.json"));
    say(`  state: ${st.state || "(none)"}  bubble: ${JSON.stringify(bub.text || "")}`);
  } catch {
    /* ignore */
  }
  try {
    const { formatStatsHud, getStats } = await lootApi();
    const s = getStats();
    say(`  ${formatStatsHud()}`);
    say(`  图鉴: ${s.codexFound}/${s.codexTotal}  待开: ${s.pending}`);
  } catch {
    say("  loot: (catalog not installed yet)");
  }
}

async function pushOverlayBubble(
  text,
  state = "waving",
  duration = 5000,
  quality = "white",
) {
  try {
    mkdirSync(RUNTIME, { recursive: true });
    const sessionPath = join(RUNTIME, "session.json");
    const session = readJson(sessionPath, { seq: 0 });
    session.lootHoldUntil = Date.now() + (duration || 0);
    session.seq = (session.seq || 0) + 1;
    atomicWrite(join(RUNTIME, "bubble.json"), {
      text,
      quality: quality || "white",
      agent_source: "cli",
      updatedAt: Date.now(),
      counter: session.seq,
    });
    session.seq += 1;
    atomicWrite(join(RUNTIME, "state.json"), {
      state,
      duration,
      updatedAt: Date.now(),
      counter: session.seq,
    });
    atomicWrite(sessionPath, session);
  } catch {
    /* overlay is optional */
  }
}

async function cmdOpen(arg) {
  const {
    openPendingCrate,
    awardCrate,
    bubbleMetaForLoot,
    pendingCount,
  } = await lootApi();

  if (arg === "force" || arg === "roll") {
    const tools = Number(process.argv[4] || 8);
    awardCrate(Number.isFinite(tools) ? tools : 8);
  }
  if (pendingCount() === 0 && arg !== "force" && arg !== "roll") {
    say("○ 没有待开的箱子（Agent 结束后会入库）");
    await pushOverlayBubble("没有待开的箱子", "idle", null, "white");
    return;
  }

  const n = arg === "all" ? Math.max(1, pendingCount()) : 1;
  let opened = 0;
  for (let i = 0; i < n; i++) {
    if (pendingCount() === 0) break;
    const loot = openPendingCrate();
    if (loot.empty) break;
    opened += 1;
    const meta = bubbleMetaForLoot(loot);
    say(`✓ ${meta.text}`);
    say(`  【${loot.quality || "?"}】${loot.item.name}  ≈${loot.item.value}`);
    if (loot.firstFind) say("  ★ 图鉴新点亮！");
    await pushOverlayBubble(meta.text, "waving", 5000, meta.quality);
  }
  if (arg === "all") say(`共开启 ${opened} 个箱子，剩余 ${pendingCount()}`);
}

async function cmdAward(toolsArg) {
  const { awardCrate, bubbleTextForAward } = await lootApi();
  const tools = Number(toolsArg || 5);
  const award = awardCrate(Number.isFinite(tools) ? tools : 5);
  say(`✓ ${bubbleTextForAward(award)}`);
  await pushOverlayBubble(bubbleTextForAward(award), "waving", 3500);
}

async function cmdStash() {
  const { formatStash, formatStatsHud } = await lootApi();
  const s = formatStash(30);
  say(formatStatsHud());
  say(`待开箱子: ${s.pending}`);
  if (s.pending > 0) {
    for (const [k, v] of Object.entries(s.pendingByTier || {})) {
      say(`  ${k} x${v}`);
    }
  }
  say(`仓库物品  累计收货≈${s.hafCoins}  在库估值≈${s.totalValue}`);
  say(`种类${s.unique}  总开箱${s.opens}  保底 ${s.opensSinceRed}/${s.pity}`);
  if (!s.rows.length) {
    say("(物品空)");
  } else {
    for (const it of s.rows) {
      const q = it.quality || (it.tier ? "red" : "?");
      say(`  【${q}】 ${it.name} x${it.count}  ≈${(it.value || 0) * (it.count || 0)}`);
    }
  }
  if (s.history?.length) {
    say("最近开箱:");
    for (const h of s.history) {
      const q = h.quality || (h.isRed ? "red" : "?");
      say(`  【${q}】 ${h.name} ← ${h.crate}`);
    }
  }
  writePanel("stash", await panelTextFor("stash"), "purple");
}

async function cmdCodex() {
  const { formatCodex } = await lootApi();
  const c = formatCodex();
  say(`大红图鉴 ${c.found}/${c.total} (${c.pct}%)`);
  for (const tier of ["T0", "T1", "T2", "T3"]) {
    const list = c.byTier[tier] || [];
    const got = list.filter((e) => e.found).length;
    say(`\n${tier}  ${got}/${list.length}`);
    for (const e of list) {
      const mark = e.found ? "●" : "○";
      const lim = e.limited ? " [限定]" : "";
      say(`  ${mark} ${e.name}${lim}${e.found ? ` x${e.count}` : ""}`);
    }
  }
  writePanel("codex", await panelTextFor("codex"), "red");
}

async function cmdStats() {
  const { getStats, formatStatsHud } = await lootApi();
  const s = getStats();
  say(formatStatsHud());
  say(`总开箱 ${s.opens}  在库种类 ${s.unique}  在库估值≈${s.totalValue}`);
  say(`图鉴 ${s.codexFound}/${s.codexTotal}  保底 ${s.opensSinceRed}/${s.pity}`);
}

function readPanelState() {
  return readJson(PANEL_PATH, { mode: "none" });
}

function writePanel(mode, text = "", quality = "white") {
  mkdirSync(RUNTIME, { recursive: true });
  const prev = readPanelState();
  atomicWrite(PANEL_PATH, {
    mode,
    text: text || "",
    quality: quality || "white",
    at: Date.now(),
    counter: (Number(prev.counter) || 0) + 1,
  });
}

function panelQuality(mode) {
  if (mode === "codex") return "red";
  if (mode === "novel") return "white";
  return "purple";
}

async function panelTextFor(mode, pageDelta = 0) {
  if (mode === "novel") {
    const { formatNovelPanel } = await novelApi();
    return formatNovelPanel(pageDelta);
  }
  const { formatStashPanel, formatCodexPanel } = await lootApi();
  if (mode === "codex") return formatCodexPanel();
  return formatStashPanel();
}

async function cmdPanel(arg) {
  const order = ["none", "stash", "codex", "novel"];
  let mode = arg;
  let pageDelta = 0;
  if (arg === "novel-next" || arg === "next") {
    mode = "novel";
    pageDelta = 1;
  } else if (arg === "novel-prev" || arg === "prev") {
    mode = "novel";
    pageDelta = -1;
  } else if (!mode || mode === "cycle") {
    const cur = readPanelState().mode || "none";
    const i = order.indexOf(cur);
    mode = order[(i < 0 ? 0 : i + 1) % order.length];
  }
  if (!order.includes(mode)) mode = "stash";
  if (mode === "none") {
    writePanel("none", "", "white");
    say("○ 面板已关闭");
    return;
  }
  const text = await panelTextFor(mode, pageDelta);
  const quality = panelQuality(mode);
  say(text);
  writePanel(mode, text, quality);
}

function normalizePetDir(srcDir, destDir, slug) {
  mkdirSync(destDir, { recursive: true });
  const names = readdirSync(srcDir);
  let spriteSrc = null;
  for (const n of SPRITE_NAMES) {
    if (names.includes(n)) {
      spriteSrc = join(srcDir, n);
      break;
    }
  }
  if (!spriteSrc) return false;

  const ext = spriteSrc.toLowerCase().endsWith(".webp") ? ".webp" : ".png";
  const destSprite = join(destDir, `spritesheet${ext}`);
  cpSync(spriteSrc, destSprite);

  let meta = {
    id: slug,
    displayName: slug,
    description: "Installed with petdex-overlay",
    spritesheetPath: `spritesheet${ext}`,
  };
  if (names.includes("pet.json")) {
    try {
      const raw = JSON.parse(readFileSync(join(srcDir, "pet.json"), "utf8"));
      meta = {
        ...raw,
        id: raw.id || slug,
        displayName: raw.displayName || raw.name || slug,
        spritesheetPath: `spritesheet${ext}`,
      };
    } catch {
      /* keep defaults */
    }
  }
  writeFileSync(join(destDir, "pet.json"), JSON.stringify(meta, null, 2), "utf8");
  return true;
}

function cmdAdd(src) {
  if (!src) {
    say("usage: petdex add <path-to-pet-folder>");
    process.exitCode = 1;
    return;
  }
  const resolved = src.replace(/^~/, homedir());
  if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
    say(`✗ not a folder: ${resolved}`);
    process.exitCode = 1;
    return;
  }
  const slug = basename(resolved)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) {
    say("✗ could not derive a pet slug from the folder name");
    process.exitCode = 1;
    return;
  }
  if (listPets().includes(slug) && !process.argv.includes("--force")) {
    say(`✗ pet "${slug}" already exists (add --force to overwrite)`);
    process.exitCode = 1;
    return;
  }
  const dest = join(PETS, slug);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  if (!normalizePetDir(resolved, dest, slug)) {
    say("✗ no spritesheet.webp / spritesheet.png / sprite.* found");
    process.exitCode = 1;
    return;
  }
  say(`✓ installed pet "${slug}"`);
  if (!activePet()) select(slug);
}

function select(slug) {
  if (!slug) {
    const active = activePet();
    const pets = listPets();
    say(
      pets.length
        ? `installed:\n  ${pets.map((p) => (p === active ? `* ${p}` : `  ${p}`)).join("\n  ")}`
        : "no pets installed — run: petdex add <path>",
    );
    return;
  }
  if (!listPets().includes(slug)) {
    say(`✗ pet not found: ${slug}`);
    say(`  installed: ${listPets().join(", ") || "(none)"}`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(ACTIVE, JSON.stringify({ slug }, null, 0), "utf8");
  say(`✓ active pet set to ${slug}`);
  if (readPid(OVERLAY_PID) || findOverlayPids().length) {
    const managed = existsSync(MANAGED_MARKER);
    down();
    up({ managed });
  }
}

function cmdDoctor() {
  const ok = [];
  const warn = [];
  const fail = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  if (nodeMajor >= 18) ok.push(`Node ${process.versions.node}`);
  else fail.push(`Node ${process.versions.node} (need >= 18)`);

  if (existsSync(OVERLAY_PY) && existsSync(join(OVERLAY_DIR, "loot.mjs"))) {
    ok.push("overlay files present");
  } else {
    fail.push(`overlay files missing under ${OVERLAY_DIR}`);
  }

  const pyw = findPythonw();
  if (!pyw) fail.push("pythonw.exe not found");
  else if (pythonDepsOk(pyw)) ok.push(`Python deps OK (${pyw})`);
  else fail.push(`${pyw} missing Pillow/pywin32`);

  const pets = listPets();
  if (!pets.length) warn.push("no pet installed");
  else {
    const slug = activePet();
    ok.push(`pet: ${slug} (${pets.length} installed)`);
    const dir = join(PETS, slug);
    const sprite = SPRITE_NAMES.map((n) => join(dir, n)).find(existsSync);
    if (!sprite) fail.push(`${slug} has no spritesheet`);
  }

  try {
    const catalog = JSON.parse(readFileSync(join(DELTA, "items.json"), "utf8"));
    const n = Array.isArray(catalog.items) ? catalog.items.length : 0;
    if (n > 0) ok.push(`loot catalog: ${n} items`);
    else warn.push("loot catalog is empty");
  } catch {
    warn.push(`loot catalog missing (${join(DELTA, "items.json")})`);
  }

  for (const [name, config, pattern] of [
    ["Cursor", join(homedir(), ".cursor", "hooks.json"), /bridge\.mjs/],
    ["Kimi Code", join(homedir(), ".kimi-code", "config.toml"), /bridge\.mjs/],
  ]) {
    try {
      if (pattern.test(readFileSync(config, "utf8"))) ok.push(`${name} hooks installed`);
      else warn.push(`${name} hooks not installed`);
    } catch {
      warn.push(`${name} hooks not installed`);
    }
  }

  if (readPid(OVERLAY_PID) || findOverlayPids().length) ok.push("overlay running");
  else warn.push("overlay not running");

  for (const line of ok) say(`✓ ${line}`);
  for (const line of warn) say(`! ${line}`);
  for (const line of fail) say(`✗ ${line}`);
  if (fail.length) process.exitCode = 1;
}

function usage() {
  say("petdex-overlay — Windows desktop pet for Cursor / Kimi Code");
  say(`
Usage: node petdex.mjs <command> [args]

  up [--managed]     start the floating overlay (managed = auto-exit with the IDE)
  down               stop the overlay and watchdog
  toggle             start or stop
  status             runtime, active pet, loot summary
  list               installed pets
  select [slug]      show or switch the active pet
  add <folder>       install a petdex-format pet folder (--force to overwrite)
  open [all|force]   open one / all pending crates
  award [tools]      bank a sealed crate (hook test)
  stash | codex      print the warehouse / red-item codex
  stats              print loot counters
  panel [mode]       none | stash | codex | novel | cycle | next | prev
  novel              open the novel panel
  doctor             environment + installation check

Environment:
  PETDEX_HOME              data root (default: ~/.petdex)
  PETDEX_PYTHONW           pythonw.exe to use
  PETDEX_AGENT_PROCESSES   IDE process names (default: ${AGENT_PROCESSES})
  PETDEX_NO_SPAWN=1        dry-run: never launch the overlay
`);
}

async function main() {
  const cmd = process.argv[2] || "status";
  const arg = process.argv[3];
  const managed =
    process.argv.includes("--managed") || process.env.PETDEX_MANAGED === "1";

  switch (cmd) {
    case "up":
    case "start":
      up({ managed });
      break;
    case "down":
    case "stop":
      down();
      break;
    case "toggle":
      toggle();
      break;
    case "status":
      await status();
      break;
    case "list":
      say(listPets().join("\n") || "(none)");
      break;
    case "select":
      select(arg);
      break;
    case "add":
    case "install":
      cmdAdd(arg);
      break;
    case "open":
    case "loot":
      await cmdOpen(arg);
      break;
    case "award":
    case "crate":
      await cmdAward(arg);
      break;
    case "stash":
    case "bag":
    case "warehouse":
      await cmdStash();
      break;
    case "codex":
    case "dex":
    case "图鉴":
      await cmdCodex();
      break;
    case "novel":
    case "book":
    case "小说":
      await cmdPanel("novel");
      break;
    case "stats":
    case "stat":
      await cmdStats();
      break;
    case "panel":
    case "view":
      await cmdPanel(arg);
      break;
    case "doctor":
    case "check":
      cmdDoctor();
      break;
    case "help":
    case "-h":
    case "--help":
      usage();
      break;
    default:
      say(`unknown command: ${cmd}`);
      usage();
      process.exitCode = 1;
  }
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) await main();
