import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const bridge = await readFile(new URL("../direct-ebay-bridge.js", import.meta.url), "utf8");
const start = bridge.indexOf("  async function syncExistingSellerHubDraft(");
const end = bridge.indexOf("  function openSellerHubDrafts(", start);
assert.ok(start >= 0 && end > start, "Recovery handler must be available");
const handlerCode = bridge.slice(start, end);

function setup({ saved = null, result = null } = {}) {
  const payload = {
    sku: "AMZ-B0BWND9WBR",
    sourceProductId: "amazon:B0BWND9WBR",
    title: "Dreamzie Kissenbezug",
    price: 20.99,
    amazonReferencePrice: 12.91,
    amazonReferenceCapturedAt: "2026-11-17T15:00:00.000Z",
  };
  const statuses = [];
  const requests = [];
  const recorded = [];
  const ctx = {
    safeDraftPayload: () => ({ data: payload, error: "" }),
    sourceKey: () => payload.sourceProductId,
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
  vm.runInNewContext(handlerCode + "\nthis.runRecovery = syncExistingSellerHubDraft;", ctx);
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
  assert.equal(statuses.at(-1).level, "ok");
  assert.match(statuses.at(-1).message, /Amazon-EK-Referenz übertragen/);
  assert.ok(!statuses.some(({ message }) => /updateBatchDraft is not defined|Wiederherstellung fehlgeschlagen/.test(message)));
  assert.ok(!requests.some(({ action }) => action === "create-draft"));
});

test("already saved task ID uses status check, never recreates or searches the draft", async () => {
  const { ctx, statuses, requests, recorded } = setup({ saved: { taskId: "existing-task-dreamzie", sku: "AMZ-B0BWND9WBR" } });
  await ctx.runRecovery();
  assert.equal(requests.length, 0);
  assert.equal(recorded.length, 0);
  assert.equal(statuses.at(-1).level, "ok");
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
  assert.match(handlerCode, /rememberDraftTask\(payload, response\.body\)/);
});
