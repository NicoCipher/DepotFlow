import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, existsSync } from "node:fs";
const root=new URL("../../",import.meta.url);
const five=["heineken-big-60cl","castle-lite-60cl","flying-fish-45cl","trophy-stout-60cl","tiger-45cl-closecrop"];
test("second photo batch contains five genuine optimized WebP sources",()=>{
  for (const slug of five) {
    const file=new URL(`public/catalogue-photos/${slug}.webp`,root);
    assert.ok(existsSync(file),`Photo missing: ${slug}`);
    const data=readFileSync(file);
    assert.ok(data.length>7000&&data.length<1024*1024,`File suspicious: ${slug}`);
    assert.equal(data.toString("ascii",0,4),"RIFF");
    assert.equal(data.toString("ascii",8,12),"WEBP");
  }
});
test("second photo batch never publishes 3 failed product variants",()=>{
  for (const slug of ["desperados-original-45cl","turbo-king-big-60cl"])
    assert.ok(!existsSync(new URL(`public/catalogue-photos/${slug}.webp`,root)));
});

test("Big Smirnoff Ice 60cl genuine bottle packshot is available in a safe first-party WebP", () => {
  const filename=new URL("public/catalogue-photos/smirnoff-ice-big-60cl.webp",root);
  assert.ok(existsSync(filename));
  const content=readFileSync(filename);
  assert.ok(content.length>7000&&content.length<1024*1024);
  assert.equal(content.toString("ascii",0,4),"RIFF");
  assert.equal(content.toString("ascii",8,12),"WEBP");
});
