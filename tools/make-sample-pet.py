#!/usr/bin/env python3
"""Generate the original sample pet (Byte) used by the demo.

The petdex sprite format is an 8-column x 9-row grid of 192x208 frames:

    row 0 idle           row 5 failed
    row 1 running-right  row 6 waiting
    row 2 running-left   row 7 running (working)
    row 3 waving         row 8 review
    row 4 jumping

Only the number of frames used by each state is drawn; unused cells stay
transparent. Run this script from the repository root:

    python tools/make-sample-pet.py

Outputs pets/sample/spritesheet.png and pets/sample/preview.png.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw

FRAME_W, FRAME_H = 192, 208
COLS, ROWS = 8, 9
S = 3  # supersample factor for smooth edges

OUTLINE = (34, 56, 66, 255)
OUTLINE_SOFT = (34, 56, 66, 180)
BODY = (123, 214, 224, 255)
BODY_DARK = (87, 186, 200, 255)
BELLY = (230, 250, 252, 255)
PAW = (214, 244, 248, 255)
EAR = (255, 172, 182, 255)
CHEEK = (255, 150, 166, 170)
WHITE = (255, 255, 255, 255)
PUPIL = (30, 44, 52, 255)
MOUTH = (70, 40, 46, 255)
SPROUT = (88, 178, 116, 255)
SPROUT_DARK = (58, 138, 88, 255)
SCARF = (255, 170, 92, 255)
SCARF_DARK = (226, 132, 58, 255)

STATE_ROWS = {
    "idle": (0, 6),
    "running-right": (1, 8),
    "running-left": (2, 8),
    "waving": (3, 4),
    "jumping": (4, 5),
    "failed": (5, 8),
    "waiting": (6, 6),
    "running": (7, 6),
    "review": (8, 6),
}

BULB = {
    "idle": (104, 214, 140, 255),
    "busy": (255, 178, 84, 255),
    "waiting": (112, 168, 255, 255),
    "failed": (255, 107, 107, 255),
    "review": (179, 136, 255, 255),
}


def sc(v: float) -> int:
    return int(round(v * S))


def ellipse(draw, box, fill, outline=None, width=0):
    draw.ellipse(tuple(sc(v) for v in box), fill=fill, outline=outline, width=sc(width))


def line(draw, points, fill, width):
    draw.line([(sc(x), sc(y)) for x, y in points], fill=fill, width=sc(width), joint="curve")


def polygon(draw, points, fill, outline=None):
    draw.polygon([(sc(x), sc(y)) for x, y in points], fill=fill, outline=outline)


def star(draw, cx, cy, r, fill):
    pts = []
    for i in range(8):
        ang = math.pi / 4 * i
        rr = r if i % 2 == 0 else r * 0.36
        pts.append((cx + math.cos(ang) * rr, cy + math.sin(ang) * rr))
    polygon(draw, pts, fill)


def capsule(draw, p1, p2, color, width=15):
    line(draw, [p1, p2], OUTLINE, width + 4)
    line(draw, [p1, p2], color, width)


def draw_face(draw, cx, cy, eyes, mouth, blush=True):
    eye_y = cy - 12
    dx = 24
    if eyes == "open":
        for sx in (-1, 1):
            x = cx + sx * dx
            ellipse(draw, (x - 11, eye_y - 14, x + 11, eye_y + 14), WHITE, OUTLINE, 2.4)
            ellipse(draw, (x - 5, eye_y - 6, x + 6, eye_y + 8), PUPIL)
            ellipse(draw, (x - 2, eye_y - 4, x + 2, eye_y + 1), WHITE)
    elif eyes == "wide":
        for sx in (-1, 1):
            x = cx + sx * dx
            ellipse(draw, (x - 13, eye_y - 17, x + 13, eye_y + 17), WHITE, OUTLINE, 2.4)
            ellipse(draw, (x - 6, eye_y - 7, x + 7, eye_y + 9), PUPIL)
            ellipse(draw, (x - 3, eye_y - 5, x + 1, eye_y - 1), WHITE)
    elif eyes == "blink":
        for sx in (-1, 1):
            x = cx + sx * dx
            line(draw, [(x - 10, eye_y + 2), (x, eye_y - 4), (x + 10, eye_y + 2)], OUTLINE, 3)
    elif eyes == "happy":
        for sx in (-1, 1):
            x = cx + sx * dx
            line(draw, [(x - 11, eye_y + 4), (x, eye_y - 6), (x + 11, eye_y + 4)], OUTLINE, 3.4)
    elif eyes == "half":
        for sx in (-1, 1):
            x = cx + sx * dx
            ellipse(draw, (x - 11, eye_y - 14, x + 11, eye_y + 14), WHITE, OUTLINE, 2.4)
            ellipse(draw, (x - 5, eye_y, x + 6, eye_y + 10), PUPIL)
            draw.rectangle(
                (sc(x - 12), sc(eye_y - 16), sc(x + 12), sc(eye_y - 1)),
                fill=BODY,
            )
            line(draw, [(x - 11, eye_y - 1), (x + 11, eye_y - 1)], OUTLINE, 2.4)
    elif eyes == "x":
        for sx in (-1, 1):
            x = cx + sx * dx
            line(draw, [(x - 8, eye_y - 9), (x + 8, eye_y + 7)], OUTLINE, 3.6)
            line(draw, [(x + 8, eye_y - 9), (x - 8, eye_y + 7)], OUTLINE, 3.6)

    my = cy + 22
    if mouth == "smile":
        draw.arc((sc(cx - 10), sc(my - 6), sc(cx + 10), sc(my + 8)), 20, 160, fill=MOUTH, width=sc(2.6))
    elif mouth == "open":
        ellipse(draw, (cx - 7, my - 2, cx + 7, my + 12), MOUTH)
        ellipse(draw, (cx - 4, my + 5, cx + 4, my + 11), (255, 150, 160, 255))
    elif mouth == "flat":
        line(draw, [(cx - 7, my + 2), (cx + 7, my + 2)], MOUTH, 2.6)
    elif mouth == "wavy":
        line(draw, [(cx - 10, my + 3), (cx - 4, my - 2), (cx + 2, my + 3), (cx + 9, my - 2)], MOUTH, 2.4)
    elif mouth == "o":
        ellipse(draw, (cx - 5, my - 2, cx + 5, my + 10), MOUTH)

    if blush:
        for sx in (-1, 1):
            x = cx + sx * 42
            ellipse(
                draw,
                (x - 8, cy + 6, x + 8, cy + 15),
                CHEEK,
            )


def draw_pet(
    draw,
    *,
    lean=0,
    bob=0,
    squash=0.0,
    eyes="open",
    mouth="smile",
    arm_l=0.0,
    arm_r=0.0,
    feet=0.0,
    bulb="idle",
    state="idle",
    frame=0,
):
    cx = 96 + lean
    cy = 122 + bob

    # Ground shadow shrinks while jumping.
    lift = max(0, -bob - 2)
    sw = max(46, 84 - lift * 0.9)
    ellipse(draw, (96 - sw / 2, 190, 96 + sw / 2, 202), (30, 50, 58, 46))

    sy = 1 + squash
    sx = 1 - squash * 0.55
    body_w = 62 * sx
    body_h = 62 * sy
    bx0, bx1 = cx - body_w, cx + body_w
    by0, by1 = cy - body_h, cy + body_h

    # Curly tail behind the body.
    tsway = math.sin(frame * 0.9) * 8
    line(
        draw,
        [(cx + 46, cy + 44), (cx + 74, cy + 52 + tsway * 0.3), (cx + 82, cy + 26 + tsway)],
        OUTLINE,
        15,
    )
    line(
        draw,
        [(cx + 46, cy + 44), (cx + 74, cy + 52 + tsway * 0.3), (cx + 82, cy + 26 + tsway)],
        BODY,
        10,
    )
    ellipse(draw, (cx + 73, cy + 15 + tsway, cx + 91, cy + 33 + tsway), BODY, OUTLINE, 2.4)

    # Ears
    for sx_dir in (-1, 1):
        ex = cx + sx_dir * 40
        polygon(
            draw,
            [(ex - 22, by0 + 16), (ex + sx_dir * 2, by0 - 26), (ex + 20, by0 + 10)],
            BODY,
            OUTLINE,
        )
        polygon(
            draw,
            [(ex - 12, by0 + 10), (ex + sx_dir * 1, by0 - 12), (ex + 10, by0 + 6)],
            EAR,
        )

    # Body + a soft lighter tummy (kept subtle so the face stays readable).
    ellipse(draw, (bx0, by0, bx1, by1), BODY, OUTLINE, 3)
    ellipse(draw, (cx - 30 * sx, cy + 22 * sy, cx + 30 * sx, cy + 54 * sy), (176, 233, 239, 255))

    # Feet
    for i, sx_dir in enumerate((-1, 1)):
        phase = math.sin((feet + i * 0.5) * math.pi * 2) * 3
        fx = cx + sx_dir * 26 + phase * sx_dir
        fy = cy + 54 + max(0, phase)
        ellipse(draw, (fx - 17, fy, fx + 17, fy + 17), PAW, OUTLINE, 2.6)

    # Arms (0 = resting, 1 = raised)
    for sx_dir, amount in ((-1, arm_l), (1, arm_r)):
        base_x = cx + sx_dir * (body_w - 4)
        base_y = cy + 10
        hand_x = base_x + sx_dir * (10 + 16 * amount)
        hand_y = base_y + 28 - 52 * amount
        capsule(draw, (base_x, base_y), (hand_x, hand_y), BODY, 13)
        ellipse(draw, (hand_x - 8, hand_y - 8, hand_x + 8, hand_y + 8), PAW, OUTLINE, 2.4)

    # Scarf keeps the neck readable when squashed.
    # (removed: the blob has no neck; badge is drawn above)

    draw_face(draw, cx, cy, eyes, mouth)

    # Sprout with a status bulb.
    sway = math.sin(frame * 0.7) * 4
    top = by0 - 2
    tip = (cx + sway, top - 30)
    line(draw, [(cx, top), (cx + sway, top - 20), tip], SPROUT_DARK, 4)
    ellipse(draw, (cx + sway - 14, top - 26, cx + sway - 1, top - 15), SPROUT)
    ellipse(draw, (cx + sway + 1, top - 28, cx + sway + 14, top - 17), SPROUT)
    ellipse(draw, (tip[0] - 6, tip[1] - 6, tip[0] + 6, tip[1] + 6), BULB[bulb], OUTLINE, 1.6)

    # A few motion sparkles for active states.
    if state in ("waving", "jumping") and frame % 2 == 0:
        star(draw, cx - 72, cy - 52, 6, (255, 216, 120, 255))
        star(draw, cx + 74, cy - 44, 4, (255, 240, 180, 255))
    if state == "running" and frame % 2 == 0:
        star(draw, cx + 66, cy - 40, 4, (255, 196, 110, 255))


def frame_for(state: str, i: int) -> Image.Image:
    img = Image.new("RGBA", (FRAME_W * S, FRAME_H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if state == "idle":
        bobs = [0, -2, -3, -2, 0, 1]
        draw_pet(d, bob=bobs[i % 6], eyes="blink" if i == 4 else "open", frame=i)
    elif state in ("running-right", "running-left"):
        direction = 1 if state == "running-right" else -1
        bobs = [-1, 1, -3, 1, -1, 1, -3, 1]
        draw_pet(
            d,
            lean=direction * (4 + (i % 2) * 2),
            bob=bobs[i % 8],
            squash=0.03 if i % 2 else -0.02,
            eyes="open",
            mouth="open",
            arm_l=0.25 if direction > 0 else 0.55,
            arm_r=0.25 if direction < 0 else 0.55,
            feet=(i % 4) / 4,
            state="run",
            bulb="busy",
            frame=i,
        )
    elif state == "waving":
        draw_pet(
            d,
            lean=-3,
            bob=[0, -2, 0, -1][i % 4],
            eyes="happy",
            mouth="open",
            arm_r=[1.0, 1.15, 1.0, 0.85][i % 4],
            feet=(i % 2) / 2,
            state="waving",
            bulb="idle",
            frame=i,
        )
    elif state == "jumping":
        bobs = [-8, -24, -36, -22, -6]
        squash = [0.1, -0.02, -0.06, 0.02, 0.14][i % 5]
        draw_pet(
            d,
            bob=bobs[i % 5],
            squash=squash,
            eyes="happy",
            mouth="o",
            arm_l=0.9,
            arm_r=0.9,
            feet=(i % 3) / 3,
            state="jumping",
            bulb="busy",
            frame=i,
        )
    elif state == "failed":
        draw_pet(
            d,
            bob=6,
            squash=0.1,
            eyes="x",
            mouth="wavy",
            arm_l=0.05,
            arm_r=0.05,
            feet=0,
            bulb="failed",
            frame=i,
        )
        # Sweat drop
        d.ellipse((sc(142), sc(92), sc(152), sc(106)), fill=(120, 180, 255, 200))
        d.polygon([(sc(147), sc(84)), (sc(142), sc(94)), (sc(152), sc(94))], fill=(120, 180, 255, 200))
    elif state == "waiting":
        draw_pet(
            d,
            bob=[0, 0, -1, 0, 0, 1][i % 6],
            eyes="half",
            mouth="flat",
            arm_l=0.0,
            arm_r=0.0,
            feet=(i % 2) / 2,
            bulb="waiting",
            frame=i,
        )
        # Sleepy z's
        if i % 2 == 0:
            for k, (zx, zy, zs) in enumerate([(138, 78, 5), (148, 64, 7), (160, 48, 9)]):
                if k <= i % 3:
                    d.text(
                        (sc(zx), sc(zy)),
                        "z",
                        fill=(150, 170, 210, 220),
                        font=None,
                    )
    elif state == "running":
        draw_pet(
            d,
            lean=2 if i % 2 == 0 else -2,
            bob=-1,
            squash=0.02,
            eyes="wide",
            mouth="open",
            arm_l=0.7,
            arm_r=0.7,
            feet=(i % 4) / 4,
            state="running",
            bulb="busy",
            frame=i,
        )
        d.ellipse((sc(148), sc(88), sc(157), sc(102)), fill=(120, 180, 255, 190))
    elif state == "review":
        draw_pet(
            d,
            lean=3,
            bob=[0, -1, 0, 1, 0, -1][i % 6],
            eyes="open",
            mouth="flat",
            arm_r=1.05,
            bulb="review",
            frame=i,
        )
        # Glasses
        for gx in (72, 120):
            d.ellipse(
                (sc(gx - 14), sc(98), sc(gx + 14), sc(130)),
                outline=(70, 90, 110, 255),
                width=sc(2.2),
            )
        d.line((sc(86), sc(110), sc(106), sc(110)), fill=(70, 90, 110, 255), width=sc(2.2))
        # Magnifier in the raised hand
        mx, my = 164, 84
        d.ellipse((sc(mx - 13), sc(my - 13), sc(mx + 13), sc(my + 13)), outline=(70, 90, 110, 255), width=sc(4))
        d.ellipse((sc(mx - 11), sc(my - 11), sc(mx + 11), sc(my + 11)), fill=(170, 220, 255, 70))
        d.line((sc(mx + 8), sc(my + 8), sc(mx + 20), sc(my + 20)), fill=(70, 90, 110, 255), width=sc(5))

    return img.resize((FRAME_W, FRAME_H), Image.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    out_dir = root / "pets" / "sample"
    out_dir.mkdir(parents=True, exist_ok=True)

    sheet = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * ROWS), (0, 0, 0, 0))
    previews = {}
    for state, (row, count) in STATE_ROWS.items():
        for i in range(count):
            frame = frame_for(state, i)
            sheet.alpha_composite(frame, (i * FRAME_W, row * FRAME_H))
            if i == 0:
                previews[state] = frame

    sheet.save(out_dir / "spritesheet.png")

    # Preview: first idle frame on a soft gradient card.
    card = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
    px = card.load()
    for y in range(420):
        for x in range(420):
            t = (x + y) / 840
            px[x, y] = (
                int(238 - 22 * t),
                int(247 - 16 * t),
                int(252 - 10 * t),
                255,
            )
    pet = frame_for("idle", 2).resize((288, 312), Image.LANCZOS)
    card.alpha_composite(pet, (66, 96))
    card.convert("RGB").save(out_dir / "preview.png")

    print(f"wrote {out_dir / 'spritesheet.png'} ({sheet.width}x{sheet.height})")
    print(f"wrote {out_dir / 'preview.png'}")


if __name__ == "__main__":
    main()
