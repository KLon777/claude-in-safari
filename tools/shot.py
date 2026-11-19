#!/usr/bin/env python3
"""Screenshot helper for the install manual.
usage: tools/shot.py NAME X Y W H [redact X Y W H ...]
Coordinates are in a 1500px-wide view of the screen. Redacted boxes are filled solid before saving to docs/install/NAME.png.
Use "erase X Y W H" instead of "redact" to fill a box with the background colour sampled 8px below it (hides things without leaving a visible patch)."""
import os, subprocess, sys, tempfile
from PIL import Image, ImageDraw
name, *a = sys.argv[1:]
kinds = [v for v in a if v in ("redact", "erase")]
nums = [int(v) for v in a if v not in ("redact", "erase")]
crop, reds = nums[:4], [nums[i:i + 4] for i in range(4, len(nums), 4)]
tmp = tempfile.mktemp(suffix=".png")
subprocess.run(["screencapture", "-x", tmp], check=True)
im = Image.open(tmp).convert("RGB"); k = im.width / 1500
d = ImageDraw.Draw(im)
for (x, y, w, h), kind in zip(reds, kinds):
    fill = (70, 70, 74) if kind == "redact" else im.getpixel((int((x + w / 2) * k), int((y + h + 8) * k)))
    d.rounded_rectangle([x * k, y * k, (x + w) * k, (y + h) * k], radius=6 * k, fill=fill)
x, y, w, h = crop
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "docs", "install", name + ".png")
im.crop((int(x * k), int(y * k), int((x + w) * k), int((y + h) * k))).save(out)
os.remove(tmp); print(out)
