"""Render N Streams' Android branding: TV banner, launcher icons, splash.

The mark is the geometric "N" from public/icon.png, redrawn as vectors from its
measured geometry (two 60-unit stems + a 60-unit-wide diagonal on a 512 canvas)
so every size is crisp instead of upscaled. The banner's wordmark mirrors the
app's own top-bar lockup: indigo N with a glow, then "STREAMS" in Bebas Neue,
baseline-aligned (src/components/TopNav.jsx).

usage: python scripts/make_android_branding.py --font path/to/BebasNeue-Regular.ttf
       [--preview out.png]
Bebas Neue (OFL): https://github.com/google/fonts/tree/main/ofl/bebasneue
"""
import argparse
import pathlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
RES = ROOT / "android" / "app" / "src" / "main" / "res"

INDIGO = (99, 102, 241)          # tailwind accent / icon N
BG_CENTER = (37, 37, 75)         # measured from public/icon.png
BG_EDGE = (9, 9, 18)
APP_BG = (7, 7, 20)              # capacitor android.backgroundColor #070714
SS = 4                           # supersampling factor

# Geometry in public/icon.png's 512-unit space.
N_POLYS = [
    [(120, 110), (180, 110), (180, 410), (120, 410)],   # left stem
    [(332, 110), (392, 110), (392, 410), (332, 410)],   # right stem
    [(180, 110), (240, 110), (392, 410), (332, 410)],   # diagonal
]
N_W, N_H = 272, 300


def radial(w, h, cx, cy, radius, inner=BG_CENTER, outer=BG_EDGE):
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    t = np.clip(np.hypot(xx - cx, yy - cy) / radius, 0, 1)[..., None]
    rgb = np.array(inner, np.float32) * (1 - t) + np.array(outer, np.float32) * t
    return Image.fromarray(rgb.round().astype(np.uint8), "RGB")


def n_mask(w, h, x0, y0, nh):
    """Anti-aliased L mask of the N, top-left at (x0, y0), nh tall."""
    m = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(m)
    s = nh / N_H * SS
    for poly in N_POLYS:
        d.polygon([(x0 * SS + (x - 120) * s, y0 * SS + (y - 110) * s) for x, y in poly], fill=255)
    return m.resize((w, h), Image.LANCZOS)


def paint(base, mask, color, alpha=1.0):
    layer = Image.new("RGB", base.size, color)
    a = mask if alpha == 1.0 else mask.point(lambda v: int(v * alpha))
    base.paste(layer, (0, 0), a)


def glow(base, mask, nh, strength=0.55):
    blur = mask.filter(ImageFilter.GaussianBlur(radius=max(1.0, nh * 0.09)))
    paint(base, blur, INDIGO, strength)


def draw_n(base, x0, y0, nh, with_glow=True):
    m = n_mask(base.width, base.height, x0, y0, nh)
    if with_glow:
        glow(base, m, nh)
    paint(base, m, INDIGO)


# ─── TV banner ──────────────────────────────────────────────────────────────

def banner(font_path, w=960, h=540):
    nh = round(h * 0.30)
    nw = nh * N_W / N_H
    # TopNav: N text-3xl vs STREAMS text-2xl, baseline-aligned → caps at 0.8×.
    probe = ImageFont.truetype(str(font_path), 200)
    cap_ratio = (probe.getbbox("S")[3] - probe.getbbox("S")[1]) / 200
    size = round(nh * 0.80 / cap_ratio)
    font = ImageFont.truetype(str(font_path), size * SS)
    track = 0.05 * size * SS                      # tracking-wider
    word = "STREAMS"
    adv = [font.getlength(c) + track for c in word]
    word_w = (sum(adv) - track) / SS
    # Wider than TopNav's gap-1.5: at Projectivy card size (~190px) a tighter
    # gap fuses the N's right stem into the S and it reads "NSTREAMS".
    gap = nh * 0.30
    total = nw + gap + word_w
    x0 = (w - total) / 2
    y0 = (h - nh) / 2

    img = radial(w, h, w / 2, h / 2, np.hypot(w, h) * 0.55)
    draw_n(img, x0, y0, nh)

    txt = Image.new("L", (w * SS, h * SS), 0)
    d = ImageDraw.Draw(txt)
    x = (x0 + nw + gap) * SS
    baseline = (y0 + nh) * SS
    for c, a in zip(word, adv):
        d.text((x, baseline), c, font=font, fill=255, anchor="ls")
        x += a
    paint(img, txt.resize((w, h), Image.LANCZOS), (255, 255, 255), 0.92)
    return img


# ─── launcher icons ─────────────────────────────────────────────────────────

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {k: v * 108 // 48 for k, v in LEGACY.items()}   # 108dp layers


def full_icon(s):
    """Background + N, as in public/icon.png (N 58.6% tall, a hair below centre)."""
    img = radial(s, s, s / 2, s / 2, s * 0.7071)
    nh = s * 300 / 512
    draw_n(img, s * 120 / 512, s * 110 / 512, nh)
    return img


def masked(img, shape):
    s = img.width
    m = Image.new("L", (s * SS, s * SS), 0)
    d = ImageDraw.Draw(m)
    if shape == "round":
        d.ellipse([0, 0, s * SS - 1, s * SS - 1], fill=255)
    else:
        d.rounded_rectangle([0, 0, s * SS - 1, s * SS - 1], radius=s * SS * 0.22, fill=255)
    out = img.convert("RGBA")
    out.putalpha(m.resize((s, s), Image.LANCZOS))
    return out


def adaptive_foreground(s):
    """N on transparency, sized like public/icon.png within the 72dp visible
    area (42/72dp ≈ 58%), its bbox diagonal well inside the 66dp safe circle."""
    nh = s * 42 / 108
    nw = nh * N_W / N_H
    x0, y0 = (s - nw) / 2, (s - nh) / 2
    m = n_mask(s, s, x0, y0, nh)
    g = m.filter(ImageFilter.GaussianBlur(radius=max(1.0, nh * 0.09))).point(lambda v: int(v * 0.5))
    out = Image.new("RGBA", (s, s), INDIGO + (0,))
    out.putalpha(Image.fromarray(np.maximum(np.asarray(m), np.asarray(g)).astype(np.uint8), "L"))
    return out


# ─── splash (pre-Android-12; 12+ uses theme colour + foreground) ───────────

def splash(w, h):
    img = radial(w, h, w / 2, h / 2, np.hypot(w, h) / 2, inner=(28, 28, 58), outer=APP_BG)
    nh = min(w, h) * 0.20
    nw = nh * N_W / N_H
    draw_n(img, (w - nw) / 2, (h - nh) / 2, nh)
    return img


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True, type=pathlib.Path)
    ap.add_argument("--preview", type=pathlib.Path)
    args = ap.parse_args()

    out = []

    def save(img, rel):
        p = RES / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        img.save(p, optimize=True)
        out.append(rel)

    b = banner(args.font)
    save(b, "drawable-nodpi/banner.png")

    for dens, s in LEGACY.items():
        icon = full_icon(s)
        save(masked(icon, "square"), f"mipmap-{dens}/ic_launcher.png")
        save(masked(icon, "round"), f"mipmap-{dens}/ic_launcher_round.png")
    for dens, s in ADAPTIVE.items():
        save(adaptive_foreground(s), f"mipmap-{dens}/ic_launcher_foreground.png")
        save(radial(s, s, s / 2, s / 2, s * 0.7071), f"mipmap-{dens}/ic_launcher_background.png")

    for p in sorted(RES.glob("drawable*/splash.png")):
        w, h = Image.open(p).size
        save(splash(w, h), p.relative_to(RES).as_posix())

    print(f"wrote {len(out)} files")
    if args.preview:
        big = ADAPTIVE["xxxhdpi"]
        fg = adaptive_foreground(big)
        adaptive = radial(big, big, big / 2, big / 2, big * 0.7071).convert("RGBA")
        adaptive.alpha_composite(fg)
        adaptive = masked(adaptive.convert("RGB").crop((72, 72, 360, 360)).resize((216, 216)), "round")
        legacy = masked(full_icon(192), "square")
        sheet = Image.new("RGB", (1500, 720), (40, 40, 40))
        sheet.paste(b.resize((800, 450)), (20, 20))
        sheet.paste(b.resize((245, 138)), (840, 20))        # focused Projectivy card size
        sheet.paste(b.resize((188, 106)), (840, 180))       # unfocused card size
        sheet.paste(adaptive, (1110, 20), adaptive)
        sheet.paste(legacy, (1110, 260), legacy)
        sheet.paste(splash(1280, 720).resize((380, 214)), (20, 490))
        sheet.save(args.preview)
        print("preview:", args.preview)


if __name__ == "__main__":
    main()
