#!/usr/bin/env python3
"""Fetch actual product photos for only three precisely defined DepotFlow shop drinks.

Staging only. Output is not assigned to database until manual label/size review.
No AI generation, label editing, external hotlinks or EXIF retention.
"""
import hashlib
import html.parser
import io
import json
from pathlib import Path
import ssl
import time
import urllib.parse
import urllib.request
from PIL import Image, ImageOps, ImageChops

ROOT=Path(__file__).resolve().parents[1]
ITEMS=json.loads((ROOT/"docs/final-shop-photo-candidates.json").read_text())["candidates"]
OUT=ROOT/"public/catalogue-photos"
RESULTS=ROOT/"docs/final-shop-photo-fetch-results.json"
MAX_BYTES=7*1024*1024
Image.MAX_IMAGE_PIXELS=12_000_000

class MetaImages(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.links=[]
    def handle_starttag(self,tag,attrs):
        attributes=dict(attrs)
        if tag=="meta" and attributes.get("property") in ("og:image","og:image:secure_url"):
            self.links.append(attributes.get("content",""))
        elif tag=="meta" and attributes.get("name") in ("twitter:image","twitter:image:src"):
            self.links.append(attributes.get("content",""))
        elif tag=="img":
            if any(c in str(attributes.get("class","")).lower() for c in ("product","main-image")):
                self.links.append(attributes.get("data-src") or attributes.get("src") or "")

def request(url, accept="image/avif,image/webp,image/png,image/jpeg,*/*;q=0.8"):
    if urllib.parse.urlsplit(url).scheme!="https":
        raise ValueError("HTTPS source required")
    headers={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36","Accept":accept}
    req=urllib.request.Request(url,headers=headers)
    with urllib.request.urlopen(req,timeout=18,context=ssl.create_default_context()) as response:
        if urllib.parse.urlsplit(response.url).scheme!="https":
            raise ValueError("Redirected to non-HTTPS URL")
        raw=response.read(MAX_BYTES+1)
        if len(raw)>MAX_BYTES:
            raise ValueError("Image or page above 7MiB limit")
        return raw,response.url

def sources(candidate):
    for item in candidate["sources"]:
        yield item["url"],item.get("page",item["url"]),item["kind"]

def image_candidates(raw,source_url,kind):
    if kind=="image":
        return [source_url]
    if kind=="shopify":
        obj=json.loads(raw)
        urls=[]
        for im in obj.get("images",[])[:5]:
            url=im.get("src") if isinstance(im,dict) else im
            if url:
                urls.append(url)
        return urls
    p=MetaImages()
    p.feed(raw.decode("utf-8","replace"))
    return p.links[:10]

def optimize(data):
    img=Image.open(io.BytesIO(data))
    if img.format not in ("JPEG","PNG","WEBP"):
        raise ValueError("Not a valid photo format")
    if img.width<180 or img.height<180 or img.width*img.height>12_000_000:
        raise ValueError("Photo too small/large")
    if getattr(img,"n_frames",1)>1:
        raise ValueError("Animated/compound image")
    img=ImageOps.exif_transpose(img)
    if img.mode in ("RGBA","LA") or "transparency" in img.info:
        rgba=img.convert("RGBA")
        canvas=Image.new("RGBA",rgba.size,"white")
        canvas.alpha_composite(rgba)
        img=canvas.convert("RGB")
    else:
        img=img.convert("RGB")
    orig=img.size
    diff=ImageChops.difference(img,Image.new("RGB",img.size,"white")).convert("L")
    bbox=diff.point(lambda n:255 if n>20 else 0).getbbox()
    if bbox:
        x1,y1,x2,y2=bbox
        if x2-x1>=img.width*0.12 and y2-y1>=img.height*0.25:
            mx=max(6,int((x2-x1)*0.07));my=max(6,int((y2-y1)*0.07))
            img=img.crop((max(0,x1-mx),max(0,y1-my),min(img.width,x2+mx),min(img.height,y2+my)))
    img=ImageOps.contain(img,(600,752),Image.Resampling.LANCZOS)
    out=Image.new("RGB",(640,800),"white")
    out.paste(img,((640-img.width)//2,(800-img.height)//2))
    tmp=io.BytesIO()
    out.save(tmp,format="WEBP",quality=82,method=5)
    value=tmp.getvalue()
    if len(value)>1024*1024:
        raise ValueError("Optimised WebP over 1MiB")
    return value,orig

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    done=[]
    for item in ITEMS:
        slug=item["slug"]
        result={"slug":slug,"status":"failed","attempts":[]}
        for src,page,kind in sources(item):
            try:
                if kind=="image":
                    potential=[src]
                else:
                    data,_=request(src,"application/json" if kind=="shopify" else "text/html,application/xhtml+xml")
                    potential=image_candidates(data,src,kind)
                for u in potential:
                    u=urllib.parse.urljoin(src,u.replace("&amp;","&"))
                    if not u.startswith("https://"):
                        continue
                    if any(w in u.lower() for w in ("placeholder","noimage","no-image","logo.png","avatar")):
                        continue
                    try:
                        data,resolved=request(u)
                        output,original_size=optimize(data)
                        target=OUT/(slug+".webp")
                        target.write_bytes(output)
                        result.update(status="candidate_unreviewed",bytes=len(output),sha256=hashlib.sha256(output).hexdigest(),source_page=page,source_image=resolved,original_dimensions=original_size)
                        break
                    except Exception as ex:
                        result["attempts"].append({"source":u[:180],"error":str(ex)[:160]})
                if result["status"]=="candidate_unreviewed":
                    break
                result["attempts"].append({"source":src,"error":"No usable photo candidate"})
            except Exception as ex:
                result["attempts"].append({"source":src,"error":str(ex)[:160]})
            time.sleep(0.25)
        print(f'{slug}: {result["status"]}; {result.get("source_image","unavailable")}',flush=True)
        done.append(result)
    RESULTS.write_text(json.dumps({"status":"candidate_only_pending_manual_visual_review","items":done},indent=2)+"\n")
    print("SUCCESSFUL CANDIDATES:",sum(x["status"]=="candidate_unreviewed" for x in done),"/3",flush=True)

if __name__=="__main__":
    main()
