#!/usr/bin/env python3
"""Draws docs/social-preview.png (1280x640, GitHub social preview) from docs/icon.png."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H = 1280, 640
FONT = "/System/Library/Fonts/Avenir Next.ttc"


def font(size, bold=False):
    return ImageFont.truetype(FONT, size, index=1 if bold else 0)  # 0 = Regular, 1 = Bold (Avenir Next.ttc order)


img = Image.new("RGB", (W, H), "#101418")
d = ImageDraw.Draw(img)
for y in range(H):  # soft vertical gradient
    t = y / H
    d.line([(0, y), (W, y)], fill=(int(16 + 14 * t), int(20 + 12 * t), int(24 + 22 * t)))
d.rectangle([0, 0, 10, H], fill="#FF9F0A")

icon = Image.open(os.path.join(ROOT, "docs", "icon.png")).convert("RGBA").resize((300, 300), Image.LANCZOS)
img.paste(icon, (90, 170), icon)

x = 450
d.text((x, 150), "Claude in Safari", font=font(84, True), fill="#FFFFFF")
d.text((x, 262), "Let Claude drive your real Safari", font=font(40), fill="#FFB84D")
d.text((x, 330), "Safari Web Extension + local MCP server", font=font(32), fill="#C9D1D9")
d.text((x, 378), "33 tools · native Swift server · no Node.js", font=font(32), fill="#C9D1D9")

chips = ["tabs", "clicks", "screenshots", "cookies", "PDF", "upload"]
cx = x
for c in chips:
    f = font(26)
    w = int(d.textlength(c, font=f)) + 36
    d.rounded_rectangle([cx, 462, cx + w, 510], radius=24, outline="#FF9F0A", width=2)
    d.text((cx + 18, 470), c, font=f, fill="#FF9F0A")
    cx += w + 14

d.text((x, 560), "github.com/KLon777/claude-in-safari  ·  unofficial", font=font(26), fill="#8B949E")
out = os.path.join(ROOT, "docs", "social-preview.png")
img.save(out, optimize=True)
print(out, img.size, os.path.getsize(out))
