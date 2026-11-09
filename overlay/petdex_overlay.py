#!/usr/bin/env python3
"""petdex-overlay — per-pixel-alpha desktop pet for Windows.

Uses Win32 UpdateLayeredWindow + premultiplied BGRA, so the sprite keeps sharp
edges without a color-key fringe. Reads state from <PETDEX_HOME>/runtime/ and
pet sprite sheets from <PETDEX_HOME>/pets/<slug>/.

Requires: Pillow, pywin32.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

import ctypes
from ctypes import POINTER, byref, c_int, c_void_p, sizeof, windll
from ctypes.wintypes import (
    BOOL,
    BYTE,
    DWORD,
    HBITMAP,
    HDC,
    HWND,
    LONG,
    POINT,
    SIZE,
    UINT,
    WORD,
)

from PIL import Image, ImageDraw, ImageFont
import win32api
import win32con
import win32gui


def _load_overlay_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load one CJK-capable font; cache so every label uses identical metrics."""
    windir = os.environ.get("WINDIR", r"C:\Windows")
    candidates = [
        os.path.join(windir, "Fonts", "msyh.ttc"),
        os.path.join(windir, "Fonts", "simhei.ttf"),
        os.path.join(windir, "Fonts", "segoeui.ttf"),
        os.path.join(windir, "Fonts", "arial.ttf"),
    ]
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            return ImageFont.truetype(path, size, index=0)
        except Exception:
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return ImageFont.load_default()


def _ui_font(size: int = 10) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    return _load_overlay_font(size)


def _enable_dpi_awareness() -> None:
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


_enable_dpi_awareness()

HOME = Path.home()
PETDEX = Path(os.environ.get("PETDEX_HOME") or (HOME / ".petdex"))
RUNTIME = PETDEX / "runtime"
ACTIVE = PETDEX / "active.json"
PETS = PETDEX / "pets"
AUTO_EXIT = os.environ.get("PETDEX_AUTO_EXIT") == "1"
AGENT_PROCESSES = os.environ.get("PETDEX_AGENT_PROCESSES") or "Cursor,Kimi Code,ZCode"
DEFAULT_PET = "sample"

FRAME_W, FRAME_H = 192, 208
HUD_H = 18
WIN_W, WIN_H = FRAME_W, FRAME_H + 56
COLS = 8
PANEL_SCROLL_LINES = 12
NOVEL_PANEL_BOX_W = 220
OVERLAY_FONT_SIZE = 10
OVERLAY_FONT = _load_overlay_font(OVERLAY_FONT_SIZE)
NOVEL_PANEL_LINES = 8
SHORT_BUBBLE_MAX_LINES = 4

# Delta Force item quality colors (白 < 绿 < 蓝 < 紫 < 金 < 红)
QUALITY_STYLE = {
    "white": {
        "fill": (248, 248, 248, 255),
        "outline": (140, 140, 140, 255),
        "text": (60, 60, 60, 255),
    },
    "green": {
        "fill": (232, 245, 233, 255),
        "outline": (46, 125, 50, 255),
        "text": (27, 94, 32, 255),
    },
    "blue": {
        "fill": (227, 242, 253, 255),
        "outline": (21, 101, 192, 255),
        "text": (13, 71, 161, 255),
    },
    "purple": {
        "fill": (243, 229, 245, 255),
        "outline": (106, 27, 154, 255),
        "text": (74, 20, 140, 255),
    },
    "gold": {
        "fill": (255, 249, 196, 255),
        "outline": (249, 168, 37, 255),
        "text": (230, 81, 0, 255),
    },
    "red": {
        "fill": (255, 235, 238, 255),
        "outline": (198, 40, 40, 255),
        "text": (183, 28, 28, 255),
    },
}

STATES = {
    # (row, nframes, cycle_ms) — cycle_ms / nframes = per-frame interval
    "idle": (0, 6, 2100),
    "running-right": (1, 8, 1800),
    "running-left": (2, 8, 1800),
    "waving": (3, 4, 1400),
    "jumping": (4, 5, 1400),
    "failed": (5, 8, 2000),
    "waiting": (6, 6, 1800),
    "running": (7, 6, 1500),
    "review": (8, 6, 1800),
}

user32 = windll.user32
gdi32 = windll.gdi32

ULW_ALPHA = 0x00000002
AC_SRC_OVER = 0x00
AC_SRC_ALPHA = 0x01
WM_TIMER_ANIM = 1
WM_TIMER_POLL = 2
WM_TIMER_CLICK = 3
CLICK_DELAY_MS = 280
CLICK_MOVE_TOLERANCE = 8


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [
        ("BlendOp", BYTE),
        ("BlendFlags", BYTE),
        ("SourceConstantAlpha", BYTE),
        ("AlphaFormat", BYTE),
    ]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [
        ("biSize", DWORD),
        ("biWidth", LONG),
        ("biHeight", LONG),
        ("biPlanes", WORD),
        ("biBitCount", WORD),
        ("biCompression", DWORD),
        ("biSizeImage", DWORD),
        ("biXPelsPerMeter", LONG),
        ("biYPelsPerMeter", LONG),
        ("biClrUsed", DWORD),
        ("biClrImportant", DWORD),
    ]


class BITMAPINFO(ctypes.Structure):
    _fields_ = [("bmiHeader", BITMAPINFOHEADER)]


# 64-bit Windows: without argtypes, CreateDIBSection truncates pointers → hbmp=0
gdi32.CreateCompatibleDC.argtypes = [HDC]
gdi32.CreateCompatibleDC.restype = HDC
gdi32.CreateDIBSection.argtypes = [
    HDC,
    POINTER(BITMAPINFO),
    UINT,
    POINTER(c_void_p),
    HDC,
    DWORD,
]
gdi32.CreateDIBSection.restype = HBITMAP
gdi32.SelectObject.argtypes = [HDC, HBITMAP]
gdi32.SelectObject.restype = HBITMAP
gdi32.DeleteObject.argtypes = [HBITMAP]
gdi32.DeleteObject.restype = BOOL
gdi32.DeleteDC.argtypes = [HDC]
gdi32.DeleteDC.restype = BOOL
user32.UpdateLayeredWindow.argtypes = [
    HWND,
    HDC,
    POINTER(POINT),
    POINTER(SIZE),
    HDC,
    POINTER(POINT),
    DWORD,
    POINTER(BLENDFUNCTION),
    DWORD,
]
user32.UpdateLayeredWindow.restype = BOOL
user32.GetDC.argtypes = [HWND]
user32.GetDC.restype = HDC
user32.ReleaseDC.argtypes = [HWND, HDC]
user32.ReleaseDC.restype = c_int


def read_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def format_haf(value: int | float) -> str:
    v = int(value or 0)
    if v >= 100_000_000:
        return f"{v / 100_000_000:.2f}亿"
    if v >= 10_000:
        return f"{round(v / 10_000)}万"
    return str(v)


def loot_stats_hud() -> str:
    try:
        stash = read_json(PETDEX / "delta" / "stash.json")
        haf = stash.get("hafCoinsToday")
        if haf is None:
            haf = 0
        opens_today = stash.get("opensToday") or 0
        pending = stash.get("pendingCrates") or []
        n_pending = len(pending) if isinstance(pending, list) else 0
        reds = stash.get("redsToday") or {}
        n_red = 0
        if isinstance(reds, dict):
            for it in reds.values():
                if isinstance(it, dict):
                    n_red += int(it.get("count") or 0)
        return f"今开{opens_today} · 红{n_red} · 累计{format_haf(haf)} · 待开{n_pending}"
    except Exception:
        return "今开0 · 累计0 · 待开0"


def load_sheet() -> tuple[Image.Image, str]:
    slug = str(read_json(ACTIVE).get("slug") or DEFAULT_PET)
    pet_dir = PETS / slug
    for name in ("spritesheet.png", "spritesheet.webp", "sprite.png", "sprite.webp"):
        p = pet_dir / name
        if p.is_file() and p.stat().st_size > 0:
            return Image.open(p).convert("RGBA"), slug
    raise FileNotFoundError(
        f"no sprite sheet in {pet_dir} — install a pet with `petdex add <folder>`"
    )


def harden_alpha(img: Image.Image, threshold: int = 128) -> Image.Image:
    """Pixel-art edges: snap soft fringe to fully transparent or opaque."""
    rgba = img.convert("RGBA")
    px = rgba.load()
    w, h = rgba.size
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < threshold:
                px[x, y] = (0, 0, 0, 0)
            else:
                px[x, y] = (r, g, b, 255)
    return rgba


def cut_frames(sheet: Image.Image) -> list[list[Image.Image]]:
    rows = sheet.height // FRAME_H
    cols = min(COLS, sheet.width // FRAME_W)
    grid: list[list[Image.Image]] = []
    for r in range(rows):
        row = []
        for c in range(cols):
            row.append(
                harden_alpha(
                    sheet.crop(
                        (
                            c * FRAME_W,
                            r * FRAME_H,
                            (c + 1) * FRAME_W,
                            (r + 1) * FRAME_H,
                        )
                    )
                )
            )
        grid.append(row)
    return _align_grid_feet(grid, skip_rows={4})  # jumping keeps airborne feet


def _frame_foot_y(fr: Image.Image) -> int | None:
    bbox = fr.getbbox()
    if not bbox:
        return None
    return bbox[3] - 1


def _shift_frame(fr: Image.Image, dy: int) -> Image.Image:
    if dy == 0:
        return fr
    out = Image.new("RGBA", fr.size, (0, 0, 0, 0))
    out.paste(fr, (0, dy))
    return out


def _align_grid_feet(
    grid: list[list[Image.Image]],
    skip_rows: set[int] | None = None,
) -> list[list[Image.Image]]:
    """Same foot baseline for idle/run (and other grounded poses)."""
    skip_rows = skip_rows or set()
    foots: list[int] = []
    for r, row in enumerate(grid):
        if r in skip_rows:
            continue
        for fr in row:
            y = _frame_foot_y(fr)
            if y is not None:
                foots.append(y)
    if not foots:
        return grid
    target = min(max(foots), FRAME_H - 3)
    out_grid: list[list[Image.Image]] = []
    for r, row in enumerate(grid):
        if r in skip_rows:
            out_grid.append(row)
            continue
        out_grid.append(
            [
                _shift_frame(fr, 0 if (y := _frame_foot_y(fr)) is None else target - y)
                for fr in row
            ]
        )
    return out_grid


def premultiply_bgra(img: Image.Image) -> bytes:
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px = rgba.load()
    out = bytearray(w * h * 4)
    i = 0
    for y in range(h - 1, -1, -1):
        for x in range(w):
            r, g, b, a = px[x, y]
            out[i] = (b * a) // 255
            out[i + 1] = (g * a) // 255
            out[i + 2] = (r * a) // 255
            out[i + 3] = a
            i += 4
    return bytes(out)


class PetOverlay:
    def __init__(self) -> None:
        self.sheet, self.slug = load_sheet()
        self.frames = cut_frames(self.sheet)
        self.state = "idle"
        self.state_counter = -1
        self.bubble_counter = -1
        self.bubble_text = ""
        self.bubble_quality = "white"
        self.bubble_scroll = 0
        self.panel_counter = -1
        self.panel_text = ""
        self.panel_quality = "white"
        self.panel_mode = "none"
        self.stats_hud_text = loot_stats_hud()
        self.frame_i = 0
        self._dragging = False
        self._btn_down = False
        self._drag_dx = 0
        self._drag_dy = 0
        self._press_x = 0
        self._press_y = 0
        self._state_started_at = time.monotonic()
        self._state_duration_ms: float | None = None
        self._pos = [120, 120]
        self._paint_w = FRAME_W
        self._pin_feet: tuple[int, int] | None = None
        self._last_frame_at = 0.0
        self._agent_missing_since = None
        self._agent_check_i = 0

        self.hdc_screen = user32.GetDC(0)
        self.hdc_mem = gdi32.CreateCompatibleDC(self.hdc_screen)

        self._register_class()
        ex = (
            win32con.WS_EX_LAYERED
            | win32con.WS_EX_TOPMOST
            | win32con.WS_EX_TOOLWINDOW
        )
        self.hwnd = win32gui.CreateWindowEx(
            ex,
            self.class_name,
            "Petdex Overlay",
            win32con.WS_POPUP,
            self._pos[0],
            self._pos[1],
            WIN_W,
            WIN_H,
            0,
            0,
            win32api.GetModuleHandle(None),
            None,
        )
        win32gui.ShowWindow(self.hwnd, win32con.SW_SHOW)
        win32gui.SetWindowPos(
            self.hwnd,
            win32con.HWND_TOPMOST,
            self._pos[0],
            self._pos[1],
            WIN_W,
            WIN_H,
            0,
        )
        self._paint()
        # anim tick 40ms; actual frame advance uses STATES cycle_ms
        user32.SetTimer(self.hwnd, WM_TIMER_ANIM, 40, None)
        user32.SetTimer(self.hwnd, WM_TIMER_POLL, 200, None)

    def _register_class(self) -> None:
        self.class_name = "PetdexOverlayWin32"
        wc = win32gui.WNDCLASS()
        wc.hInstance = win32api.GetModuleHandle(None)
        wc.lpszClassName = self.class_name
        wc.lpfnWndProc = self._wnd_proc
        wc.hCursor = win32gui.LoadCursor(0, win32con.IDC_ARROW)
        wc.style = win32con.CS_DBLCLKS
        try:
            win32gui.RegisterClass(wc)
        except win32gui.error:
            pass  # already registered

    def _click_delay_ms(self) -> int:
        return CLICK_DELAY_MS

    def _cancel_pending_click(self, hwnd) -> None:
        user32.KillTimer(hwnd, WM_TIMER_CLICK)

    def _schedule_click(self, hwnd) -> None:
        self._cancel_pending_click(hwnd)
        user32.SetTimer(hwnd, WM_TIMER_CLICK, self._click_delay_ms(), None)

    def _wnd_proc(self, hwnd, msg, wparam, lparam):
        if msg == win32con.WM_TIMER:
            if wparam == WM_TIMER_ANIM:
                self._tick_anim()
            elif wparam == WM_TIMER_POLL:
                self._tick_poll()
            elif wparam == WM_TIMER_CLICK:
                self._cancel_pending_click(hwnd)
                self._cycle_panel()
            return 0
        if msg == win32con.WM_MOUSEWHEEL:
            delta = ctypes.c_short((wparam >> 16) & 0xFFFF).value
            if self._is_novel_panel():
                self._novel_page(-1 if delta > 0 else 1)
            elif self._is_panel_text(self.panel_text):
                max_scroll = self._panel_max_scroll(self.panel_text)
                if delta > 0:
                    self.bubble_scroll = max(0, self.bubble_scroll - 1)
                else:
                    self.bubble_scroll = min(max_scroll, self.bubble_scroll + 1)
                self._paint()
            return 0
        if msg == win32con.WM_LBUTTONDBLCLK:
            self._cancel_pending_click(hwnd)
            self._btn_down = False
            self._dragging = False
            try:
                win32gui.ReleaseCapture()
            except Exception:
                pass
            self._open_pending_crate()
            return 0
        if msg == win32con.WM_LBUTTONDOWN:
            self._cancel_pending_click(hwnd)
            x = win32api.LOWORD(lparam)
            y = win32api.HIWORD(lparam)
            self._press_x = x
            self._press_y = y
            self._btn_down = True
            self._dragging = False
            self._drag_dx = x
            self._drag_dy = y
            win32gui.SetCapture(hwnd)
            return 0
        if msg == win32con.WM_MOUSEMOVE and self._btn_down:
            x = win32api.LOWORD(lparam)
            y = win32api.HIWORD(lparam)
            if not self._dragging:
                if abs(x - self._press_x) >= CLICK_MOVE_TOLERANCE or abs(
                    y - self._press_y
                ) >= CLICK_MOVE_TOLERANCE:
                    self._dragging = True
            if self._dragging:
                pt = win32gui.GetCursorPos()
                self._pos[0] = pt[0] - self._drag_dx
                self._pos[1] = pt[1] - self._drag_dy
                self._pin_feet = None
                self._paint()
            return 0
        if msg == win32con.WM_LBUTTONUP:
            x = win32api.LOWORD(lparam)
            y = win32api.HIWORD(lparam)
            if self._btn_down and not self._dragging:
                self._schedule_click(hwnd)
            self._btn_down = False
            self._dragging = False
            try:
                win32gui.ReleaseCapture()
            except Exception:
                pass
            return 0
        if msg == win32con.WM_RBUTTONUP:
            win32gui.PostMessage(hwnd, win32con.WM_CLOSE, 0, 0)
            return 0
        if msg == win32con.WM_DESTROY:
            self._cancel_pending_click(hwnd)
            user32.KillTimer(hwnd, WM_TIMER_ANIM)
            user32.KillTimer(hwnd, WM_TIMER_POLL)
            win32gui.PostQuitMessage(0)
            return 0
        return win32gui.DefWindowProc(hwnd, msg, wparam, lparam)

    def _pending_crate_count(self) -> int:
        try:
            stash = read_json(PETDEX / "delta" / "stash.json")
            pending = stash.get("pendingCrates") or []
            return len(pending) if isinstance(pending, list) else 0
        except Exception:
            return 0

    def _node_cli(self) -> tuple[str, Path] | None:
        cli = PETDEX / "overlay" / "petdex.mjs"
        if not cli.is_file():
            return None
        candidates = [
            os.environ.get("PETDEX_NODE"),
            os.path.join(os.environ.get("ProgramFiles", r"C:\Program Files"), "nodejs", "node.exe"),
            os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "nodejs", "node.exe"),
        ]
        for cand in candidates:
            if cand and Path(cand).is_file():
                return cand, cli
        return "node", cli

    def _run_cli(self, *args: str) -> None:
        found = self._node_cli()
        if not found:
            return
        node, cli = found
        try:
            subprocess.Popen(
                [node, str(cli), *args],
                cwd=str(PETDEX / "overlay"),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            pass

    def _cycle_panel(self) -> None:
        self._run_cli("panel", "cycle")

    def _novel_page(self, direction: int) -> None:
        cmd = "novel-prev" if direction < 0 else "novel-next"
        self._run_cli("panel", cmd)

    def _open_pending_crate(self) -> None:
        self._run_cli("open")

    def _maybe_reload_pet(self) -> None:
        slug = str(read_json(ACTIVE).get("slug") or self.slug)
        if slug == self.slug:
            return
        try:
            self.sheet, self.slug = load_sheet()
            self.frames = cut_frames(self.sheet)
            self.frame_i = 0
        except Exception:
            pass

    def _is_novel_panel(self) -> bool:
        return self.panel_mode == "novel"

    @staticmethod
    def _is_novel_text(text: str) -> bool:
        return (text or "").strip().startswith("【阅读】")

    @staticmethod
    def _is_panel_text(text: str) -> bool:
        t = (text or "").strip()
        return t.startswith("【仓库】") or t.startswith("【图鉴】") or t.startswith("【阅读】")

    def _visible_novel_lines(self, raw: str) -> list[str]:
        all_lines = raw.split("\n")
        if not all_lines:
            return []
        footer: list[str] = []
        if all_lines[-1].strip().startswith("单击切换"):
            footer = [all_lines[-1].strip()]
            all_lines = all_lines[:-1]
        body = [ln[:48] for ln in all_lines[:NOVEL_PANEL_LINES]]
        return body + footer

    def _stash_header_end(self, all_lines: list[str]) -> int:
        """Pin 今开红 above the warehouse list. Other panels keep the first line."""
        if not all_lines:
            return 0
        if all_lines[0].startswith("【仓库】"):
            for i, ln in enumerate(all_lines):
                if ln.startswith("种类"):
                    return i + 1
            return 1
        return 1

    def _panel_scrollable_lines(self, raw: str) -> list[str]:
        all_lines = [ln[:48] for ln in raw.split("\n") if ln.strip()]
        if not all_lines:
            return []
        if all_lines[-1].startswith("单击切换"):
            all_lines = all_lines[:-1]
        header_end = self._stash_header_end(all_lines)
        return all_lines[header_end:]

    def _panel_max_scroll(self, raw: str) -> int:
        scrollable = self._panel_scrollable_lines(raw)
        return max(0, len(scrollable) - PANEL_SCROLL_LINES)

    def _visible_bubble_lines(self, raw: str) -> list[str]:
        all_lines = [ln[:48] for ln in raw.split("\n") if ln.strip()]
        if not all_lines:
            return []

        footer: list[str] = []
        if all_lines[-1].startswith("单击切换"):
            footer = [all_lines[-1]]
            all_lines = all_lines[:-1]

        if not self._is_panel_text(raw):
            return all_lines[:SHORT_BUBBLE_MAX_LINES]

        header_end = self._stash_header_end(all_lines)
        header = all_lines[:header_end]
        scrollable = all_lines[header_end:]

        max_scroll = max(0, len(scrollable) - PANEL_SCROLL_LINES)
        scroll = min(max(0, self.bubble_scroll), max_scroll)
        visible_mid = scrollable[scroll : scroll + PANEL_SCROLL_LINES]
        lines = header + visible_mid
        if max_scroll > 0:
            lines.append(f"滚轮翻页 {scroll + 1}-{scroll + len(visible_mid)}/{len(scrollable)}")
        lines.extend(footer)
        return lines

    def _measure_bubble(
        self,
        lines: list[str],
        bubble_font,
        pad_x: int,
        pad_y: int,
        line_gap: int,
    ) -> tuple[int, int]:
        if not lines:
            return 0, 0
        measure = ImageDraw.Draw(Image.new("RGBA", (8, 8), (0, 0, 0, 0)))
        max_tw = 0
        total_th = 0
        for i, line in enumerate(lines):
            bbox = measure.textbbox((0, 0), line, font=bubble_font)
            tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
            max_tw = max(max_tw, tw)
            total_th += th + (line_gap if i else 0)
        return max_tw + pad_x * 2, total_th + pad_y * 2

    def _draw_bubble(
        self,
        canvas: Image.Image,
        lines: list[str],
        y0: int,
        win_w: int,
        bub_w: int,
        bub_h: int,
        bubble_font,
        pad_x: int,
        pad_y: int,
        line_gap: int,
        quality: str = "white",
        panel_layout: bool = False,
    ) -> None:
        if not lines:
            return
        style = QUALITY_STYLE.get(quality) or QUALITY_STYLE["white"]
        draw = ImageDraw.Draw(canvas)
        x0 = (win_w - bub_w) // 2
        x1 = x0 + bub_w
        y1 = y0 + bub_h
        draw.rounded_rectangle(
            (x0, y0, x1, y1),
            radius=8,
            fill=style["fill"],
            outline=style["outline"],
            width=3 if quality in ("gold", "red") else 2,
        )
        if panel_layout:
            self._draw_panel_bubble_lines(
                draw, lines, x0, y0, y1, bub_w, bubble_font, pad_y, line_gap, style
            )
            return
        ty = y0 + pad_y
        for line in lines:
            bbox = draw.textbbox((0, 0), line, font=bubble_font)
            th = bbox[3] - bbox[1]
            draw.text((x0 + pad_x, ty), line, fill=style["text"], font=bubble_font)
            ty += th + line_gap

    @staticmethod
    def _split_panel_footer(body_lines: list[str]) -> tuple[list[str], list[str]]:
        footers: list[str] = []
        while body_lines and (
            body_lines[-1].startswith("单击切换")
            or body_lines[-1].startswith("滚轮翻页")
        ):
            footers.insert(0, body_lines.pop())
        return body_lines, footers

    def _draw_panel_bubble_lines(
        self,
        draw: ImageDraw.ImageDraw,
        lines: list[str],
        x0: int,
        y0: int,
        y1: int,
        bub_w: int,
        bubble_font,
        pad_y: int,
        line_gap: int,
        style: dict,
    ) -> None:
        body_lines = list(lines)
        body_lines, footers = self._split_panel_footer(body_lines)
        if self._is_novel_panel() and len(body_lines) > NOVEL_PANEL_LINES:
            body_lines = body_lines[:NOVEL_PANEL_LINES]

        measured, footer_sizes, max_tw = self._measure_panel_layout(
            body_lines, footers, bubble_font, line_gap
        )
        pack_footer = self._is_novel_panel()

        footer_block_h = 0
        if footer_sizes:
            footer_block_h = sum(fh + line_gap for _f, fh, _fw in footer_sizes)
            footer_block_h -= line_gap
            footer_block_h += line_gap * 2

        body_area_top = y0 + pad_y
        body_area_bottom = (
            y1 - pad_y - footer_block_h if footer_sizes and not pack_footer else y1 - pad_y
        )

        text_x = x0 + 8 if pack_footer else x0 + max(0, (bub_w - max_tw) // 2)
        ty = body_area_top
        for line, th, _tw in measured:
            if not pack_footer and ty + th > body_area_bottom:
                break
            if line.strip():
                draw.text((text_x, ty), line, fill=style["text"], font=bubble_font)
            ty += th + line_gap

        if pack_footer:
            if footer_sizes:
                ty += line_gap
            for footer, fh, fw in footer_sizes:
                draw.text(
                    (x0 + max(0, (bub_w - fw) // 2), ty),
                    footer,
                    fill=style["text"],
                    font=bubble_font,
                )
                ty += fh + line_gap
            return

        footer_y = y1 - pad_y
        for footer, fh, fw in reversed(footer_sizes):
            footer_y -= fh
            draw.text(
                (x0 + max(0, (bub_w - fw) // 2), footer_y),
                footer,
                fill=style["text"],
                font=bubble_font,
            )
            footer_y -= line_gap

    def _compose(self, frame: Image.Image) -> Image.Image:
        status_raw = (self.bubble_text or "").strip()
        if self._is_panel_text(status_raw):
            status_raw = ""
        panel_raw = (self.panel_text or "").strip()
        short_lines = self._visible_bubble_lines(status_raw) if status_raw else []
        if self._is_novel_panel() and panel_raw:
            panel_lines = self._visible_novel_lines(panel_raw)
        else:
            panel_lines = self._visible_bubble_lines(panel_raw) if panel_raw else []
        pad_x, pad_y = 10, 5
        margin = 8
        line_gap = 2
        ui_font = OVERLAY_FONT
        short_font = ui_font
        panel_font = ui_font
        hud_font = ui_font

        short_w, short_h = self._measure_bubble(short_lines, short_font, pad_x, pad_y, line_gap)
        if panel_lines:
            panel_w, panel_h = self._measure_bubble(
                panel_lines, panel_font, pad_x, pad_y, line_gap
            )
            if self._is_novel_panel():
                panel_w, panel_h = self._novel_panel_box_size(
                    panel_lines, panel_font, pad_x, pad_y, line_gap
                )
        else:
            panel_w, panel_h = 0, 0

        hud_text = self.stats_hud_text or loot_stats_hud()
        hud_measure = ImageDraw.Draw(Image.new("RGBA", (8, 8), (0, 0, 0, 0)))
        hud_bbox = hud_measure.textbbox((0, 0), hud_text, font=hud_font)
        hud_w = (hud_bbox[2] - hud_bbox[0]) + 12
        hud_h = (hud_bbox[3] - hud_bbox[1]) + 6

        top_block = (short_h + 6 if short_lines else 0)
        hud_block = hud_h + 6
        panel_block = (panel_h + 6 if panel_lines else 0)
        win_w = max(FRAME_W, short_w + margin * 2, panel_w + margin * 2, hud_w + margin * 2)
        win_h = top_block + FRAME_H + hud_block + panel_block
        canvas = Image.new("RGBA", (win_w, win_h), (0, 0, 0, 0))
        frame_x = (win_w - FRAME_W) // 2
        frame_y = top_block
        canvas.paste(frame, (frame_x, frame_y), frame)

        if short_lines:
            self._draw_bubble(
                canvas,
                short_lines,
                4,
                win_w,
                short_w,
                short_h,
                short_font,
                pad_x,
                pad_y,
                line_gap,
                self.bubble_quality,
            )

        hud_draw = ImageDraw.Draw(canvas)
        hx0 = (win_w - hud_w) // 2
        hy0 = frame_y + FRAME_H + 3
        hx1 = hx0 + hud_w
        hy1 = hy0 + hud_h
        hud_draw.rounded_rectangle(
            (hx0, hy0, hx1, hy1),
            radius=6,
            fill=(20, 24, 32, 210),
            outline=(90, 100, 120, 220),
            width=1,
        )
        hud_draw.text(
            ((hx0 + hx1) // 2, (hy0 + hy1) // 2),
            hud_text,
            fill=(220, 228, 240, 255),
            font=hud_font,
            anchor="mm",
        )

        if panel_lines:
            self._draw_bubble(
                canvas,
                panel_lines,
                hy1 + 6,
                win_w,
                panel_w,
                panel_h,
                panel_font,
                pad_x,
                pad_y,
                line_gap,
                self.panel_quality,
                panel_layout=True,
            )
        self._layout_feet_x = frame_x + FRAME_W // 2
        self._layout_feet_y = frame_y + FRAME_H
        return canvas

    def _current_frame(self) -> Image.Image:
        row, nframes, _dur = STATES.get(self.state, STATES["idle"])
        row = min(row, len(self.frames) - 1)
        row_frames = self.frames[row]
        nframes = min(nframes, len(row_frames))
        return row_frames[self.frame_i % max(nframes, 1)]

    @staticmethod
    def _measure_panel_layout(
        body_lines: list[str],
        footers: list[str],
        font,
        line_gap: int,
    ) -> tuple[list[tuple[str, int, int]], list[tuple[str, int, int]], int]:
        measure = ImageDraw.Draw(Image.new("RGBA", (8, 8), (0, 0, 0, 0)))
        measured: list[tuple[str, int, int]] = []
        max_tw = 0
        for line in body_lines:
            if line.strip():
                bbox = measure.textbbox((0, 0), line, font=font)
                th = max(1, bbox[3] - bbox[1])
                tw = bbox[2] - bbox[0]
            else:
                # paragraph break: compact gap, not a full blank text row
                th = line_gap
                tw = 0
            max_tw = max(max_tw, tw)
            measured.append((line, th, tw))
        footer_sizes: list[tuple[str, int, int]] = []
        for footer in footers:
            fbbox = measure.textbbox((0, 0), footer, font=font)
            fh = max(1, fbbox[3] - fbbox[1])
            fw = fbbox[2] - fbbox[0]
            footer_sizes.append((footer, fh, fw))
            max_tw = max(max_tw, fw)
        return measured, footer_sizes, max_tw

    def _novel_panel_box_size(
        self,
        lines: list[str],
        font,
        pad_x: int,
        pad_y: int,
        line_gap: int,
    ) -> tuple[int, int]:
        """Width stays fixed; height hugs the current page so the footer is not stranded."""
        body = list(lines)
        body, footers = self._split_panel_footer(body)
        if len(body) > NOVEL_PANEL_LINES:
            body = body[:NOVEL_PANEL_LINES]
        measured, footer_sizes, _max_tw = self._measure_panel_layout(
            body, footers, font, line_gap
        )
        body_h = 0
        for i, (_line, th, _tw) in enumerate(measured):
            body_h += th + (line_gap if i else 0)
        footer_h = 0
        if footer_sizes:
            footer_h = line_gap * 2
            for i, (_f, fh, _fw) in enumerate(footer_sizes):
                footer_h += fh + (line_gap if i else 0)
        return NOVEL_PANEL_BOX_W, pad_y * 2 + body_h + footer_h

    def _paint(self) -> None:
        img = self._compose(self._current_frame())
        bw, bh = img.size
        feet_x = int(getattr(self, "_layout_feet_x", bw // 2))
        feet_y = int(getattr(self, "_layout_feet_y", FRAME_H))
        if self._pin_feet is None or self._dragging:
            self._pin_feet = (
                int(self._pos[0]) + feet_x,
                int(self._pos[1]) + feet_y,
            )
        else:
            pin_x, pin_y = self._pin_feet
            self._pos[0] = int(pin_x - feet_x)
            self._pos[1] = int(pin_y - feet_y)
        self._paint_w = bw
        bgra = premultiply_bgra(img)

        bmi = BITMAPINFO()
        bmi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER)
        bmi.bmiHeader.biWidth = bw
        bmi.bmiHeader.biHeight = bh
        bmi.bmiHeader.biPlanes = 1
        bmi.bmiHeader.biBitCount = 32
        bmi.bmiHeader.biCompression = 0

        bits = c_void_p()
        hbmp = gdi32.CreateDIBSection(self.hdc_mem, byref(bmi), 0, byref(bits), None, 0)
        if not hbmp or not bits or not bits.value:
            if not getattr(self, "_dib_warned", False):
                self._dib_warned = True
                err = windll.kernel32.GetLastError()
                print(f"CreateDIBSection failed err={err}", flush=True)
            return
        ctypes.memmove(bits.value, bgra, len(bgra))
        old = gdi32.SelectObject(self.hdc_mem, hbmp)

        blend = BLENDFUNCTION(AC_SRC_OVER, 0, 255, AC_SRC_ALPHA)
        size = SIZE(bw, bh)
        pt_src = POINT(0, 0)
        pt_dst = POINT(int(self._pos[0]), int(self._pos[1]))
        ok = user32.UpdateLayeredWindow(
            self.hwnd,
            self.hdc_screen,
            byref(pt_dst),
            byref(size),
            self.hdc_mem,
            byref(pt_src),
            0,
            byref(blend),
            ULW_ALPHA,
        )
        if not ok and not getattr(self, "_ulw_warned", False):
            self._ulw_warned = True
            err = windll.kernel32.GetLastError()
            print(f"UpdateLayeredWindow failed err={err}", flush=True)
        gdi32.SelectObject(self.hdc_mem, old)
        gdi32.DeleteObject(hbmp)

    def _tick_anim(self) -> None:
        _row, nframes, cycle_ms = STATES.get(self.state, STATES["idle"])
        nframes = max(nframes, 1)
        interval_ms = max(cycle_ms / nframes, 80.0)
        now = time.monotonic()
        if (now - self._last_frame_at) * 1000 < interval_ms:
            return
        self._last_frame_at = now
        self.frame_i = (self.frame_i + 1) % nframes
        self._paint()

    def _finish_timed_state(self) -> None:
        if self._state_duration_ms is None:
            return
        elapsed_ms = (time.monotonic() - self._state_started_at) * 1000
        if elapsed_ms < self._state_duration_ms:
            return
        self.state = "idle"
        self.bubble_text = ""
        self.bubble_quality = "white"
        self._state_duration_ms = None
        self.frame_i = 0

    def _tick_poll(self) -> None:
        self._maybe_reload_pet()
        st = read_json(RUNTIME / "state.json")
        if st.get("counter") != self.state_counter:
            self.state_counter = st.get("counter", self.state_counter)
            self.state = str(st.get("state") or "idle")
            self.frame_i = 0
            self._state_started_at = time.monotonic()
            dur = st.get("duration")
            self._state_duration_ms = float(dur) if isinstance(dur, (int, float)) else None
            if self.state == "waving" and self._state_duration_ms is None:
                self._state_duration_ms = 1500.0
            if self.state == "jumping" and self._state_duration_ms is None:
                self._state_duration_ms = 800.0

        bub = read_json(RUNTIME / "bubble.json")
        if bub.get("counter") != self.bubble_counter:
            self.bubble_counter = bub.get("counter", self.bubble_counter)
            incoming = str(bub.get("text") or "")
            if self._is_panel_text(incoming):
                # old path wrote panels into bubble.json — keep as panel, not status
                self.panel_text = incoming
                self.panel_quality = str(bub.get("quality") or "white")
            else:
                self.bubble_text = incoming
                self.bubble_quality = str(bub.get("quality") or "white")
            self._paint()

        panel = read_json(RUNTIME / "panel.json")
        if panel.get("counter") != self.panel_counter:
            self.panel_counter = panel.get("counter", self.panel_counter)
            mode = str(panel.get("mode") or "none")
            self.panel_mode = mode
            if mode == "none":
                self.panel_text = ""
                self.panel_quality = "white"
            else:
                self.panel_text = str(panel.get("text") or "")
                self.panel_quality = str(panel.get("quality") or "white")
            self.bubble_scroll = 0
            self._paint()

        hud = loot_stats_hud()
        if hud != self.stats_hud_text:
            self.stats_hud_text = hud
            self._paint()

        self._finish_timed_state()
        self._maybe_exit_without_agent()

    def _agent_running(self) -> bool:
        # Any supported agent IDE alive means the pet has a host.
        names = [n.strip() for n in AGENT_PROCESSES.split(",") if n.strip()]
        if not names:
            return True
        quoted = ",".join("'" + n.replace("'", "''") + "'" for n in names)
        try:
            out = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    f"(Get-Process -Name {quoted} -ErrorAction SilentlyContinue | Measure-Object).Count",
                ],
                capture_output=True,
                text=True,
                timeout=5,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return int((out.stdout or "0").strip() or "0") > 0
        except Exception:
            return True  # fail-open: don't suicide on probe errors

    def _maybe_exit_without_agent(self) -> None:
        # Only hook-managed instances follow the IDE; a manual `petdex up` stays.
        if not AUTO_EXIT:
            return
        # Poll every ~5s (poll timer is 200ms * 25)
        self._agent_check_i = getattr(self, "_agent_check_i", 0) + 1
        if self._agent_check_i % 25 != 0:
            return
        if self._agent_running():
            self._agent_missing_since = None
            return
        now = time.monotonic()
        if self._agent_missing_since is None:
            self._agent_missing_since = now
            return
        if now - self._agent_missing_since >= 12.0:
            win32gui.PostMessage(self.hwnd, win32con.WM_CLOSE, 0, 0)

    def run(self) -> None:
        win32gui.PumpMessages()
        gdi32.DeleteDC(self.hdc_mem)
        user32.ReleaseDC(0, self.hdc_screen)


def main() -> int:
    pid_path = PETDEX / "overlay.pid"
    if pid_path.exists():
        try:
            old = int(pid_path.read_text().strip())
            handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, old)
            if handle:
                ctypes.windll.kernel32.CloseHandle(handle)
                print(f"overlay already running pid={old}")
                return 0
        except Exception:
            pass

    pid_path.write_text(str(os.getpid()), encoding="utf-8")
    try:
        PetOverlay().run()
    finally:
        try:
            pid_path.unlink(missing_ok=True)
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
