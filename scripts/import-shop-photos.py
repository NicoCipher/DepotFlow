#!/usr/bin/env python3
"""One-off genuine drink photo import. DO NOT fabricate/change any packaging."""
import hashlib
import io
import json
import pathlib
import ssl
import urllib.parse
import urllib.request
from PIL import Image, ImageOps, ImageChops, UnidentifiedImageError

ROOT = pathlib.Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs" / "shop-photo-source-manifest.json"
OUTPUT = ROOT / "public" / "catalogue-photos"
REPORT = ROOT / "docs" / "shop-photo-import-results.json"
MAX_DOWNLOAD = 7 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 12_000_000

def fetch(url):
    parsed = urllib.parse.urlsplit(url)
    # A retailer's public Shopify product JSON can provide its own exact-SKU
    # photo URL. Only use this for explicitly curated, variant-specific items.
    if parsed.path.endswith(".js"):
        if parsed.scheme != "https":
            raise ValueError("Only HTTPS Shopify product URLs allowed")
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=25, context=ssl.create_default_context()) as res:
            info = json.loads(res.read(400000))
        imgs = info.get("images", [])
        if not imgs:
            raise ValueError("Shopify product listing has no photograph")
        src = imgs[0].get("src") if isinstance(imgs[0], dict) else imgs[0]
        if not isinstance(src, str):
            raise ValueError("Unexpected Shopify photograph reference")
        src = "https:" + src if src.startswith("//") else src
        return fetch(src)
    if parsed.scheme != "https" or not parsed.hostname:
        raise ValueError("Only HTTPS source URLs are supported")
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; DepotFlow-PersonalPilot/1.0)",
        "Accept": "image/avif,image/webp,image/png,image/jpeg,*/*;q=0.7"
    })
    with urllib.request.urlopen(request, timeout=25, context=ssl.create_default_context()) as response:
        dest = urllib.parse.urlsplit(response.url)
        if dest.scheme != "https":
            raise ValueError("Redirected to an insecure URL")
        data = response.read(MAX_DOWNLOAD + 1)
        if len(data) > MAX_DOWNLOAD:
            raise ValueError("Source image over 7 MiB")
        if len(data) < 2500:
            raise ValueError("Source appears too small/invalid")
        return data, response.url

def prepare(data):
    im = Image.open(io.BytesIO(data))
    if im.format not in ("PNG", "JPEG", "WEBP"):
        raise ValueError(f"Not a PNG/JPEG/WebP image: {im.format}")
    if im.width < 180 or im.height < 180 or im.width * im.height > 12_000_000:
        raise ValueError(f"Image dimensions not suitable: {im.size}")
    if getattr(im, "n_frames", 1) > 1:
        raise ValueError("Animated or multi-frame image not supported")
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA") or "transparency" in im.info:
        rgba = im.convert("RGBA")
        backdrop = Image.new("RGBA", rgba.size, "white")
        backdrop.alpha_composite(rgba)
        im = backdrop.convert("RGB")
    else:
        im = im.convert("RGB")
    # Mechanical whitespace crop only: preserve all non-white label and bottle pixels.
    diff = ImageChops.difference(im, Image.new("RGB", im.size, "white")).convert("L")
    box = diff.point(lambda v: 255 if v > 20 else 0).getbbox()
    if box:
        x1,y1,x2,y2=box
        if (x2-x1) >= im.width * 0.17 and (y2-y1) >= im.height * 0.30:
            margin_x=max(6,int((x2-x1)*0.065))
            margin_y=max(6,int((y2-y1)*0.065))
            im=im.crop((max(0,x1-margin_x),max(0,y1-margin_y),min(im.width,x2+margin_x),min(im.height,y2+margin_y)))
    content=ImageOps.contain(im,(600,752),method=Image.Resampling.LANCZOS)
    dest=Image.new("RGB",(640,800),"white")
    dest.paste(content,((640-content.width)//2,(800-content.height)//2))
    for quality in (84,75,65):
        buf=io.BytesIO()
        dest.save(buf, format="WEBP", quality=quality, method=5)
        image=buf.getvalue()
        if len(image) <= 1024*1024:
            return image, list(im.size)
    raise ValueError("WebP cannot be brought below size limit")

def run():
    items=json.loads(MANIFEST.read_text())["items"]
    OUTPUT.mkdir(parents=True,exist_ok=True)
    done=[]
    for row in items:
        path=OUTPUT/(row["slug"]+".webp")
        if path.exists():
            done.append({"slug":row["slug"],"result":"already-present","bytes":path.stat().st_size})
            continue
        try:
            data,final_url=fetch(row["source_image"])
            payload,cropped=prepare(data)
            path.write_bytes(payload)
            done.append({"slug":row["slug"],"result":"ok","bytes":len(payload),"sha256":hashlib.sha256(payload).hexdigest(),"source_final_url":final_url,"cropped_source_dimensions":cropped})
            print(f"OK {row['slug']} {len(payload)} bytes")
        except Exception as error:
            done.append({"slug":row["slug"],"result":"failed","reason":str(error)[:230]})
            print(f"FAILED {row['slug']}: {error}")
    REPORT.write_text(json.dumps({"source_manifest":"docs/shop-photo-source-manifest.json","items":done},indent=2,ensure_ascii=False)+"\n")
    good=sum(x["result"] in ("ok","already-present") for x in done)
    print(f"SUMMARY {good}/{len(items)} successfully imported. No missing asset may receive a DB image reference.")
    if good == 0:
        raise SystemExit("No real product images could be downloaded; not making empty commit.")

if __name__=="__main__": run()
