#!/usr/bin/env python3
"""One-time build helper: preserve an authentic Goldberg bottle photograph.

Only framing, resizing, and WebP compression. Never redraw the label or bottle.
The image source is recorded in docs/catalogue-photo-sources.md.
"""
from io import BytesIO
from pathlib import Path
import requests
from PIL import Image, ImageChops, ImageFilter, ImageOps

SOURCE = "https://products.contact/170-large_default/goldberg-premium-lager-beer-bottle-60cl.jpg"
DEST = Path("public/catalogue-photos/goldberg-60cl.webp")

response = requests.get(SOURCE, headers={"User-Agent": "Mozilla/5.0 DepotFlowPhotoReference/1.0"}, timeout=25)
response.raise_for_status()
if len(response.content) > 7_000_000:
    raise RuntimeError("Source is unexpectedly large")
photo = Image.open(BytesIO(response.content))
photo.load()
if photo.format not in ("JPEG", "PNG", "WEBP") or min(photo.size) < 250:
    raise RuntimeError(f"Unexpected image format/dimensions: {photo.format} {photo.size}")

# Preserve the original packaging; modify ONLY framing and pixel-level quality.
photo = ImageOps.exif_transpose(photo).convert("RGB")
white = Image.new("RGB", photo.size, "#ffffff")
diff = ImageChops.difference(photo, white).convert("L")
mask = diff.point(lambda a: 255 if a > 20 else 0)
bounds = mask.getbbox()
if not bounds:
    raise RuntimeError("The downloaded photo does not contain a product")

left, top, right, bottom = bounds
pad = int(max(right-left, bottom-top) * 0.045)
photo = photo.crop((max(0,left-pad), max(0,top-pad), min(photo.width,right+pad), min(photo.height,bottom+pad)))

canvas = Image.new("RGB", (640, 800), "#ffffff")
photo.thumbnail((550, 720), Image.Resampling.LANCZOS)
photo = photo.filter(ImageFilter.UnsharpMask(radius=0.7, percent=65, threshold=3))
canvas.paste(photo, ((640-photo.width)//2, (800-photo.height)//2))
DEST.parent.mkdir(parents=True, exist_ok=True)
canvas.save(DEST, "WEBP", quality=87, method=6)
assert DEST.stat().st_size < 1024*1024
print(f"Prepared actual Goldberg bottle photo: {DEST}, {DEST.stat().st_size} bytes")
