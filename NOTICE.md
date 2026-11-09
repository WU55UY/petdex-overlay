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
