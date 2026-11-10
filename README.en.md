# petdex-overlay

> A desktop sidekick that opens blind boxes for your AI coding agent.

A floating Windows desktop pet. It listens to **Cursor** / **Kimi Code** hooks: it jumps when the agent starts thinking, runs back and forth while tools are being called, and banks a sealed crate every time a turn ends. Double-click the pet to open a crate, build up a warehouse, fill the codex, and lean on pity to land the red drops.

Compatible with the [petdex](https://petdex.dev) sprite format, and ships with an original sample pet, **Byte**. Fully local: no network calls, no code or conversation ever leaves the machine.

![preview](https://cdn.jsdelivr.net/gh/WU55UY/petdex-overlay@main/docs/preview.gif)

**Quick start**: `git clone https://github.com/WU55UY/petdex-overlay.git` → `powershell -ExecutionPolicy Bypass -File .\install.ps1` · [full install guide](#install) · Fully local, no network calls.

<p>
  <img alt="MIT" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Windows" src="https://img.shields.io/badge/platform-Windows%2010%2F11-0078D4">
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-339933">
  <img alt="Python" src="https://img.shields.io/badge/python-3.10%2B-3776AB">
</p>

[中文 README](README.md)

---

## How it works

```
Cursor / Kimi Code
      │  hook events (prompt / tool / stop)
      ▼
  bridge.mjs  ──►  %USERPROFILE%\.petdex\runtime\*.json
      │                         │
      │                         ▼
      └──►  loot.mjs       Python + Win32 floating layer
             (crates/stash/codex)   (per-pixel alpha, always-on-top, draggable)
```

- **State mapping**: prompt → jump; PreToolUse → run; PostToolUse → stop; Notification → waiting; Stop → wave and bank a crate.
- **Blind boxes**: at the end of every turn, the tool-call count decides the crate tier (briefcase / small safe / vault). Double-click to open one; nothing opens by itself.
- **Warehouse and codex**: six qualities (white / green / blue / purple / gold / red) and a 115-entry red codex, with soft pity, a 60-crate hard pity, and a duplicate-red guard.
- **Multi-window**: counted per `conversation_id` / `session_id`, so several IDE windows share one pet; as long as any tool is still running, the pet stays busy.
- **Tray panel**: click cycles 仓库 (warehouse) → 图鉴 (codex) → 阅读 (reader) → closed; the wheel flips pages; right-click closes, drag moves.
- **petdex compatible**: 8 columns × 9 rows, 192×208 spritesheets; pets from the petdex gallery can be imported as-is.
- **Local-first**: all state lives in `%USERPROFILE%\.petdex\`; there are no network requests.

## Requirements

| Dependency | Notes |
|------------|-------|
| Windows 10 / 11 | the floating layer uses a Win32 layered window |
| Node.js 18+ | hook bridge, CLI, and the crate engine |
| Python 3.10+ | renders the floating layer |
| Pillow + pywin32 | `python -m pip install pillow pywin32` |
| Cursor and/or Kimi Code | a version that supports hooks |

## Install

```powershell
git clone https://github.com/WU55UY/petdex-overlay.git
cd petdex-overlay
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer will:

1. copy the runtime into `%USERPROFILE%\.petdex\overlay\`;
2. seed the sample pet and the loot catalog on first install, **without touching an existing save**;
3. detect local Cursor / Kimi Code and merge the hook config (backing up the original first);
4. install the Cursor `/petdex` slash command;
5. check the Python dependencies and start the pet.

Common flags:

```powershell
# Cursor only, do not start the pet
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Agents cursor -NoStart

# Cursor + Kimi Code
powershell -ExecutionPolicy Bypass -File .\install.ps1 -Agents cursor,kimi
```

> Restart the IDE once after installing so the hooks are picked up. Verify with:

```powershell
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" doctor
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" status
```

### Manual install (no script)

1. Copy `overlay/` into `%USERPROFILE%\.petdex\overlay\`, then copy `hooks/bridge.mjs` and `hooks/delay-down.mjs` into the same folder.
2. Copy `data/items.json` to `%USERPROFILE%\.petdex\delta\items.json`.
3. Copy `pets/sample/` to `%USERPROFILE%\.petdex\pets\sample\` and create `active.json`: `{"slug":"sample"}`.
4. Merge the hook config following [`integrations/cursor`](integrations/cursor) or [`integrations/kimi`](integrations/kimi), replacing the paths with your own absolute paths.

## Usage

```powershell
$pet = "$env:USERPROFILE\.petdex\overlay\petdex.mjs"
node $pet up          # start by hand (does not exit with the IDE)
node $pet down        # stop the pet and the watchdog
node $pet status      # runtime state, active pet, warehouse summary
node $pet doctor      # environment self-check
node $pet list        # installed pets
node $pet select boba # switch pets
node $pet open        # open one pending crate (same as double-click)
node $pet open all    # open everything
node $pet stash       # print the warehouse
node $pet codex       # print the red-item codex
node $pet stats       # crate statistics
node $pet panel codex # pop the codex panel under the pet
```

| Mouse | Action |
|-------|--------|
| drag | move the pet |
| click (280 ms debounce) | cycle: no panel → warehouse → codex → reader → none |
| double-click | open one pending crate |
| wheel | flip pages in warehouse / codex / reader |
| right-click | close the overlay |

HUD: `今开N · 红N · 累计N · 待开N` (opened today · reds · total · pending).

## Pets

The repo ships `pets/sample` (Byte), an original cat blob. To use a pet from the petdex gallery:

```powershell
# install it with the official petdex CLI into ~/.codex/pets/your-slug
npx petdex install boba

# import into petdex-overlay
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" add "$env:USERPROFILE\.codex\pets\boba"
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" select boba
```

You can also drop a pet folder straight into `%USERPROFILE%\.petdex\pets\your-slug\` and `select` it.

### Submitting to the Petdex gallery

[petdex](https://petdex.dev) is the gallery for pet **asset packs**; this repository
is an independent Windows client that reads that format. The two complement each
other but are not affiliated. Submissions enter an admin queue, and approval or
rejection is emailed (a rejection includes the reason). `petdex edit` opens a pending edit that re-enters
the queue, so do not create a duplicate `submit` (rate-limited to 10 / 24h).

```sh
npx petdex login                                        # OAuth; token in OS keychain
npx petdex submit ~/.codex/pets/tempest --license LICENSE_ID
npx petdex edit tempest --desc "..."                     # also --displayName / --meta / --sprite
```

**Field limits**: `displayName` ≤ 60 characters, `description` ≤ 280, `tags`
comma-separated. Spritesheets use an 8×9 or 8×11 atlas, ≥256×256, with 1536×1872
recommended. The nine official states are `idle` / `running-right` /
`running-left` / `waving` / `jumping` / `failed` / `waiting` / `running` /
`review` — the same nine rows as the table below.

Ready-to-paste description (`243 characters`, covering states, personality,
provenance and the unofficial disclaimer):

```
Tempest — chibi fan-art pet of the orange-haired Delta Force operator. 9 states: idle, run L/R, wave, jump, fail, wait, run, review. Calm under fire, quietly smug after a long tool call. 8x9 atlas. Unofficial; not affiliated with Tencent/TiMi.
```

Suggested tags: `delta-force, fan-art, chibi, tempest, agent-pet`.

**Attribution** (see section 4 of [NOTICE](NOTICE.md)): `credit` comes from the
verified OAuth identity and is never trusted from the request body, so the
unofficial disclaimer belongs in `description`. `license` is a per-pet field and
`unspecified` is the honest default — pick from `cc0`, `cc-by`, `cc-by-sa`,
`cc-by-nc` or `all-rights-reserved` yourself rather than letting a tool choose
rights on your behalf. Character and
names belong to their holders; Petdex runs a
[takedown process](https://petdex.dev/legal/takedown) that we comply with.

Once approved, the gallery and this client cross-link in one command:

```powershell
npx petdex install your-slug
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" add "$env:USERPROFILE\.codex\pets\your-slug"
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" select your-slug
```

### Sprite format

```
pets/your-slug/
├── pet.json            # id / displayName / description / spritesheetPath
└── spritesheet.png     # 8 columns × 9 rows, 192×208 per frame (.webp also works)
```

| Row | State | Used for |
|-----|-------|----------|
| 0 | idle | nothing happening |
| 1 | running-right | tool calls (running right) |
| 2 | running-left | tool calls (running left) |
| 3 | waving | turn finished / crate opened |
| 4 | jumping | user submitted a prompt |
| 5 | failed | errors |
| 6 | waiting | waiting for user confirmation |
| 7 | running | working |
| 8 | review | reviewing |

Sample generator: `python tools/make-sample-pet.py` (needs Pillow). Change the colors or the face and re-run.

## Loot rules

The tool count decides the crate tier:

| Tool calls this turn | Crate | Base red chance |
|----------------------|-------|-----------------|
| 0–2 | briefcase | 0.5% |
| 3–9 | small safe | 1% |
| 10+ | vault | 3% |

Full quality table (white / green / blue / purple / gold / red):

| Crate | White | Green | Blue | Purple | Gold | Red |
|-------|-------|-------|------|--------|------|-----|
| briefcase | 40% | 32% | 18% | 7% | 2.5% | 0.5% |
| small safe | 15% | 25% | 32% | 18% | 9% | 1% |
| vault | 4% | 10% | 22% | 38% | 23% | 3% |

Pity:

- **Soft pity**: while no red has dropped, the red weight grows as `1 + streak/40`, capped at 2.8×; gold receives 40% of the same bonus.
- **Hard pity**: after 60 crates without a red, the next crate is guaranteed red.
- **Duplicate guard**: if the last two reds were already in the codex, the next red is guaranteed to be new.
- **New-codex bias**: on a red, unlit entries weigh ×3.5 and already-lit ones ×0.45; T0 counts ×0.35 more and limited items ×0.5.

The loot catalog is `data/items.json` and can be swapped wholesale for your own theme (keep `items[]`, `quality`, `value`, `tier`). Progress lives in `%USERPROFILE%\.petdex\delta\`.

> The bundled catalog is *Delta Force* (《三角洲行动》) fan-collected data (521 entries) for a local fan toy; names and values belong to Tencent / TiMi. This project is not affiliated with them. Swap `items.json` after installing if you would rather not use it.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `PETDEX_HOME` | `%USERPROFILE%\.petdex` | data and runtime root |
| `PETDEX_PYTHONW` | auto-detected | which `pythonw.exe` to use |
| `PETDEX_NODE` | auto-detected | which `node.exe` Python uses for panels |
| `PETDEX_AGENT_PROCESSES` | `Cursor,Kimi Code,ZCode` | process names that mean "the IDE is still open", comma separated |
| `PETDEX_NO_SPAWN` | unset | set to `1` to never actually launch the floating layer (testing) |
| `PETDEX_AUTO_EXIT` | set to `1` by hooks | exit 12 s after no IDE process is found; manual `up` leaves it unset |

Pause the hooks without deleting the config:

```powershell
New-Item -ItemType File -Force "$env:USERPROFILE\.petdex\runtime\hooks-disabled"
```

Delete the file to resume.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| the pet never shows up | `node ...\petdex.mjs doctor`; check `%USERPROFILE%\.petdex\runtime\overlay.log`; make sure `python -c "import PIL, win32gui"` works |
| `pythonw.exe not found` | install Python and tick Add to PATH, or `python -m pip install pillow pywin32` |
| the IDE reacts but the pet does not move | check `runtime\boot.log` for hook events; restart the IDE; confirm `bridge.mjs` is in `hooks.json` / `config.toml` |
| the pet hides behind the wallpaper | some Wallpaper Engine scenes are also topmost; make the wallpaper non-topmost, or right-click the pet to restart |
| right-clicked it away and it stays gone | hook-managed instances restart on the next prompt / workspaceOpen; or run `up` manually |
| several windows, one pet | by design: one pet per machine, inflight counted per session |

Logs:

- `runtime\overlay.log` — Python overlay stderr
- `runtime\boot.log` — hook events and crate awards
- `runtime\watchdog.log` — IDE lifecycle

## Uninstall

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

By default the pet, warehouse, and codex are kept; only hooks and the runtime are removed. To wipe everything:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -PurgeData
```

## Layout

```
petdex-overlay/
├── install.ps1 / uninstall.ps1
├── overlay/
│   ├── petdex_overlay.py      # Win32 layered window + per-pixel alpha rendering
│   ├── petdex.mjs             # CLI: up/down/open/panel/doctor...
│   ├── bridge-core.mjs        # hook event state machine
│   ├── loot.mjs               # crate algorithm + warehouse/codex
│   ├── novel.mjs              # local txt reader panel
│   └── watchdog.mjs           # follows the IDE lifecycle
├── hooks/
│   ├── bridge.mjs             # stdin + lock + call into the core
│   └── delay-down.mjs         # prevents killing the pet when one window closes
├── integrations/
│   ├── cursor/                # hooks.json fragment + /petdex command
│   └── kimi/                  # config.toml fragment
├── data/items.json            # 521 loot entries
├── pets/sample/               # original sample pet
├── tools/                     # spritesheet generator / preview renderer
├── tests/                     # loot + bridge + CLI tests
└── docs/                      # README assets
```

## Tests

```powershell
npm test
npm run check   # tests + a CLI smoke check
# or, where a test runner subprocess is not available, run them separately:
node tests/loot.test.mjs
node tests/bridge.test.mjs
node tests/petdex.test.mjs
```

The tests run in temporary directories and never touch `%USERPROFILE%\.petdex`.

## Privacy

- The hook only reads `conversation_id` / `session_id` / `reason` and tool-call counts; prompts, code, and file contents are never stored.
- No network requests; pets, warehouse, codex, and reading progress stay local.
- If `bridge.mjs` fails it exits silently, so it can never block the IDE.

## Credits / License

- The sprite format and the [petdex](https://github.com/crafter-station/petdex) ecosystem come from Crafter Station (MIT). This project is an independent Windows client, not an official one.
- The bundled *Delta Force* loot data is fan-collected; rights belong to the original rights holders and it is meant for local entertainment.
- The sample pet Byte and all code are released under MIT by this project.

Code: [MIT](LICENSE). Third-party notes: [NOTICE.md](NOTICE.md).
