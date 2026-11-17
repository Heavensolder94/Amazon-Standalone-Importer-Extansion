import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../popup.js",import.meta.url),"utf8");
const pStart=source.indexOf("function parsePrice(");
const pEnd=source.indexOf("function normalizedKey(",pStart);
assert.ok(pStart>=0&&pEnd>pStart,"Source price helpers are available");
const sandbox={clean:(s)=>String(s||"").replace(/\s+/g," ").trim(),URL,Number,Set};
vm.runInNewContext(source.slice(pStart,pEnd)+"\nthis.getReference=observedAmazonPurchaseReference;",sandbox);

test("Dreamzie Amazon VK is kept as EK reference even when the ASIN input is blank",()=>{
  const result=sandbox.getReference({
    asin:"B0BWND9WBR",url:"https://www.amazon.de/dp/B0BWND9WBR",price:"12,91 €",
  },"");
  assert.equal(result,12.91);
});

test("reference works with mixed-case ASIN input, verified Amazon URL and decimal price",()=>{
  const result=sandbox.getReference({
    asin:"",url:"https://www.amazon.de/gp/product/B0BWND9WBR?psc=1",price:"12,91 €",
  },"b0bwnd9wbr");
  assert.equal(result,12.91);
});

test("two conflicting valid ASINs cannot attach one product price to a different eBay draft",()=>{
  assert.equal(sandbox.getReference({
    asin:"B0BWND9WBR",url:"https://www.amazon.de/dp/B0BWND9WBR",price:"12,91 €",
  },"B0D63HF7Z4"),null);
});

test("an unrelated website cannot establish an Amazon price reference",()=>{
  assert.equal(sandbox.getReference({
    asin:"",url:"https://not-amazon.example/dp/B0BWND9WBR",price:"12,91 €",
  },"B0BWND9WBR"),null);
});

test("zero or missing Amazon price cannot produce artificial EK",()=>{
  const product={asin:"B0BWND9WBR",url:"https://www.amazon.de/dp/B0BWND9WBR",price:""};
  assert.equal(sandbox.getReference(product,"B0BWND9WBR"),null);
});
