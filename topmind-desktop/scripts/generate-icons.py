#!/usr/bin/env python3
"""
Generate topmind Desktop app icons for macOS / Windows / Linux / renderer.

Style: macOS-like app tile — white rounded rectangle plate + centered mark.

Source (prefer first existing):
  1. topmind_ICON_SOURCE env — raw photo/PNG (black matte stripped)
  2. build/logo-mark.png     — transparent mark only (preferred for re-gen)
  3. build/logo-source.png / build/icon.png — existing masters

Outputs (electron-builder buildResources = build/):
  build/logo-mark.png         transparent mark (re-gen input)
  build/icon.png              transparent mark (Linux / generic default)
  build/icon-mac.png          white rounded plate + mark (macOS Dock optical size)
  build/icon-win.png          fuller transparent mark for Windows ICO source
  build/icon.ico              multi-size Windows
  build/icon.icns             macOS (from white plate master)
  build/icons/{16..1024}.png  Linux icon theme sizes (transparent)
  public/favicon-*.png        renderer chrome (transparent)
  public/apple-touch-icon.png iOS-style plate tile
  electron/assets/icon.png    runtime BrowserWindow (transparent)
  electron/assets/icon-mac.png  runtime Dock setIcon plate (packaged asar)
  electron/assets/icon.ico    runtime Windows

macOS notes (evidence-based — measured against real Dock peers on macOS):

  Geometry (1024 canvas), from shipping apps on this machine:
    Messages / VS Code / Claude: plate ≈ 824×824 (80.5%), inset 100px (9.8%) each side
    Obsidian: plate ≈ 830 (81.1%), inset ~97px
    Corner radius ≈ 24–27% of PLATE (not of full canvas)

  Why not "full-bleed + system mask":
    Apple HIG says full-bleed for native Icon Composer layers. Electron is different:
    - app.dock.setIcon(PNG) paints pixels as-is (no system squircle).
    - Production Electron apps (VS Code, Claude, Obsidian) ship PRE-MASKED .icns
      with ~10% transparent margin so optical size matches system peers.
    - Full-canvas plate (inset 0) looks ~25% larger linear mass in Dock.
    - Full-bleed opaque square under setIcon → hard white rectangle.

  icon-mac.png + .icns = pre-masked white plate at peer geometry + centered mark.
  electron-builder uses build/icon.icns; dev patch-electron-icon + setIcon(PNG).

Requires: Pillow, iconutil (macOS only for .icns).
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
except ImportError:
    sys.stderr.write("Pillow required: pip install Pillow\n")
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    np = None  # type: ignore

DESKTOP = Path(__file__).resolve().parent.parent
BUILD = DESKTOP / "build"
PUBLIC = DESKTOP / "public"

MASTER_SIZE = 1024
# Peer Dock geometry (VS Code / Claude / Messages on 1024): 100px inset → 824 plate (80.5%).
# Stack Overflow / Apple grid often cite 13/16 = 832; measured peers use 824 (100/1024).
CANVAS_INSET_RATIO = 100 / MASTER_SIZE  # 0.09765625
# Radius as fraction of PLATE edge (measured ~24–27% on peers).
PLATE_RADIUS_RATIO = 0.25
# Mark safe margin inside the white plate.
MARK_MARGIN_RATIO = 0.10
# Windows ICO: fuller transparent glyph (no forced white plate).
WIN_CANVAS_INSET_RATIO = 0.0
WIN_MARK_MARGIN_RATIO = 0.04
# Fail the build if the coloured mark occupies too little of the master (regression guard).
MIN_MARK_FILL_RATIO = 0.55
# mac master: plate must stay near peer optical size (not 100% full-canvas).
MAC_PLATE_FILL_MIN = 0.78
MAC_PLATE_FILL_MAX = 0.84
WHITE = (255, 255, 255, 255)


def remove_black_bg(im: Image.Image, hard: int = 18, soft: int = 42) -> Image.Image:
    """Near-black matte → transparent with soft feathering."""
    if np is None:
        rgba = im.convert("RGBA")
        datas = rgba.getdata()
        out = []
        for r, g, b, a in datas:
            mx = max(r, g, b)
            if mx < hard:
                out.append((0, 0, 0, 0))
            elif mx < soft:
                alpha = int(255 * (mx - hard) / max(soft - hard, 1))
                out.append((r, g, b, alpha))
            else:
                out.append((r, g, b, a))
        rgba.putdata(out)
        return rgba

    arr = np.array(im.convert("RGBA"), dtype=np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    mx = np.maximum(np.maximum(r, g), b)
    alpha = np.clip((mx - hard) / max(soft - hard, 1), 0, 1)
    sat = mx - np.minimum(np.minimum(r, g), b)
    dark = (mx < soft) & (sat < 12)
    alpha = np.where(dark, alpha * 0.15, alpha)
    arr[:, :, 3] = (alpha * 255).astype(np.uint8)
    mask0 = arr[:, :, 3] == 0
    arr[mask0, 0:3] = 0
    return Image.fromarray(arr.astype(np.uint8), "RGBA")


def trim_transparent(im: Image.Image) -> Image.Image:
    bbox = im.getbbox()
    return im.crop(bbox) if bbox else im


def make_square(im: Image.Image, pad_ratio: float = 0.0) -> Image.Image:
    im = trim_transparent(im)
    w, h = im.size
    side = max(w, h)
    pad = int(side * pad_ratio)
    canvas_side = side + pad * 2
    canvas = Image.new("RGBA", (canvas_side, canvas_side), (0, 0, 0, 0))
    canvas.paste(im, ((canvas_side - w) // 2, (canvas_side - h) // 2), im)
    return canvas


def resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.Resampling.LANCZOS)


def rounded_plate(
    size: int,
    fill: tuple[int, int, int, int] = WHITE,
    radius_ratio: float = PLATE_RADIUS_RATIO,
) -> Image.Image:
    """Opaque white continuous-style rounded rectangle (macOS app tile)."""
    # Supersample for cleaner corner AA, then downscale.
    ss = 4 if size >= 64 else 1
    big = size * ss
    plate = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(plate)
    radius = max(1, int(big * radius_ratio))
    draw.rounded_rectangle((0, 0, big - 1, big - 1), radius=radius, fill=fill)
    if ss > 1:
        plate = plate.resize((size, size), Image.Resampling.LANCZOS)
    return plate


def compose_on_white_plate(
    mark: Image.Image,
    size: int = MASTER_SIZE,
    margin_ratio: float = MARK_MARGIN_RATIO,
    radius_ratio: float = PLATE_RADIUS_RATIO,
    canvas_inset_ratio: float = CANVAS_INSET_RATIO,
) -> Image.Image:
    """
    Pre-masked white plate + centered mark on transparent canvas.

    Used for Dock setIcon, .icns, and apple-touch. Transparent corners are
    required so Electron app.dock.setIcon does not show a hard rectangle.
    """
    inset = max(0, int(round(size * canvas_inset_ratio)))
    plate_size = max(1, size - 2 * inset)

    plate_local = rounded_plate(plate_size, WHITE, radius_ratio)
    mark = make_square(mark.convert("RGBA"), pad_ratio=0.0)
    content = max(1, int(plate_size * (1.0 - 2.0 * margin_ratio)))
    mark_r = resize(mark, content)

    mx = (plate_size - content) // 2
    tile = plate_local.copy()
    tile.paste(mark_r, (mx, mx), mark_r)

    mask_local = rounded_plate(plate_size, (255, 255, 255, 255), radius_ratio).split()[3]
    white_base = Image.new("RGBA", (plate_size, plate_size), WHITE)
    under = Image.composite(tile, white_base, tile.split()[3])
    r, g, b, _ = under.split()
    plate_rgba = Image.merge("RGBA", (r, g, b, mask_local))

    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(plate_rgba, (inset, inset), plate_rgba)
    return canvas


def compose_mac_dock_master(
    mark: Image.Image,
    size: int = MASTER_SIZE,
    margin_ratio: float = MARK_MARGIN_RATIO,
) -> Image.Image:
    """
    macOS Dock / .icns master matching shipping peer geometry.

    Transparent canvas margin (~9.8%) + rounded white plate (~80.5% of canvas)
    + mark. Same envelope as VS Code / Claude / Messages measured on disk.
    """
    return compose_on_white_plate(
        mark,
        size=size,
        margin_ratio=margin_ratio,
        radius_ratio=PLATE_RADIUS_RATIO,
        canvas_inset_ratio=CANVAS_INSET_RATIO,
    )


def plate_fill_ratio(master: Image.Image) -> float:
    """Fraction of canvas covered by the opaque plate bbox (α≥200)."""
    rgba = master.convert("RGBA")
    w, h = rgba.size
    if np is not None:
        arr = np.array(rgba)
        a = arr[:, :, 3]
        ys, xs = np.where(a >= 200)
        if len(xs) == 0:
            return 0.0
        return min((int(xs.max()) - int(xs.min()) + 1) / w, (int(ys.max()) - int(ys.min()) + 1) / h)
    minx, miny, maxx, maxy = w, h, -1, -1
    for i, (_r, _g, _b, a) in enumerate(rgba.getdata()):
        if a < 200:
            continue
        x, y = i % w, i // w
        if x < minx:
            minx = x
        if y < miny:
            miny = y
        if x > maxx:
            maxx = x
        if y > maxy:
            maxy = y
    if maxx < 0:
        return 0.0
    return min((maxx - minx + 1) / w, (maxy - miny + 1) / h)


def looks_like_white_plate(im: Image.Image) -> bool:
    """Heuristic: corners nearly white & opaque → already a plate master."""
    rgba = im.convert("RGBA")
    w, h = rgba.size
    samples = [
        rgba.getpixel((2, 2)),
        rgba.getpixel((w - 3, 2)),
        rgba.getpixel((2, h - 3)),
        rgba.getpixel((w - 3, h - 3)),
    ]
    for r, g, b, a in samples:
        if a < 200:
            return False
        if min(r, g, b) < 240:
            return False
    return True


def extract_mark_from_plate(im: Image.Image) -> Image.Image:
    """
    If the input is already a white-plate icon, pull out non-white content
    as a transparent mark so we can re-compose cleanly.
    """
    arr = None
    if np is not None:
        arr = np.array(im.convert("RGBA"), dtype=np.int16)
        r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
        # Near-white pixels → transparent
        near_white = (r > 245) & (g > 245) & (b > 245) & (a > 200)
        arr = arr.astype(np.uint8)
        arr[near_white, 3] = 0
        mark = Image.fromarray(arr, "RGBA")
    else:
        mark = im.convert("RGBA")
        px = mark.load()
        w, h = mark.size
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[x, y]
                if a > 200 and r > 245 and g > 245 and b > 245:
                    px[x, y] = (0, 0, 0, 0)
    return trim_transparent(mark)


def load_mark() -> Image.Image:
    """Load transparent logo mark (not the white plate)."""
    env = os.environ.get("topmind_ICON_SOURCE")
    if env and Path(env).is_file():
        p = Path(env)
        print(f"[generate-icons] mark from raw source {p}")
        return make_square(remove_black_bg(Image.open(p)), pad_ratio=0.02)

    mark_path = BUILD / "logo-mark.png"
    if mark_path.is_file():
        print(f"[generate-icons] mark from {mark_path}")
        return make_square(Image.open(mark_path).convert("RGBA"), pad_ratio=0.0)

    for p in (BUILD / "logo-source.png", BUILD / "icon.png"):
        if not p.is_file():
            continue
        im = Image.open(p).convert("RGBA")
        if looks_like_white_plate(im):
            print(f"[generate-icons] extracting mark from white plate {p}")
            return make_square(extract_mark_from_plate(im), pad_ratio=0.0)
        # Transparent master already
        print(f"[generate-icons] mark from transparent {p}")
        return make_square(im, pad_ratio=0.0)

    sys.stderr.write(
        "No icon source found. Place build/logo-mark.png or set topmind_ICON_SOURCE.\n"
    )
    sys.exit(1)


def mark_fill_ratio(master: Image.Image) -> float:
    """Fraction of canvas occupied by non-white, opaque mark pixels (bbox / size)."""
    rgba = master.convert("RGBA")
    w, h = rgba.size
    if np is not None:
        arr = np.array(rgba)
        r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
        content = (a >= 40) & ~((r > 245) & (g > 245) & (b > 245))
        ys, xs = np.where(content)
        if len(xs) == 0:
            return 0.0
        bw = int(xs.max() - xs.min() + 1)
        bh = int(ys.max() - ys.min() + 1)
        return min(bw / w, bh / h)
    xs: list[int] = []
    ys: list[int] = []
    for i, (r, g, b, a) in enumerate(rgba.getdata()):
        if a < 40 or (r > 245 and g > 245 and b > 245):
            continue
        xs.append(i % w)
        ys.append(i // w)
    if not xs:
        return 0.0
    return min((max(xs) - min(xs) + 1) / w, (max(ys) - min(ys) + 1) / h)


def write_ico(master: Image.Image, path: Path) -> None:
    """Multi-size Windows ICO from a fuller master (prefer win-composed canvas)."""
    sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    # Pillow ICO: save largest first; sizes= embeds each resolution.
    resize(master, 256).save(path, format="ICO", sizes=sizes)


def _mac_iconset_entries() -> list[tuple[str, int]]:
    """Apple .iconset names (1x + @2x). Built with f-strings so '@2x' cannot be mangled to emails."""
    entries: list[tuple[str, int]] = []
    for logical, px_1x in ((16, 16), (32, 32), (128, 128), (256, 256), (512, 512)):
        entries.append((f"icon_{logical}x{logical}.png", px_1x))
        entries.append((f"icon_{logical}x{logical}@2x.png", px_1x * 2))
    return entries


def write_icns(master: Image.Image, path: Path) -> None:
    iconset = BUILD / "icon.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    iconset.mkdir()
    entries = _mac_iconset_entries()
    # Expect 10 files: 16/32/128/256/512 each at 1x and @2x (up to 1024px)
    assert len(entries) == 10, entries
    for name, px in entries:
        # Always pass format= keyword — Path ends with "@2x.png"; bare save() can mis-detect ext
        resize(master, px).save(iconset / name, format="PNG")

    written = sorted(p.name for p in iconset.iterdir())
    expected = sorted(n for n, _ in entries)
    if written != expected:
        raise RuntimeError(f"iconset incomplete: got {written}, expected {expected}")

    if sys.platform != "darwin":
        print("[generate-icons] skip .icns (iconutil is macOS-only); iconset written for CI mac runners")
        return

    subprocess.check_call(
        ["iconutil", "-c", "icns", str(iconset), "-o", str(path)],
    )
    shutil.rmtree(iconset, ignore_errors=True)


def compose_transparent_master(
    mark: Image.Image,
    size: int = MASTER_SIZE,
    margin_ratio: float = 0.08,
) -> Image.Image:
    """Centered transparent mark on transparent canvas (Win / Linux / extension)."""
    mark = make_square(mark.convert("RGBA"), pad_ratio=0.0)
    content = max(1, int(size * (1.0 - 2.0 * margin_ratio)))
    mark_r = resize(mark, content)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mx = (size - content) // 2
    canvas.paste(mark_r, (mx, mx), mark_r)
    return canvas


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)

    mark = load_mark()
    # Cap mark at MASTER_SIZE so repo assets stay small (raw 4K sources must not land in git)
    mark = make_square(trim_transparent(mark.convert("RGBA")), pad_ratio=0.0)
    mark = resize(mark, MASTER_SIZE) if max(mark.size) > MASTER_SIZE else mark
    # Persist transparent mark for future re-gens without re-keying white
    mark.save(BUILD / "logo-mark.png", "PNG", optimize=True)

    # macOS Dock / .icns: pre-masked continuous white plate (setIcon paints as-is)
    mac_master = compose_mac_dock_master(mark, MASTER_SIZE, margin_ratio=MARK_MARGIN_RATIO)
    # Win / Linux / generic: transparent mark only (no forced white plate)
    bare_master = compose_transparent_master(mark, MASTER_SIZE, margin_ratio=0.06)
    bare_master.save(BUILD / "icon.png", "PNG", optimize=True)
    bare_master.save(BUILD / "logo-source.png", "PNG", optimize=True)
    resize(bare_master, 512).save(BUILD / "icon-512.png", "PNG", optimize=True)

    # Windows ICO: fuller transparent glyph (Explorer still OK without white plate)
    win_master = compose_transparent_master(mark, MASTER_SIZE, margin_ratio=WIN_MARK_MARGIN_RATIO)
    win_master.save(BUILD / "icon-win.png", "PNG", optimize=True)

    icons_dir = BUILD / "icons"
    icons_dir.mkdir(exist_ok=True)
    for s in (16, 32, 48, 64, 128, 256, 512, 1024):
        resize(bare_master, s).save(icons_dir / f"{s}x{s}.png", "PNG", optimize=True)

    write_ico(win_master, BUILD / "icon.ico")
    write_icns(mac_master, BUILD / "icon.icns")
    mac_master.save(BUILD / "icon-mac.png", "PNG", optimize=True)

    # Browser extension icons (transparent mark)
    ext_dir = DESKTOP.parent / "browser-extension" / "icons"
    ext_dir.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        resize(bare_master, s).save(ext_dir / f"icon-{s}.png", "PNG", optimize=True)
    print(f"[generate-icons] extension icons → {ext_dir}")

    for s, name in (
        (16, "favicon-16.png"),
        (32, "favicon-32.png"),
        (256, "icon-256.png"),
    ):
        resize(bare_master, s).save(PUBLIC / name, "PNG", optimize=True)
    # apple-touch: same pre-rounded plate (iOS home screen)
    resize(mac_master, 180).save(PUBLIC / "apple-touch-icon.png", "PNG", optimize=True)

    assets = DESKTOP / "electron" / "assets"
    assets.mkdir(parents=True, exist_ok=True)
    # Runtime paths shipped inside asar (build/ is NOT packed by electron-builder).
    resize(bare_master, 256).save(assets / "icon.png", "PNG", optimize=True)
    # Dock setIcon: pre-masked plate PNG (512) — corners transparent
    resize(mac_master, 512).save(assets / "icon-mac.png", "PNG", optimize=True)
    write_ico(win_master, assets / "icon.ico")

    # Integrity: bare transparent + mac peer geometry plate
    corner = bare_master.getpixel((0, 0))
    fill = mark_fill_ratio(bare_master)
    win_fill = mark_fill_ratio(win_master)
    mac_mark_fill = mark_fill_ratio(mac_master)
    mac_plate = plate_fill_ratio(mac_master)
    if corner[3] != 0:
        sys.stderr.write(f"[generate-icons] WARN bare icon corner should be transparent: {corner}\n")
    mac_corner = mac_master.getpixel((0, 0))
    mac_edge = mac_master.getpixel((MASTER_SIZE // 2, 0))
    # Canvas corners + mid-edge must be transparent (peer ~10% margin)
    if mac_corner[3] > 20:
        sys.stderr.write(
            f"[generate-icons] ERROR mac master corner must be transparent: {mac_corner}\n"
        )
        sys.exit(1)
    if mac_edge[3] > 20:
        sys.stderr.write(
            f"[generate-icons] ERROR mac mid-edge must be transparent (need ~10% inset like VS Code): "
            f"{mac_edge}\n"
        )
        sys.exit(1)
    # Plate interior (center of top plate edge) should be opaque white
    inset_px = int(round(MASTER_SIZE * CANVAS_INSET_RATIO))
    plate_top_mid = mac_master.getpixel((MASTER_SIZE // 2, inset_px + 2))
    if plate_top_mid[3] < 250 or min(plate_top_mid[0], plate_top_mid[1], plate_top_mid[2]) < 250:
        sys.stderr.write(f"[generate-icons] WARN mac plate top not opaque white: {plate_top_mid}\n")
    if not (MAC_PLATE_FILL_MIN <= mac_plate <= MAC_PLATE_FILL_MAX):
        sys.stderr.write(
            f"[generate-icons] ERROR mac plate fill {mac_plate:.1%} outside peer range "
            f"[{MAC_PLATE_FILL_MIN:.0%}, {MAC_PLATE_FILL_MAX:.0%}] "
            f"(Messages/VS Code/Claude ≈ 80.5%)\n"
        )
        sys.exit(1)
    print(
        f"[generate-icons] bare fill={fill:.1%} win_fill={win_fill:.1%} "
        f"mac_plate={mac_plate:.1%} mac_mark={mac_mark_fill:.1%} "
        f"mac_corner={mac_corner} mac_edge_a={mac_edge[3]} plate_top={plate_top_mid}"
    )
    if fill < MIN_MARK_FILL_RATIO:
        sys.stderr.write(
            f"[generate-icons] ERROR bare mark fill {fill:.1%} < min {MIN_MARK_FILL_RATIO:.0%}\n"
        )
        sys.exit(1)
    if win_fill < MIN_MARK_FILL_RATIO:
        sys.stderr.write(
            f"[generate-icons] ERROR win mark fill {win_fill:.1%} < min {MIN_MARK_FILL_RATIO:.0%}\n"
        )
        sys.exit(1)

    print(
        "[generate-icons] OK — transparent bare (Win/Linux/ext) + peer-geometry white plate "
        f"(~{mac_plate:.0%} canvas, mac Dock / .icns)"
    )
    for rel in (
        "build/logo-mark.png",
        "build/icon.png",
        "build/icon-mac.png",
        "build/icon-win.png",
        "build/icon.ico",
        "build/icon.icns",
        "build/icons/512x512.png",
        "electron/assets/icon.png",
        "electron/assets/icon-mac.png",
        "electron/assets/icon.ico",
        "public/favicon-32.png",
    ):
        p = DESKTOP / rel
        if p.exists():
            print(f"  {rel}  ({p.stat().st_size} bytes)")
        else:
            print(f"  {rel}  MISSING")


if __name__ == "__main__":
    main()
