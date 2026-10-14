#!/usr/bin/env python3
"""Stage a clean white-background version of two real packshots.

Uses a segmentation *mask* only. Keeps RGB pixels of the photographed
bottle/label intact; never generates or paints over product packaging.
Do not ship without checking output against original images.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageFilter
from rembg import remove, new_session
import io
import json
import hashlib

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"docs"/"packshot-cleanup-preview"
OUT.mkdir(parents=True,exist_ok=True)
slugs=["amstel-malta-33cl","legend-60cl"]
session=new_session("u2netp")
report=[]
for slug in slugs:
    source=ROOT/"public"/"catalogue-photos"/f"{slug}.webp"
    item={"slug":slug,"original":str(source.relative_to(ROOT))}
    try:
        rgb=Image.open(source).convert("RGB")
        if rgb.size!=(640,800):
            raise ValueError("Expected existing 640x800 real photograph")
        raw=remove(rgb,session=session)
        rgba=raw.convert("RGBA")
        mask=rgba.getchannel("A")
        # A very narrow feather softens edges while preserving all original bottle RGB.
        mask=mask.filter(ImageFilter.GaussianBlur(0.5))
        bbox=mask.point(lambda v: 255 if v>145 else 0).getbbox()
        if not bbox:
            raise ValueError("No product found in segmentation mask")
        x0,y0,x1,y1=bbox
        if x1-x0 < 75 or y1-y0 < 315 or x1-x0 > 610 or y1-y0 > 790:
            raise ValueError("Mask shape is suspicious; preserving original")
        if not (x0<320<x1):
            raise ValueError("Product segmentation is not centered")
        dest=Image.new("RGB",rgb.size,"white")
        dest.paste(rgb,(0,0),mask)
        buff=io.BytesIO()
        dest.save(buff,"WEBP",quality=91,method=6)
        payload=buff.getvalue()
        if not (6500 <= len(payload) <= 1024*1024):
            raise ValueError("Output size unexpected")
        path=OUT/f"{slug}-clean.webp"
        path.write_bytes(payload)
        item.update(status="needs_visual_review",preview=str(path.relative_to(ROOT)),size_bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest(),mask_bbox=bbox)
        print(f"STAGED {slug} {len(payload)} bytes bbox={bbox}",flush=True)
    except Exception as exc:
        item.update(status="failed_do_not_publish",error=str(exc))
        print(f"FAILED {slug}: {exc}",flush=True)
    report.append(item)
(OUT/"results.json").write_text(json.dumps({"kind":"staging_only","rule":"No image may go live before original-vs-preview visual check","items":report},indent=2)+"\n")
