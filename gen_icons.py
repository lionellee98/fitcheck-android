"""Generate branded launcher + splash assets for the 健身打卡 Capacitor app."""
import os
from PIL import Image, ImageDraw

RES = r"C:/Users/Administrator/WorkBuddy/2026-07-27-09-23-40/android/app/src/main/res"
C1 = (0x12, 0xb7, 0x6a)   # green  #12b76a
C2 = (0x0b, 0xa5, 0xec)   # blue   #0ba5ec
WHITE = (255, 255, 255, 255)


def gradient(w, h):
    img = Image.new('RGBA', (w, h))
    px = img.load()
    denom = (w + h) or 1
    for y in range(h):
        for x in range(w):
            t = (x + y) / denom
            r = int(C1[0] + (C2[0] - C1[0]) * t)
            g = int(C1[1] + (C2[1] - C1[1]) * t)
            b = int(C1[2] + (C2[2] - C1[2]) * t)
            px[x, y] = (r, g, b, 255)
    return img


def draw_dumbbell(draw, S, offx=0, offy=0):
    s = S / 108.0
    r = max(1, int(3 * s))
    rb = max(1, int(2 * s))
    # plates (left & right)
    draw.rounded_rectangle([22 * s + offx, 45 * s + offy, 34 * s + offx, 63 * s + offy],
                           radius=r, fill=WHITE)
    draw.rounded_rectangle([74 * s + offx, 45 * s + offy, 86 * s + offx, 63 * s + offy],
                           radius=r, fill=WHITE)
    # bar
    draw.rounded_rectangle([34 * s + offx, 52 * s + offy, 74 * s + offx, 56 * s + offy],
                           radius=rb, fill=WHITE)


def circular_mask(size):
    mask = Image.new('L', (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    return mask


# ---- launcher icons (adaptive legacy raster) ----
mipmaps = [("mipmap-mdpi", 48), ("mipmap-hdpi", 72), ("mipmap-xhdpi", 96),
           ("mipmap-xxhdpi", 144), ("mipmap-xxxhdpi", 192)]

for folder, S in mipmaps:
    out = os.path.join(RES, folder)
    os.makedirs(out, exist_ok=True)
    # square full-bleed gradient + dumbbell
    base = gradient(S, S)
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw_dumbbell(ImageDraw.Draw(layer), S)
    sq = Image.alpha_composite(base, layer)
    sq.save(os.path.join(out, "ic_launcher.png"))
    # round (circle mask)
    rd = sq.copy()
    rd.putalpha(circular_mask(S))
    rd.save(os.path.join(out, "ic_launcher_round.png"))
    # foreground only (transparent bg)
    fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw_dumbbell(ImageDraw.Draw(fg), S)
    fg.save(os.path.join(out, "ic_launcher_foreground.png"))
    print("launcher", folder, S)

# ---- splash (paint over existing sizes) ----
splash_files = []
for root, _, files in os.walk(RES):
    for f in files:
        if f == "splash.png":
            splash_files.append(os.path.join(root, f))

for path in splash_files:
    with Image.open(path) as cur:
        w, h = cur.size
    base = gradient(w, h)
    scale = min(w, h) / 108.0
    offx = (w - 108 * scale) / 2.0
    offy = (h - 108 * scale) / 2.0
    layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    draw_dumbbell(ImageDraw.Draw(layer), 108 * scale, offx, offy)
    out = Image.alpha_composite(base, layer).convert('RGB')
    out.save(path)
    print("splash", os.path.relpath(path, RES), w, "x", h)

print("DONE")
