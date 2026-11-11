# Contributing

petdex-overlay is a local Windows overlay with no build step. The overlay is Python + Win32; the hook bridge, CLI and loot engine are Node.js ESM.

## Before opening a PR

- Run `npm test` (Node 18+). The test files cover loot, the hook bridge, Codex hook merging, and process discovery.
- Hook payload shapes live in `hooks/bridge.mjs` and `overlay/petdex.mjs`. A change to event names must update `integrations/codex/hooks.json.fragment`, `integrations/cursor/hooks.json.fragment`, and `integrations/kimi/hooks.toml.snippet`. Codex event names and timeouts also live in `tools/codex-hooks.mjs`.
- New pet states must match the nine official petdex rows — see the sprite table in [README.md](README.md).
- Third-party material: read [NOTICE.md](NOTICE.md). The bundled loot catalog is fan-made and **not** MIT; keep it for personal use or replace `data/items.json` in your fork.
- Windows-only behaviour should be guarded so `npm test` still passes on other platforms.

## Test locally

```sh
npm test
node overlay/petdex.mjs doctor
python tools/render-preview.py                 # regenerate docs/preview.gif
python tools/make-sample-pet.py                # regenerate the sample spritesheet
```

`install.ps1` writes into `%USERPROFILE%\.petdex\`; use `-NoStart` when testing so it does not launch the overlay.

## Report a bug

Use the issue template and include Windows version, Python version, agent (Codex / Cursor / Kimi Code) and the output of `node ...\petdex.mjs doctor`.

## Releases

Update `CHANGELOG.md` under `Unreleased` and `package.json`. Maintainers cut GitHub Releases; please do not bump the version in an unrelated PR.

By contributing you agree that your changes are released under the [MIT License](LICENSE). Third-party material stays under the terms described in `NOTICE.md`.
