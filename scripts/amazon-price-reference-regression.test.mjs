import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vmModule from "node:vm";

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
  assert.match(manifest.version, /^1\\.2\\.\\d+$/);
  assert.ok(Number(manifest.version.split(".")[2]) >= 31, "ASIN-free recovery selector requires version 1.2.31 or newer");
  assert.doesNotMatch(bridge,/syncAmazonPriceReference\([^)]*\)\s*;\s*publish/);
});

test("Company OS settings report only API availability, not automatic import success",()=>{
  const settings=fs.readFileSync(new URL("../popup.html",import.meta.url),"utf8");
  assert.match(settings,/kontrolliert nur, ob die Company-OS-API erreichbar ist/);
  assert.match(settings,/„An Company OS“ überträgt den Artikel/);
  assert.match(popup,/Status: Company-OS-API erreichbar \(kein Import\)/);
  assert.match(popup,/Das bestätigt noch keinen Import/);
});

test("eBay draft success is never mislabeled as Amazon-EK reference success",()=>{
  const start=bridge.indexOf("  function statusTextFromTask(");
  const end=bridge.indexOf("  function feedTaskLookup(",start);
  assert.ok(start>=0&&end>start);
  const vm=requireVm();
  const ctx={sellerHubTaskErrorDetails:()=>""};
  vm.runInNewContext(bridge.slice(start,end)+"\nthis.format = statusTextFromTask; this.tone = draftSyncTone;",ctx);
  const draft={draftVisible:true,registration:{persisted:true}};
  for(const [state,expected] of [
    ["reference_recorded",/nachweislich in Company OS gespeichert/],
    ["review_not_found",/findet keinen eindeutigen bestehenden Produktprüfungsdatensatz/],
    ["reference_missing",/Amazon-Preisreferenz nicht übertragen/],
    ["confirmation_missing",/Amazon-Preisreferenz nicht bestätigt/],
  ]){
    const body={...draft,amazonReferenceSync:{state}};
    assert.match(ctx.format(body),expected);
    assert.equal(ctx.tone(body),"warn"); // Price-reference sync is not Seller Hub visibility evidence.
  }
  assert.match(ctx.format(draft),/kein Synchronisierungsstatus vorhanden/);
  assert.equal(ctx.tone(draft),"warn");
  assert.equal(ctx.tone({ ...draft, sellerHubVisibility: "verified" }), "ok");
  assert.equal(ctx.tone({ ...draft, sellerHubVisibility: "not_verified" }), "warn");
});

function requireVm(){ return vmModule; }
