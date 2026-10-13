#!/usr/bin/env python3
"""Create a first-party 33 Export 60cl photo from an authentic product photo.

One-time acquisition script. No AI or packaging modifications. No credentials.
The full-size fetched original is not retained; strip embedded metadata on export.
"""
from io import BytesIO
from pathlib import Path

import requests
from PIL import Image, ImageChops, ImageFilter, ImageOps

SOURCE = "https://chomart.com/storage/images/33-export-premium-larger-beer-60-cl-pbxuu90298.webp"
DEST = Path("public/catalogue-photos/33-export-60cl.webp")
response = requests.get(SOURCE, timeout=24, headers={"User-Agent": "Mozilla/5.0"})
response.raise_for_status()
if len(response.content) > 6_000_000 or not response.headers.get("content-type","").startswith("image/"):
    raise RuntimeError("Not a small verified image response")

image = Image.open(BytesIO(response.content))
image.verify()
image = Image.open(BytesIO(response.content))
image.load()
if image.format not in ("WEBP", "JPEG", "PNG") or not 300 <= image.width <= 2000 or not 300 <= image.height <= 2000:
    raise RuntimeError(f"Unexpected image type or size {image.format} {image.size}")

# Adjust framing only; keep bottle geometry, brand, label and colors unchanged.
image = ImageOps.exif_transpose(image).convert("RGB")
white = Image.new("RGB", image.size, "white")
difference = ImageChops.difference(image, white).convert("L")
mask = difference.point(lambda value: 255 if value > 24 else 0)
bbox = mask.getbbox()
if bbox is None: raise RuntimeError("No foreground drink detected")
left,top,right,bottom = bbox
pad = round(max(right-left,bottom-top) * .035)
image = image.crop((max(0,left-pad),max(0,top-pad),min(image.width,right+pad),min(image.height,bottom+pad)))
canvas = Image.new("RGB",(480,640),"white")
image.thumbnail((430,580),Image.Resampling.LANCZOS)
image = image.filter(ImageFilter.UnsharpMask(radius=0.55,percent=35,threshold=3))
canvas.paste(image,((canvas.width-image.width)//2,(canvas.height-image.height)//2))
DEST.parent.mkdir(parents=True,exist_ok=True)
canvas.save(DEST,format="WEBP",quality=86,method=6)
if DEST.stat().st_size > 1024*1024: raise RuntimeError("Packshot exceeded 1MiB")
print(f"Prepared 33 Export 60cl, {image.width}x{image.height} on 480x640, bytes={DEST.stat().st_size}")
