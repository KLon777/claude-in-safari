#!/usr/bin/env python3
"""Crop a dialog out of a full-screen capture (host), mask rounded corners so nothing behind shows.
usage: hshot.py SRC.png OUT.png X0 Y0 X1 Y1 [radius]   (box in a 1300px-wide view of the screen; blur boxes via env BLUR="x0,y0,x1,y1;...")"""
import sys, os
from PIL import Image, ImageDraw, ImageFilter
src, out, *b = sys.argv[1:]
x0, y0, x1, y1 = map(float, b[:4]); r = int(b[4]) if len(b) > 4 else 26
im = Image.open(src).convert("RGBA"); k = im.width / 1300
for box in filter(None, os.environ.get("BLUR", "").split(";")):
    bx = tuple(int(float(v) * k) for v in box.split(","))
    im.paste(im.crop(bx).filter(ImageFilter.GaussianBlur(14)), bx[:2])
im = im.crop((int(x0 * k), int(y0 * k), int(x1 * k), int(y1 * k)))
m = Image.new("L", im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], radius=r, fill=255)
im.putalpha(m); im.save(out, optimize=True); print(out, im.size)
