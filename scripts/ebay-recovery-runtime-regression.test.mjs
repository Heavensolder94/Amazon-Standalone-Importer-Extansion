import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const bridge = await readFile(new URL("../direct-ebay-bridge.js", import.meta.url), "utf8");
const start = bridge.indexOf("  async function syncExistingSellerHubDraft(");
const end = bridge.indexOf("  function openSellerHubDrafts(", start);
assert.ok(start >= 0 && end > start, "Recovery handler must be available");
const handlerCode = bridge.slice(start, end);
const identityStart = bridge.indexOf("  function recoveryAsin(");
const identityEnd = bridge.indexOf("  function readDraftTasks(", identityStart);
assert.ok(identityStart >= 0 && identityEnd > identityStart, "Recovery SKU resolver must be available");
const identityCode = bridge.slice(identityStart, identityEnd);
const toneStart = bridge.indexOf("  function draftSyncTone(");
const toneEnd = bridge.indexOf("  function feedTaskLookup(", toneStart);
assert.ok(toneStart >= 0 && toneEnd > toneStart);
const toneCode = bridge.slice(toneStart, toneEnd);

function setup({ saved = null, result = null, payloadOverrides = {}, product = undefined, asinField = "" } = {}) {
  const payload = {
    sku: "AMZ-B0BWND9WBR",
    sourceProductId: "amazon:B0BWND9WBR",
    title: "Dreamzie Kissenbezug",
    price: 20.99,
    amazonReferencePrice: 12.91,
    amazonReferenceCapturedAt: "2026-11-17T15:00:00.000Z",
    ...payloadOverrides,
  };
  const loadedProduct = product === undefined
    ? { asin: "B0BWND9WBR", url: "https://www.amazon.de/dp/B0BWND9WBR" }
    : product;
  const statuses = [];
  const requests = [];
  const recorded = [];
  const ctx = {
    state: { product: loadedProduct },
    URL,
    document: { getElementById: (id) => id === "asin" ? { value: asinField } : null },
    safeDraftPayload: () => ({ data: payload, error: "" }),
    sourceKey: (item) => String(item?.sourceProductId || item?.sku || item?.title || "").trim(),
    readDraftTasks: () => saved ? { [payload.sourceProductId]: saved } : {},
    setStatus: (message, level) => statuses.push({ message, level }),
    readSellerSession: async () => "test-session",
    feedTaskLookup: (item, taskId, sku) => ({ taskId, sku, sourceProductId: item.sourceProductId,
      amazonReferencePrice: item.amazonReferencePrice, amazonReferenceCapturedAt: item.amazonReferenceCapturedAt }),
    requestSellerAction: async (_session, action, args) => {
      requests.push({ action, args });
      return result || { ok: true, body: {
        ok: true, taskId: "existing-task-dreamzie", sku: payload.sku,
        draftVisible: true, registration: { persisted: true },
        amazonReferenceSync: { state: "reference_recorded" }
      } };
    },
    rememberDraftTask: (item, body) => recorded.push({ item, body }),
    checkSavedTask: async () => ({ body: {
      draftVisible: true, registration: { persisted: true },
      amazonReferenceSync: { state: "reference_recorded" },
    } }),
    statusTextFromTask: (body) => body.amazonReferenceSync?.state === "reference_recorded"
      ? "eBay-Feed synchronisiert; Amazon-EK-Referenz übertragen"
      : "eBay-Feed synchronisiert",
  };
  vm.runInNewContext(identityCode + toneCode + handlerCode + "\nthis.runRecovery = syncExistingSellerHubDraft; this.resolveRecoverySku = resolveRecoverySku;", ctx);
  return { ctx, payload, statuses, requests, recorded };
}

test("missing local task ID: verified Feed recovery completes without a batch helper or duplicate eBay draft", async () => {
  const { ctx, payload, statuses, requests, recorded } = setup();
  await ctx.runRecovery({ preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "recover-draft");
  assert.equal(requests[0].args.sku, payload.sku);
  assert.equal(requests[0].args.amazonReferencePrice, 12.91);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].body.taskId, "existing-task-dreamzie");
  assert.equal(statuses.at(-1).level, "warn"); // Feed confirmation cannot establish Seller Hub visibility.
  assert.match(statuses.at(-1).message, /Amazon-EK-Referenz übertragen/);
  assert.ok(!statuses.some(({ message }) => /updateBatchDraft is not defined|Wiederherstellung fehlgeschlagen/.test(message)));
  assert.ok(!requests.some(({ action }) => action === "create-draft"));
});

test("already saved task ID uses status check, never recreates or searches the draft", async () => {
  const { ctx, statuses, requests, recorded } = setup({ saved: { taskId: "existing-task-dreamzie", sku: "AMZ-B0BWND9WBR" } });
  await ctx.runRecovery();
  assert.equal(requests.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(statuses.at(-1).level, "warn"); // Feed confirmation cannot establish Seller Hub visibility.
});

test("backend recovery failure stays a warning and never records a fictitious task", async () => {
  const { ctx, statuses, requests, recorded } = setup({ result: {
    ok: false, body: { ok: false, message: "Original Feed file is unavailable." },
  } });
  await ctx.runRecovery();
  assert.equal(requests.length, 1);
  assert.equal(recorded.length, 0);
  assert.equal(statuses.at(-1).level, "warn");
  assert.match(statuses.at(-1).message, /unavailable/);
});

test("no dependency on undefined optional batch-draft updater or task creation within recovery handler", () => {
  assert.doesNotMatch(handlerCode, /updateBatchDraft\s*\(/);
  assert.doesNotMatch(handlerCode, /'create-draft'/);
  assert.match(handlerCode, /rememberDraftTask\(recoveryPayload, response\.body\)/);
});


test("missing or invalid draft SKU recovers from original loaded Amazon product URL without creating a new eBay draft", async () => {
  const { ctx, requests, recorded, statuses } = setup({
    payloadOverrides: { sku: "ELY-000901", sourceProductId: "" },
    product: { asin: "", url: "https://www.amazon.de/gp/product/B0BWND9WBR?th=1" },
  });
  await ctx.runRecovery();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, "recover-draft");
  assert.equal(requests[0].args.sku, "AMZ-B0BWND9WBR");
  assert.equal(requests[0].args.sourceProductId, "amazon:B0BWND9WBR");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].item.sku, "AMZ-B0BWND9WBR");
  assert.equal(recorded[0].item.sourceProductId, "amazon:B0BWND9WBR");
  assert.equal(statuses.at(-1).level, "warn"); // Feed confirmation cannot establish Seller Hub visibility.
});

test("valid sourceProductId rescues an empty SKU even when product state is unavailable", async () => {
  const { ctx, requests, statuses } = setup({
    payloadOverrides: { sku: "", sourceProductId: "amazon:B0BWND9WBR" },
    product: null,
  });
  await ctx.runRecovery();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args.sku, "AMZ-B0BWND9WBR");
  assert.equal(statuses.at(-1).level, "warn"); // Feed confirmation cannot establish Seller Hub visibility.
});

test("ASIN from the popup field can recover an otherwise incomplete product record", async () => {
  const { ctx, requests } = setup({
    payloadOverrides: { sku: "", sourceProductId: "" },
    product: null,
    asinField: "b0bwnd9wbr",
  });
  await ctx.runRecovery();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].args.sku, "AMZ-B0BWND9WBR");
});

test("conflicting valid ASINs must fail closed and never match another Amazon product", async () => {
  const { ctx, requests, recorded, statuses } = setup({
    payloadOverrides: { sku: "AMZ-B0D63HF7Z4" },
    product: { asin: "B0BWND9WBR", url: "https://www.amazon.de/dp/B0BWND9WBR" },
  });
  await ctx.runRecovery();
  assert.equal(requests.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(statuses.at(-1).level, "warn");
  assert.match(statuses.at(-1).message, /widersprüchlich/);
});

test("no verifiable ASIN means no recovery API call and an actionable correction", async () => {
  const { ctx, requests, recorded, statuses } = setup({
    payloadOverrides: { sku: "", sourceProductId: "" },
    product: { asin: "", url: "https://example.net/not-an-amazon-product/B0BWND9WBR" },
  });
  await ctx.runRecovery();
  assert.equal(requests.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(statuses.at(-1).level, "warn");
  assert.match(statuses.at(-1).message, /ASIN-Feld/);
});

test("recovery URL parser accepts dp, gp/product, gp/aw/d and rejects non-Amazon hosts", () => {
  const { ctx } = setup();
  for (const url of [
    "https://www.amazon.de/dp/B0BWND9WBR",
    "https://www.amazon.de/gp/product/B0BWND9WBR/ref=abc",
    "https://www.amazon.de/gp/aw/d/B0BWND9WBR?psc=1",
    "https://amazon.de/?asin=B0BWND9WBR",
  ]) {
    ctx.state.product = { asin: "", url };
    assert.equal(ctx.resolveRecoverySku({ sku: "", sourceProductId: "" }).sku, "AMZ-B0BWND9WBR");
  }
  ctx.state.product = { asin: "", url: "https://not-amazon.example/dp/B0BWND9WBR" };
  const invalidUrl = ctx.resolveRecoverySku({ sku: "", sourceProductId: "" });
  assert.equal(invalidUrl.sku, "");
  assert.match(invalidUrl.error, /Keine gültige Amazon-ASIN/);
  assert.equal(ctx.resolveRecoverySku({ sku: "AMZ-B0BWND9WBR" }).sku, "AMZ-B0BWND9WBR");
});
