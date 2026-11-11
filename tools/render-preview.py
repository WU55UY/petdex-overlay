#!/usr/bin/env python3
"""Render docs/preview.png and docs/preview.gif from the bundled 疾风 sprite sheet.

This is a static mock of the real Win32 overlay: same frame grid, bubble colors,
HUD text, and CJK font. It does not launch a window.
"""
from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

FRAME_W, FRAME_H = 192, 208
SCALE = 1.35
W, H = 460, 500
PAD = 12

QUALITY = {
    "white": {"fill": (248, 248, 248, 255), "outline": (140, 140, 140, 255), "text": (60, 60, 60, 255)},
    "gold": {"fill": (255, 249, 196, 255), "outline": (249, 168, 37, 255), "text": (230, 81, 0, 255)},
    "red": {"fill": (255, 235, 238, 255), "outline": (198, 40, 40, 255), "text": (183, 28, 28, 255)},
}


def font(size: int):
    windir = os.environ.get("WINDIR", r"C:\Windows")
    candidates = [
        Path(windir) / "Fonts" / "msyh.ttc",
        Path(windir) / "Fonts" / "simhei.ttf",
        Path(windir) / "Fonts" / "segoeui.ttf",
        Path("/System/Library/Fonts/PingFang.ttc"),
        Path("/System/Library/Fonts/STHeiti Light.ttc"),
        Path("/System/Library/Fonts/Hiragino Sans GB.ttc"),
    ]
    for p in candidates:
        if p.is_file():
            try:
                return ImageFont.truetype(str(p), size)
            except Exception:
                continue
    return ImageFont.load_default()


def harden(img: Image.Image, threshold: int = 128) -> Image.Image:
    rgba = img.convert("RGBA")
    px = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = px[x, y]
            px[x, y] = (0, 0, 0, 0) if a < threshold else (r, g, b, 255)
    return rgba


def background() -> Image.Image:
    img = Image.new("RGBA", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            t = (x / W) * 0.6 + (y / H) * 0.4
            px[x, y] = (
                int(236 - 26 * t),
                int(244 - 20 * t),
                int(250 - 12 * t),
                255,
            )
    # A soft "window" suggestion behind the pet.
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle((36, 60, W - 36, H - 40), radius=18, fill=(255, 255, 255, 150), outline=(190, 205, 218, 180), width=1)
    d.rounded_rectangle((36, 60, W - 36, 96), radius=18, fill=(246, 249, 252, 210))
    for i, color in enumerate([(255, 107, 107), (255, 196, 87), (98, 205, 128)]):
        d.ellipse((52 + i * 18, 72, 62 + i * 18, 82), fill=color)
    d.text((120, 72), "Codex — agent.ts", font=font(12), fill=(110, 126, 140))
    return img


def bubble(draw: ImageDraw.ImageDraw, text: str, cx: int, top: int, quality: str):
    f = font(14)
    tw = int(draw.textlength(text, font=f))
    bw, bh = tw + PAD * 2, 34
    x0, y0 = cx - bw // 2, top
    style = QUALITY[quality]
    draw.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=10, fill=style["fill"], outline=style["outline"], width=2)
    draw.text((x0 + PAD, y0 + 8), text, font=f, fill=style["text"])
    # Tail
    draw.polygon([(cx - 8, y0 + bh), (cx + 8, y0 + bh), (cx, y0 + bh + 10)], fill=style["fill"], outline=style["outline"])


def hud(draw: ImageDraw.ImageDraw, text: str, cy: int):
    f = font(12)
    tw = int(draw.textlength(text, font=f))
    bw, bh = tw + 24, 24
    x0 = (W - bw) // 2
    draw.rounded_rectangle((x0, cy, x0 + bw, cy + bh), radius=7, fill=(20, 24, 32, 220), outline=(90, 100, 120, 220), width=1)
    draw.text((x0 + 12, cy + 4), text, font=f, fill=(220, 228, 240, 255))


def compose(state_frame: Image.Image, bubble_text: str, quality: str) -> Image.Image:
    img = background()
    sprite = state_frame.resize(
        (int(FRAME_W * SCALE), int(FRAME_H * SCALE)), Image.LANCZOS
    )
    sx = (W - sprite.width) // 2
    sy = 150
    img.alpha_composite(sprite, (sx, sy))
    d = ImageDraw.Draw(img, "RGBA")
    bubble(d, bubble_text, W // 2, 102, quality)
    hud(d, "今开 3 · 红 1 · 累计 128万 · 待开 2", sy + sprite.height + 8)
    return img.convert("RGB")


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    docs = root / "docs"
    docs.mkdir(parents=True, exist_ok=True)

    sheet_path = next(
        p
        for p in (
            root / "pets" / "jifeng-q" / "spritesheet.webp",
            root / "pets" / "jifeng-q" / "spritesheet.png",
            root / "pets" / "sample" / "spritesheet.png",
        )
        if p.is_file()
    )
    sheet = Image.open(sheet_path).convert("RGBA")
    frames = []
    for i in range(6):
        frame = sheet.crop((i * FRAME_W, 0, (i + 1) * FRAME_W, FRAME_H))
        frames.append(harden(frame))

    still = compose(frames[2], "Agent 完成 · 入库「保险柜」待开 x1", "gold")
    still.save(docs / "preview.png")
    print(f"wrote {docs / 'preview.png'}")

    gif = []
    for i in range(6):
        gif.append(compose(frames[i], "Thinking…", "white"))
    gif[0].save(
        docs / "preview.gif",
        save_all=True,
        append_images=gif[1:],
        duration=180,
        loop=0,
        optimize=True,
    )
    print(f"wrote {docs / 'preview.gif'}")


if __name__ == "__main__":
    main()
