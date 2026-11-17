import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const popup=fs.readFileSync(new URL("../popup.js",import.meta.url),"utf8");
const bridge=fs.readFileSync(new URL("../direct-ebay-bridge.js",import.meta.url),"utf8");
const manifest=JSON.parse(fs.readFileSync(new URL("../manifest.json",import.meta.url),"utf8"));

test("observed Amazon retail VK is separate from eBay price in draft payload",()=>{
  const start=popup.indexOf("function draftPayload()");
  const end=popup.indexOf("function companyOsPayload()",start);
  const segment=popup.slice(start,end);
  assert.match(segment,/observedAmazonPurchaseReference\(state\.product, asin\)/);
  assert.match(segment,/amazonReferencePrice,/);
  assert.match(segment,/amazonReferenceCapturedAt: amazonReferencePrice !== null/);
  assert.match(segment,/price: Number\(\$\('sellPrice'\)\.value\)/);
  assert.doesNotMatch(segment,/price: amazonReferencePrice/);
});

test("previous eBay Feed task status and history recovery resubmit only observational price metadata",()=>{
  assert.match(bridge,/amazonReferencePrice: Number\(payload\?\.amazonReferencePrice/);
  assert.match(bridge,/amazonReferenceCapturedAt: String\(payload\?\.amazonReferenceCapturedAt/);
  const start=bridge.indexOf("async function syncExistingSellerHubDraft(");
  const end=bridge.indexOf("function openSellerHubDrafts(",start);
  const recovery=bridge.slice(start,end);
  assert.match(recovery,/feedTaskLookup\(recoveryPayload, '', identity\.sku\)/);
  assert.match(recovery,/checkSavedTask\(session, recoveryPayload, saved\)/);
  assert.doesNotMatch(recovery,/'create-draft'/);
});

test("extension version is bumped without adding automatic publishing",()=>{
  assert.equal(manifest.version,"1.2.24");
  assert.doesNotMatch(bridge,/syncAmazonPriceReference\([^)]*\)\s*;\s*publish/);
});
