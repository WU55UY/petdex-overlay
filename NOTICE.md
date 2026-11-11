# NOTICE

petdex-overlay source code and the sample pet **Byte** are released under the
[MIT License](LICENSE), Copyright (c) 2026 WU55UY.

Two kinds of third-party material are involved. They are **not** covered by the
MIT grant in this repository.

## 1. Sprite format compatibility (petdex)

The `pets/<slug>/` layout and the `8 columns × 9 rows, 192×208` spritesheet
format follow [petdex](https://github.com/crafter-station/petdex) by
[Crafter Station](https://crafter.station) (MIT). petdex-overlay is an
independent Windows client that reads that format; it does not vendor petdex
code, and it is not an official petdex project.

Spritesheets you install from the petdex gallery or from other authors remain
under their own licenses. Check the pack's `pet.json` / repository before
redistributing it.

## 2. Loot catalog data (`data/items.json`)

The bundled 521-entry catalog is a fan-made collection list themed on
*Delta Force* (《三角洲行动》), compiled from community price data for a local,
non-commercial toy. Names, rarity concepts, and numeric values belong to their
respective rights holders (Tencent / TiMi Studio Group). petdex-overlay is not
affiliated with or endorsed by them.

If you publish a fork or a build, either keep the catalog for personal use only
or replace `data/items.json` with your own theme. The engine only needs the
documented fields (`items[]`, `id`, `name`, `quality`, `value`, `tier`), so any
list works — see the "Loot rules" section of the [README](README.md).

## 3. Fonts and emoji

The overlay renders text with fonts already installed on the system and falls
back to the Segoe UI family on Windows. No font files are redistributed here.

## 4. Bundled fan-art pet

`pets/sample` (Byte) is original and is covered by the MIT license above.

`pets/jifeng-q` (疾风 / Tempest) is the author's own pending Petdex submission.
It is bundled so Codex and this overlay can use the character before the
gallery approves `jifeng-q`. That folder is **not** covered by the MIT grant.
The character and likeness belong to their rights holders (Tencent / TiMi
Studio Group). This project is not affiliated with or endorsed by them. A
rights-holder request to remove it will be honored by deleting `pets/jifeng-q`.

Other pet packs installed from the [petdex gallery](https://petdex.dev) stay
under their own terms and are not relicensed by this repository.

For fan-art packs (for example a chibi take on a *Delta Force* operator):

- The character, names and likeness belong to their respective rights holders
  (Tencent / TiMi Studio Group). Neither this project nor the pack is affiliated
  with or endorsed by them.
- Petdex states that it does not claim rights to underlying IP and runs a
  [takedown process](https://petdex.dev/legal/takedown). Any rights-holder
  request will be complied with without contest.
- `credit` is bound to the verified OAuth identity (userId / email / credit) and
  is never accepted from a submission request body. The unofficial disclaimer
  and attribution therefore belong in the per-pet `description`.
- `license` is a per-pet field. `unspecified` is the honest default for anything
  submitted without a declaration; a permissive license must never be assumed on
  behalf of a third-party IP holder. `cc0`, `cc-by`, `cc-by-sa`, `cc-by-nc` and
  `all-rights-reserved` are the available choices — the author picks, not the
  tooling.

Copy-ready description, tags and the field limits live in the
"Submitting to the Petdex gallery" sections of [README.md](README.md) and
[README.en.md](README.en.md).
