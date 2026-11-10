# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Process discovery is scoped to the current `PETDEX_HOME`: a second install
  (or a testbed) can no longer be reported as "running" by `status`/`doctor`,
  and `down`/`toggle` can no longer kill another install's pet.

### Added

- `tests/petdex.test.mjs` covering the install-scoped process filter.
- README (中文 / English): a "Submitting to the Petdex gallery" section with the
  official nine state names, field limits (displayName 60 / description 280),
  copy-ready description and tags, and a one-command round trip from the gallery
  back into this client once a submission is approved.
- `NOTICE.md` section 4: attribution and licensing rules for fan-art pet packs
  submitted to the gallery (credit is OAuth-bound, license is per-pet).
- README preview images now load from jsDelivr CDN, matching
  `dsh-pomodoro-box`, so they do not depend on `raw.githubusercontent.com`.

## [1.0.0] - 2026-11-06

First public release.

### Added

- Win32 layered floating pet with per-pixel alpha, always-on-top, drag to move,
  and per-monitor DPI-aware placement.
- Hook bridges for **Cursor** (`hooks.json`) and **Kimi Code** (`config.toml`),
  merged idempotently with timestamped backups by `install.ps1`.
- Event state machine (`overlay/bridge-core.mjs`): `boot`, `workspace-open`,
  `user-prompt`, `pre`, `post`, `ensure-idle`, `notification`, `stop`,
  `interrupt`, `stop-failure`, `session-end`.
- Per-session inflight tracking so multiple IDE windows share one pet and the
  pet stays busy while any of them is still calling tools.
- Blind-box engine (`overlay/loot.mjs`): three crate tiers chosen by tool-call
  count, six qualities, soft pity (up to 2.8× red weight), 60-crate hard pity,
  duplicate-red guard, and a new-codex bias.
- Warehouse, codex, and a local `.txt` reader panel in the tray popup, with
  click-to-cycle, wheel paging, and an `今开 / 红 / 累计 / 待开` HUD.
- 521-entry loot catalog (`data/items.json`) and a 115-entry red codex.
- petdex-compatible sprite loader (8 × 9 grid, 192 × 208 frames, PNG or WebP)
  plus the original sample pet **Byte**.
- CLI (`petdex.mjs`): `up`, `down`, `toggle`, `status`, `list`, `select`, `add`,
  `open`, `award`, `stash`, `codex`, `stats`, `panel`, `novel`, `doctor`.
- Watchdog that starts the pet with the IDE and exits it shortly after the last
  IDE process closes (`delay-down.mjs` avoids killing it when one window closes).
- `install.ps1` / `uninstall.ps1` with `-Agents`, `-NoStart`, and `-PurgeData`.
- Unit tests for the crate engine and the hook state machine.

[Unreleased]: https://github.com/WU55UY/petdex-overlay/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/WU55UY/petdex-overlay/releases/tag/v1.0.0
