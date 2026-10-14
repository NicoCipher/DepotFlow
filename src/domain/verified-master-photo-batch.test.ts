import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

const root = new URL("../../", import.meta.url);
const approved = [
  ["Turbo", "turbo-king-bottle-60cl", "f2ac41d7aefc49d81535d5f32e28e96e390a2603ccf3b3f379e0b6b119ea1c92"],
  ["Malta Can", "malta-guinness-can-original-33cl", "e72e4fa97773fa2d6f0871e4f1fa7b09ecd1d7a662fbbc06a3a24cb6a17f85fb"],
  ["Stout Can", "guinness-fes-can-33cl", "a54b96de54d463dbb67eabbe50d8399f29161dc3cf2e21f9256282a232ed600e"],
] as const;

test("three genuine visually reviewed exact drink photo WebPs are immutable", () => {
  for (const [name,slug,sha] of approved) {
    const b=readFileSync(new URL(`public/catalogue-photos/${slug}.webp`,root));
    assert.ok(b.length>9500 && b.length<=1024*1024,`Invalid packshot for ${name}`);
    assert.equal(b.toString("ascii",0,4),"RIFF");
    assert.equal(b.toString("ascii",8,12),"WEBP");
    assert.equal(createHash("sha256").update(b).digest("hex"),sha,`Reviewed packaging changed for ${name}`);
  }
});

test("only verified exact catalogue identities are linked; no unreviewed files published",()=>{
  const sql=readFileSync(new URL("supabase/migrations/20261014101000_three_verified_catalogue_packshots.sql",root),"utf8");
  for(const [name,slug] of approved){
    assert.ok(sql.includes(`'${name}'`),`Not linked ${name}`);
    assert.ok(sql.includes(`'${slug}'`),`Wrong slug ${name}`);
  }
  for(const slug of ["desperados-original-bottle-45cl","desperados-original-can-44cl","guinness-smooth-bottle-45cl","heineken-medium-bottle-45cl","heineken-lager-can-33cl"]){
    assert.ok(!existsSync(new URL(`public/catalogue-photos/${slug}.webp`,root)),`Unapproved photo made public: ${slug}`);
  }
  assert.ok(sql.includes("p.image_url is null"),"Preserve owner-selected shop photo");
  assert.ok(sql.includes("c.image_path is null"),"Preserve owner-selected master photo");
});

test("each approved photo has explicit first-party provenance and an unverified rights caveat",()=>{
  const data=JSON.parse(readFileSync(new URL("docs/next-shop-photo-candidates-20261014.json",root),"utf8"));
  for(const [name,slug] of approved){
    const item=data.items.find((r:{slug:string})=>r.slug===slug);
    assert.ok(item&&item.catalogue===name&&item.sources.length>0,`Missing source for ${name}`);
  }
  assert.match(data.photoRights,/unverified/i);
});
