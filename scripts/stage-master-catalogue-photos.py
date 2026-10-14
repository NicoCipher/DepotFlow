#!/usr/bin/env python3
"""Stage exact-variant physical drink photographs from curated retailer pages.

Preview only; no output from this job is an approved or licensed photograph.
"""
import hashlib
import html.parser
import io
import json
from pathlib import Path
import urllib.parse
import urllib.request
import ssl
from PIL import Image, ImageOps, ImageChops

ROOT=Path(__file__).resolve().parents[1]
DATA=json.loads((ROOT/"docs/master-photo-candidates.json").read_text())["items"]
OUT=ROOT/"docs/master-photo-preview"
OUT.mkdir(parents=True,exist_ok=True)
Image.MAX_IMAGE_PIXELS=12000000

class Meta(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(); self.images=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=="meta" and (a.get("property") in ("og:image","og:image:secure_url") or a.get("name")=="twitter:image"):
            self.images.append(a.get("content",""))
        if tag=="script" and a.get("type")=="application/ld+json":
            pass

def fetch(url, accept):
    p=urllib.parse.urlsplit(url)
    if p.scheme!="https":raise ValueError("HTTPS only")
    req=urllib.request.Request(url,headers={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131 Safari/537.36","Accept":accept})
    with urllib.request.urlopen(req,timeout=19,context=ssl.create_default_context()) as resp:
        if urllib.parse.urlsplit(resp.url).scheme!="https":raise ValueError("Unsafe redirect")
        b=resp.read(7*1024*1024+1)
        if len(b)>7*1024*1024:raise ValueError("Download over limit")
        return b,resp.url

def process(raw):
    im=Image.open(io.BytesIO(raw))
    if im.format not in ("JPEG","PNG","WEBP"):raise ValueError("Not a known photo format")
    if im.width<170 or im.height<170 or im.width*im.height>12000000:raise ValueError("Image too small/large")
    if getattr(im,"n_frames",1)>1:raise ValueError("Not a single frame image")
    im=ImageOps.exif_transpose(im)
    if im.mode in ("RGBA","LA") or "transparency" in im.info:
        rgba=im.convert("RGBA")
        bg=Image.new("RGBA",rgba.size,"white")
        bg.alpha_composite(rgba);im=bg.convert("RGB")
    else:im=im.convert("RGB")
    bg=Image.new("RGB",im.size,"white")
    diff=ImageChops.difference(im,bg).convert("L")
    rect=diff.point(lambda x:255 if x>22 else 0).getbbox()
    if rect:
        x0,y0,x1,y1=rect
        if x1-x0>im.width*.15 and y1-y0>im.height*.28:
            px=max(6,int((x1-x0)*.07));py=max(6,int((y1-y0)*.07))
            im=im.crop((max(0,x0-px),max(0,y0-py),min(im.width,x1+px),min(im.height,y1+py)))
    im=ImageOps.contain(im,(600,752),Image.Resampling.LANCZOS)
    out=Image.new("RGB",(640,800),"white")
    out.paste(im,((640-im.width)//2,(800-im.height)//2))
    io_out=io.BytesIO()
    out.save(io_out,format="WEBP",quality=85,method=5)
    value=io_out.getvalue()
    if len(value)<4000 or len(value)>1024*1024:raise ValueError("Optimized file suspicious")
    return value

result=[]
for item in DATA:
    entry={"slug":item["slug"],"catalogue_name":item["catalogue_name"],"status":"failed","source_page":item["source_page"]}
    try:
        html,page=fetch(item["source_page"],"text/html,application/xhtml+xml")
        parser=Meta();parser.feed(html.decode("utf8","replace"))
        if not parser.images:raise ValueError("No product page image metadata")
        for candidate in parser.images[:4]:
            try:
                link=urllib.parse.urljoin(page,candidate.replace("&amp;","&"))
                if not link.startswith("https://"):continue
                image,final=fetch(link,"image/webp,image/jpeg,image/png,*/*")
                payload=process(image)
                path=OUT/(item["slug"]+".webp")
                path.write_bytes(payload)
                entry.update(status="staged_unreviewed",source_image=final,bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest())
                break
            except Exception as e:
                entry.setdefault("attempts",[]).append(str(e)[:120])
        if entry["status"]=="failed":entry["error"]="Image metadata found but no valid photo payload"
    except Exception as e:entry["error"]=str(e)[:200]
    result.append(entry)
    print(item["slug"],entry["status"],entry.get("source_image",entry.get("error","")),flush=True)
(OUT/"results.json").write_text(json.dumps({"status":"STAGED_FOR_MANUAL_REVIEW_NO_DB_WRITE","items":result},indent=2)+"\n")
