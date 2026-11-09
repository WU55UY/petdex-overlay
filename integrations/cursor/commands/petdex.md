---
description: Control the petdex desktop pet (up/down/select/loot/stash/codex)
---

The user wants to control the floating pet that lives on the desktop, including
the blind-box loot commands. Always use the installed CLI — do not invent paths.

```powershell
node "$env:USERPROFILE\.petdex\overlay\petdex.mjs" <command> [args]
```

| User says | Run |
|-----------|-----|
| `/petdex` or `/petdex toggle` | `toggle` |
| `/petdex up` / wake | `up` |
| `/petdex down` / sleep | `down` |
| `/petdex status` | `status` |
| `/petdex list` | `list` |
| `/petdex select <slug>` | `select <slug>` |
| `/petdex add <folder>` | `add <folder>` |
| `/petdex open` / 开箱 [all] | `open` / `open all` |
| `/petdex award [tools]` | `award [tools]` |
| `/petdex stash` / 仓库 | `stash` |
| `/petdex codex` / 图鉴 | `codex` |
| `/petdex doctor` | `doctor` |

A finished agent turn banks a sealed crate; it does **not** open automatically.
Double-click the pet (or run `open`) to open one. Right-click the pet to close it.

Show the CLI stdout/stderr verbatim to the user.

Arguments: `$ARGUMENTS`
