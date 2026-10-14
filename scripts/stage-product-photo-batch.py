#!/usr/bin/env python3
"""Stage genuine real-world Nigerian drink packshots. NEVER update live DB from here.

Every staged photo requires independent label/size/background visual review.
HTTPS-only, limited downloads, source audit, metadata stripped, no AI invention.
"""
from __future__ import annotations
import hashlib, io, json, os, pathlib, re, ssl, time, urllib.parse, urllib.request
from html.parser import HTMLParser
from PIL import Image, ImageOps, ImageChops

ROOT=pathlib.Path(__file__).resolve().parents[1]
MANIFEST=json.loads((ROOT/"docs/next-shop-photo-candidates-20261014.json").read_text())
OUT=ROOT/"docs"/"photo-review-20261014"
OUT.mkdir(exist_ok=True,parents=True)
MAX=7*1024*1024
Image.MAX_IMAGE_PIXELS=12_000_000
SSL=ssl.create_default_context()

class PageImages(HTMLParser):
    def __init__(self):
        super().__init__();self.primary=[];self.other=[];self.ld=False;self.script=[]
    def handle_starttag(self,tag,attrs):
        a=dict(attrs)
        if tag=="meta":
            kind=a.get("property",a.get("name","")).lower()
            if kind in ("og:image","og:image:secure_url","twitter:image","twitter:image:src"):
                self.primary.append(a.get("content",""))
        if tag=="img":
            cl=" ".join([str(a.get("class","")),str(a.get("id","")),str(a.get("alt",""))]).lower()
            src=a.get("data-zoom-image") or a.get("data-large_image") or a.get("data-src") or a.get("src")
            if not src: return
            if any(k in cl for k in ("product","zoom","gallery","main","primary")):
                self.primary.append(src)
            else:
                self.other.append(src)

def fetch(url, accept):
    parsed=urllib.parse.urlsplit(url)
    if parsed.scheme!="https":raise ValueError("Source URL must use HTTPS")
    req=urllib.request.Request(url,headers={
        "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept":accept,
        "Accept-Language":"en-US,en;q=0.8",
    })
    with urllib.request.urlopen(req,timeout=16,context=SSL) as response:
        if urllib.parse.urlsplit(response.url).scheme!="https":raise ValueError("Non-HTTPS redirect")
        payload=response.read(MAX+1)
        if len(payload)>MAX:raise ValueError("Response too large")
        return payload,response.url

def extract(html,base):
    parser=PageImages()
    parser.feed(html.decode("utf8","replace"))
    # JSON-LD and app state sometimes contain exact product image URLs not in OG.
    htmlstr=html.decode("utf8","replace")
    extra=[]
    for pattern in (r'"image"\s*:\s*"((?:https?:)?\\?/\\?/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"',
                    r'"src"\s*:\s*"(https:\\?/\\?/[^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"'):
        for match in re.findall(pattern,htmlstr,flags=re.I)[:8]:
            extra.append(match.replace("\\/","/"))
    raw=parser.primary+extra+parser.other[:8]
    distinct=[];seen=set()
    for url in raw:
        if not url:continue
        url=url.replace("&amp;","&").replace("\\/","/")
        url=urllib.parse.urljoin(base,url)
        if not url.startswith("https://") or url in seen:continue
        seen.add(url)
        if any(w in url.lower() for w in ("placeholder","no-image","noimage","default.png","favicon","logo.svg","banner","payment","secure","icon")):continue
        distinct.append(url)
    return distinct[:14]

def packshot(data):
    original=Image.open(io.BytesIO(data))
    if original.format not in ("JPEG","PNG","WEBP"): raise ValueError("not JPG PNG or WebP")
    if original.width<160 or original.height<160 or original.width*original.height>12_000_000:
        raise ValueError("invalid photo dimensions")
    if getattr(original,"n_frames",1)>1:raise ValueError("not a single-frame product photo")
    original=ImageOps.exif_transpose(original)
    if original.mode in ("RGBA","LA") or "transparency" in original.info:
        rgba=original.convert("RGBA")
        bg=Image.new("RGBA",rgba.size,"white");bg.alpha_composite(rgba)
        im=bg.convert("RGB")
    else:im=original.convert("RGB")
    before=im.size
    diff=ImageChops.difference(im,Image.new("RGB",im.size,"white")).convert("L")
    b=diff.point(lambda x:255 if x>22 else 0).getbbox()
    if b and b[2]-b[0]>im.width*.20 and b[3]-b[1]>im.height*.32:
        x0,y0,x1,y1=b
        mx=max(7,int((x1-x0)*.06));my=max(7,int((y1-y0)*.06))
        im=im.crop((max(0,x0-mx),max(0,y0-my),min(im.width,x1+mx),min(im.height,y1+my)))
    im=ImageOps.contain(im,(600,748),Image.Resampling.LANCZOS)
    result=Image.new("RGB",(640,800),"white")
    result.paste(im,((640-im.width)//2,(800-im.height)//2))
    b=io.BytesIO();result.save(b,"WEBP",quality=84,method=5)
    value=b.getvalue()
    if not (5500<len(value)<=1024*1024): raise ValueError("suspect WebP output size")
    return value,before

def main():
    rows=[]
    for item in MANIFEST["items"]:
        entry={k:item[k] for k in ("catalogue","slug","variant")}
        entry.update(status="failed",sources_tried=[])
        dest=OUT/(item["slug"]+".webp")
        if dest.exists():dest.unlink()
        for page in item["sources"]:
            try:
                if page.endswith(".js"):
                    payload,url=fetch(page,"application/json")
                    obj=json.loads(payload)
                    candidates=obj.get("images",[])
                    candidates=[x.get("src","") if isinstance(x,dict) else x for x in candidates]
                else:
                    payload,url=fetch(page,"text/html,application/xhtml+xml")
                    candidates=extract(payload,url)
                if not candidates:
                    entry["sources_tried"].append({"source":page,"error":"No product image candidates"});continue
                for imgurl in candidates:
                    try:
                        imgurl=urllib.parse.urljoin(url,imgurl)
                        if not imgurl.startswith("https://"):continue
                        raw,final=fetch(imgurl,"image/webp,image/jpeg,image/png,image/avif,*/*;q=.5")
                        wb,dims=packshot(raw)
                        dest.write_bytes(wb)
                        entry.update(status="staged_unverified",source_page=page,source_image=final,original_dimensions=dims,
                                     bytes=len(wb),sha256=hashlib.sha256(wb).hexdigest())
                        break
                    except Exception as ex:
                        entry["sources_tried"].append({"image":imgurl[:180],"error":str(ex)[:100]})
                if entry["status"]=="staged_unverified":break
            except Exception as ex:
                entry["sources_tried"].append({"source":page,"error":str(ex)[:110]})
            time.sleep(.2)
        print(f"{entry['slug']}: {entry['status']}",flush=True)
        rows.append(entry)
    (OUT/"results.json").write_text(json.dumps({"status":"STAGING_ONLY_NO_PUBLIC_ASSETS_OR_DATABASE_LINKS","items":rows},indent=2)+"\n")
    print("RESULT:",sum(r["status"]=="staged_unverified" for r in rows),"/",len(rows),flush=True)

if __name__=="__main__":main()
