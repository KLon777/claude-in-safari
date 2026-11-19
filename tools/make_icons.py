#!/usr/bin/env python3
"""Generate the Claude in Safari icons (original artwork): a browser window with a pointer on a lemon-orange tile."""
import json, os
from PIL import Image, ImageDraw, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
S = 2048  # supersampled canvas
TOP, BOT = (255, 224, 70), (255, 120, 30)


def mix(c, t, a):
    return tuple(int(c[i] + (t[i] - c[i]) * a) for i in range(3))


def tile():
    # vertical gradient lemon -> orange
    g = Image.new("RGB", (S, S))
    d = ImageDraw.Draw(g)
    for y in range(S):
        d.line([(0, y), (S, y)], fill=mix(TOP, BOT, y / (S - 1)))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.2237), fill=255)
    img = g.convert("RGBA")
    img.putalpha(mask)
    return img, mask


def shadowed(img, draw_fn, off, alpha):
    lay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(lay), off, (0, 0, 0, alpha))
    return Image.alpha_composite(img, lay)


def pointer(d, x, y, k, fill, outline, w, off=(0, 0)):
    pts = [(0, 0), (0, 1.0), (0.27, 0.77), (0.47, 1.17), (0.63, 1.09), (0.43, 0.70), (0.78, 0.70)]
    d.polygon([(x + off[0] + px * k, y + off[1] + py * k) for px, py in pts], fill=fill, outline=outline, width=w)


def art():
    img, mask = tile()
    win = (int(S * .15), int(S * .22), int(S * .85), int(S * .78))
    img = shadowed(img, lambda d, o, c: d.rounded_rectangle([win[0] + o[0], win[1] + o[1], win[2] + o[0], win[3] + o[1]], radius=140, fill=c), (0, 36), 70)
    d = ImageDraw.Draw(img)
    bar = mix(TOP, (255, 255, 255), .78) + (255,)
    bar_h = int(S * .15)
    d.rounded_rectangle(win, radius=140, fill=(255, 255, 255, 255))
    d.rounded_rectangle((win[0], win[1], win[2], win[1] + bar_h), radius=140, fill=bar)
    d.rectangle((win[0], win[1] + int(S * .08), win[2], win[1] + bar_h), fill=bar)
    for i, c in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 64))):  # macOS close / minimise / full-screen
        cx = win[0] + int(S * .08) + i * int(S * .075)
        cy = win[1] + int(S * .075)
        d.ellipse((cx - 48, cy - 48, cx + 48, cy + 48), fill=c + (255,))
    x, y, k = int(S * .46), int(S * .44), S * .40
    img = shadowed(img, lambda dd, o, c: pointer(dd, x, y, k, c, None, 0, o), (20, 32), 90)
    pointer(ImageDraw.Draw(img), x, y, k, mix(BOT, (0, 0, 0), .65) + (255,), (255, 255, 255, 255), 44)
    img.putalpha(ImageChops.multiply(img.getchannel("A"), mask))
    return img


def save(img, size, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(path)


master = art()

# 1) Web extension icons
ext_icons = {}
for n in (16, 32, 48, 96, 128, 256):
    save(master, n, os.path.join(ROOT, "extension", f"icon-{n}.png"))
    ext_icons[str(n)] = f"icon-{n}.png"
mf = os.path.join(ROOT, "extension", "manifest.json")
m = json.load(open(mf, encoding="utf-8"))
m["name"] = "Claude in Safari"
m["icons"] = ext_icons
with open(mf, "w", encoding="utf-8") as f:
    json.dump(m, f, indent=2, ensure_ascii=False)
    f.write("\n")

# 2) Containing app: AppIcon.appiconset (macOS) + helper window icon
app = os.path.join(ROOT, "Claude for Safari", "Claude for Safari")
setdir = os.path.join(app, "Assets.xcassets", "AppIcon.appiconset")
images = []
for pt in (16, 32, 128, 256, 512):
    for scale in (1, 2):
        px = pt * scale
        name = f"icon_{pt}x{pt}{'@2x' if scale == 2 else ''}.png"
        save(master, px, os.path.join(setdir, name))
        images.append({"filename": name, "idiom": "mac", "scale": f"{scale}x", "size": f"{pt}x{pt}"})
with open(os.path.join(setdir, "Contents.json"), "w") as f:
    json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, f, indent=2)
save(master, 128, os.path.join(app, "Resources", "Icon.png"))
master.resize((512, 512), Image.LANCZOS).save("/tmp/claude_in_safari_icon_preview.png")
print("icons written")
