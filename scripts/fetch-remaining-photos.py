#!/usr/bin/env python3
"""Acquire a strictly limited second pilot batch of REAL product photos.
Every result still needs manual product/label/variant visual validation before DB linking.
"""
import hashlib
import io
import json
import pathlib
import re
import ssl
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from PIL import Image, ImageOps, ImageChops

ROOT = pathlib.Path(__file__).resolve().parents[1]
ITEMS = json.loads((ROOT / "docs/remaining-shop-photo-candidates.json").read_text())["items"]
OUT = ROOT / "public/catalogue-photos"
REPORT = ROOT / "docs/remaining-shop-photo-fetch-results.json"
MAX_SOURCE = 7 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 12_000_000

class Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []
    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        fields = dict(attrs)
        key = fields.get("property") or fields.get("name") or ""
        if key.lower() in ("og:image:secure_url", "og:image", "twitter:image"):
            candidate = fields.get("content", "").strip()
            if candidate:
                self.urls.append(candidate)

def read(url,accept="image/webp,image/png,image/jpeg,*/*"):
    u = urllib.parse.urlsplit(url)
    if u.scheme != "https" or not u.hostname:
        raise ValueError("Only HTTPS approved sources")
    request = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36",
        "Accept": accept, "Accept-Language":"en-US,en;q=0.8"
    })
    with urllib.request.urlopen(request,timeout=23,context=ssl.create_default_context()) as response:
        if urllib.parse.urlsplit(response.url).scheme != "https":
            raise ValueError("Insecure final redirect")
        raw = response.read(MAX_SOURCE+1)
        if len(raw)>MAX_SOURCE:
            raise ValueError("Over 7MB image/HTML")
        return raw,response.url

def source(row):
    if row.get("source_image"):
        return row["source_image"]
    raw,url=read(row["source_page"], "text/html,application/xhtml+xml,*/*")
    parser=Tags()
    parser.feed(raw.decode("utf-8","replace"))
    if not parser.urls:
        raise ValueError("No og:image or twitter:image; no guessing from random page images")
    return urllib.parse.urljoin(url,parser.urls[0])

def optimize(data,slug):
    im=Image.open(io.BytesIO(data))
    if im.format not in ("JPEG","PNG","WEBP"):
        raise ValueError("Not a supported photo")
    if im.width<160 or im.height<160 or im.width*im.height>12_000_000 or getattr(im,"n_frames",1)>1:
        raise ValueError(f"Invalid image shape {im.size}")
    im=ImageOps.exif_transpose(im)
    if im.mode=="RGBA" or "transparency" in im.info:
        bg=Image.new("RGBA",im.size,"white")
        bg.alpha_composite(im.convert("RGBA"))
        im=bg.convert("RGB")
    else:
        im=im.convert("RGB")
    if slug=="tiger-45cl-closecrop":
        # Salvage authentic bottle, safely removing blank border without redrawing labels.
        # Only fairly dark pixels can anchor the segmentation bounding box.
        dark=im.convert("L").point(lambda n: 255 if n<185 else 0)
        bbox=dark.getbbox()
        if bbox is None:
            raise ValueError("Tiger image has no identifiable dark subject")
        x0,y0,x1,y1=bbox
        if (x1-x0)<im.width*0.08 or (y1-y0)<im.height*0.20:
            raise ValueError("Insufficient Tiger dark subject dimensions")
        padx=max(7,int((x1-x0)*0.09));pady=max(7,int((y1-y0)*0.09))
        im=im.crop((max(0,x0-padx),max(0,y0-pady),min(im.width,x1+padx),min(im.height,y1+pady)))
    else:
        diff=ImageChops.difference(im,Image.new("RGB",im.size,"white")).convert("L")
        bbox=diff.point(lambda n:255 if n>30 else 0).getbbox()
        if bbox:
            x0,y0,x1,y1=bbox
            if (x1-x0)>im.width*0.16 and (y1-y0)>im.height*0.3:
                pad=max(5,int((x1-x0)*0.06));pady=max(5,int((y1-y0)*0.06))
                im=im.crop((max(0,x0-pad),max(0,y0-pady),min(im.width,x1+pad),min(im.height,y1+pady)))
    resized=ImageOps.contain(im,(600,752),method=Image.Resampling.LANCZOS)
    canvas=Image.new("RGB",(640,800),"white")
    canvas.paste(resized,((640-resized.width)//2,(800-resized.height)//2))
    dst=io.BytesIO()
    canvas.save(dst,format="WEBP",quality=82,method=5)
    output=dst.getvalue()
    if len(output)>1024*1024:raise ValueError("WebP over 1MiB")
    return output,im.size

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    results=[]
    for row in ITEMS:
        slug=row["slug"]
        try:
            target=OUT/(slug+".webp")
            if target.exists(): raise ValueError("Refusing to overwrite an existing first-party photo")
            url=source(row)
            payload,final=read(url)
            blob,shape=optimize(payload,slug)
            if len(blob)<6000:raise ValueError("Suspiciously small icon/placeholder, reject before visual review")
            target.write_bytes(blob)
            results.append({"slug":slug,"result":"downloaded_needs_visual_review","source_image":url,"actual_url":final,"bytes":len(blob),"source_crop":shape,"sha256":hashlib.sha256(blob).hexdigest()})
            print("DOWNLOADED",slug,len(blob))
        except Exception as exc:
            results.append({"slug":slug,"result":"failed","error":str(exc)[:220]})
            print("FAILED",slug,str(exc))
    REPORT.write_text(json.dumps({"items":results,"warning":"Download is not variant validation or permission."},indent=2)+"\n")
    print("SUMMARY",sum(x["result"]=="downloaded_needs_visual_review" for x in results),"/",len(results))
if __name__=="__main__":main()
