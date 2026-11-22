import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../direct-ebay-bridge.js", import.meta.url), "utf8");
const injection = "  sellerLifecycleAction = directSellerLifecycleAction;\n})();";
assert.ok(source.includes(injection), "recovery source injection anchor changed");
const instrumented = source.replace(injection, [
  "  sellerLifecycleAction = directSellerLifecycleAction;",
  "  globalThis.__draftRecoveryTest = { syncExistingSellerHubDraft, restoreRecoveryChoices, initSellerHubDraftFlow, markSelectedFeedManuallyDeleted };",
  "})();",
].join("\n"));

function createHarness(candidates, { product = null, asin = "", previousCache = null,
  cleanupConfirmed = true, cleanupPreviewError = false, cleanupTaskId = "registered-elyon-task", cleanupTitle = "Moxled Lichterkette" } = {}) {
  const actions = [];
  const statuses = [];
  const cache = previousCache || new Map();
  const events = {};
  const panelClasses = new Set(['hidden']);
  const elements = {
    asin: { value: asin },
    prepareDraftEbay: {
      dataset: {},
      addEventListener() {},
      closest() { return null; },
    },
    syncSellerHubDraft: { dataset: {}, addEventListener() {} },
    elyonRecoveryDraftPanel: {
      classList: {
        add(name) { panelClasses.add(name); },
        remove(name) { panelClasses.delete(name); },
        contains(name) { return panelClasses.has(name); },
      },
      scrollIntoView() { events.scrolledToPanel = true; },
    },
    elyonRecoveryDraftChoice: {
      value: '',
      children: [],
      listeners: {},
      replaceChildren() { this.children = []; this.value = ''; },
      appendChild(child) { this.children.push(child); },
      addEventListener(name, callback) { this.listeners[name] = callback; },
    },
    elyonRecoveryDraftConfirm: {
      disabled: true,
      listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
    },
    elyonRecoveryDraftDeleteInElyon: {
      disabled: true,
      listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
    },
  };
  const doc = {
    readyState: "loading",
    addEventListener() {},
    getElementById(id) { return elements[id] || null; },
    createElement(tag) {
      return { tag, id: "", value: "", textContent: "", style: {} };
    },
  };
  const ctx = {
    document: doc,
    URL,
    window: {
      confirm(message) { events.confirmMessage = message; return cleanupConfirmed; }
    },
    state: { product },
    localStorage: {
      getItem: key => cache.get(key) ?? null,
      setItem: (key, val) => cache.set(key, val),
      removeItem: key => cache.delete(key),
    },
    chrome: { cookies: { get: async () => ({ value: "test-session" }) } },
    setStatus: (message, cls) => statuses.push({ message, cls }),
    safeDraftPayload: () => ({
      data: { title: "Amazon Testartikel", sku: "", sourceProductId: "" },
      error: "",
    }),
    sellerLifecycleAction: async () => null,
    fetch: async (url, init) => {
      const body = JSON.parse(init.body);
      actions.push(body);
      if (body.action === "list-draft-recovery-candidates") {
        return { ok: true, status: 200, json: async () => ({
          ok: true, candidates,
        }) };
      }
      if (body.action === "recover-draft") {
        return { ok: true, status: 200, json: async () => ({
          ok: true, feedConfirmed: true, taskId: body.payload.taskId,
          sku: body.payload.sku,
          registration: { persisted: true },
          sellerHubVisibility: "not_verified",
        }) };
      }
      if (body.action === "preview-deleted-feed") {
        return { ok: !cleanupPreviewError, status: cleanupPreviewError ? 409 : 200, json: async () => (
          cleanupPreviewError ? { ok: false, message: "Mehrere aktive ELYON-Einträge" } : {
            ok: true, record: {
              sku: body.payload.sku,
              externalTaskId: cleanupTaskId,
              title: cleanupTitle,
              state: "draft",
            },
          }
        ) };
      }
      if (body.action === "mark-deleted-feed") {
        return { ok: true, status: 200, json: async () => ({
          ok: true, state: "removed",
          sku: body.payload.sku,
          externalTaskId: body.payload.externalTaskId,
          ebayChanged: false, productDeleted: false,
        }) };
      }

      throw new Error("unexpected side-effect action " + body.action);
    },
  };
  vm.runInNewContext(instrumented, ctx);
  return { ctx, actions, statuses, elements, cache, events, panelClasses };
}
const one = [{ sku: "AMZ-B0BWND9WBR", taskId: "draft-task-1", title: "Ein vorhandener eBay-Entwurf" }];
const click = { preventDefault() {}, stopImmediatePropagation() {} };

test("lost Amazon page context recovers the one eBay Draft without creating another", async () => {
  const h = createHarness(one);
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  assert.deepEqual(h.actions.map(x => x.action), [
    "list-draft-recovery-candidates", "recover-draft",
  ]);
  assert.equal(h.actions[1].payload.taskId, "draft-task-1");
  assert.equal(h.actions[1].payload.sku, "AMZ-B0BWND9WBR");
  assert.equal(h.actions[1].payload.sourceProductId, "amazon:B0BWND9WBR");
  assert.equal(h.actions[1].payload.amazonReferencePrice, null);
  assert.ok(h.statuses.some(s => /ELYON Seller Tool als Feed-Entwurf registriert/.test(s.message)));
  assert.ok(h.cache.size >= 1);
});

test("multiple candidates require explicit choice, not automatic first-task selection", async () => {
  const h = createHarness([
    ...one, { sku: "AMZ-B0D63HF7Z4", taskId: "draft-task-2", title: "Zweiter Entwurf" },
  ]);
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  assert.deepEqual(h.actions.map(x => x.action), ["list-draft-recovery-candidates"]);
  assert.equal(h.elements.elyonRecoveryDraftPanel.classList.contains('hidden'), false, "picker must be visible");
  assert.equal(h.events.scrolledToPanel, true, "picker is brought into view");
  assert.equal(h.elements.elyonRecoveryDraftChoice.children.length, 3);
  assert.equal(h.elements.elyonRecoveryDraftConfirm.disabled, true, "no default SKU chosen");
  h.ctx.__draftRecoveryTest.initSellerHubDraftFlow();
  h.elements.elyonRecoveryDraftChoice.value = "1";
  h.elements.elyonRecoveryDraftChoice.listeners.change();
  assert.equal(h.elements.elyonRecoveryDraftConfirm.disabled, false);
  await h.elements.elyonRecoveryDraftConfirm.listeners.click(click);
  assert.deepEqual(h.actions.map(x => x.action), [
    "list-draft-recovery-candidates", "recover-draft",
  ]);
  assert.equal(h.actions[1].payload.sku, "AMZ-B0D63HF7Z4");
  assert.equal(h.actions[1].payload.taskId, "draft-task-2");
});


test("candidate selection remains visible after Chrome popup is closed and reopened", async () => {
  const found = [
    ...one, { sku: "AMZ-B0D63HF7Z4", taskId: "draft-task-2", title: "Zweiter Entwurf" },
  ];
  const before = createHarness(found);
  await before.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  const key = 'elyon_amazon_importer_recovery_choices_v1';
  assert.ok(before.cache.has(key), "candidate list must survive popup destruction");
  const reopened = createHarness(found, { previousCache: before.cache });
  reopened.ctx.__draftRecoveryTest.initSellerHubDraftFlow();
  assert.equal(reopened.elements.elyonRecoveryDraftPanel.classList.contains('hidden'), false);
  assert.equal(reopened.elements.elyonRecoveryDraftChoice.children.length, 3);
  reopened.elements.elyonRecoveryDraftChoice.value = "1";
  reopened.elements.elyonRecoveryDraftChoice.listeners.change();
  await reopened.elements.elyonRecoveryDraftConfirm.listeners.click(click);
  assert.deepEqual(reopened.actions.map(a => a.action), ['recover-draft']);
  assert.equal(reopened.actions[0].payload.taskId, 'draft-task-2');
  assert.equal(reopened.cache.has(key), false, "clear restored choices once registration is confirmed");
});

test("recovery panel is in static popup markup near the status, outside the two-column eBay action row", async () => {
  const html = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  const statusAt = html.indexOf('id="status"');
  const panelAt = html.indexOf('id="elyonRecoveryDraftPanel"');
  const ebayAt = html.indexOf('id="prepareDraftEbay"');
  assert.ok(statusAt >= 0 && panelAt > statusAt && ebayAt > panelAt);
  assert.match(html, /id="elyonRecoveryDraftConfirm"/);
  assert.match(html, /id="elyonRecoveryDraftChoice"/);
});


test("user-confirmed deleted Moxled Feed is marked removed only in ELYON, by registry task, not selected history task", async () => {
  const choices = [
    ...one, { sku: "AMZ-B0D63HF7Z4", taskId: "old-ebay-feed-task", title: "Moxled Lichterkette" },
  ];
  const h = createHarness(choices);
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  h.ctx.__draftRecoveryTest.initSellerHubDraftFlow();
  h.elements.elyonRecoveryDraftChoice.value = "1";
  h.elements.elyonRecoveryDraftChoice.listeners.change();
  assert.equal(h.elements.elyonRecoveryDraftDeleteInElyon.disabled, false);
  await h.elements.elyonRecoveryDraftDeleteInElyon.listeners.click(click);
  assert.deepEqual(h.actions.map(x => x.action), [
    "list-draft-recovery-candidates", "preview-deleted-feed", "mark-deleted-feed",
  ]);
  assert.equal(h.actions[2].payload.externalTaskId, "registered-elyon-task");
  assert.equal(h.actions[2].payload.sku, "AMZ-B0D63HF7Z4");
  assert.equal(h.actions[2].payload.confirmation, "EBAY_DRAFT_ALREADY_DELETED");
  assert.match(h.events.confirmMessage, /Moxled/);
  assert.match(h.events.confirmMessage, /ausgewählte eBay-Task weicht/i);
  assert.match(h.statuses.at(-1).message, /ELYON bereinigt/);
  assert.equal(h.elements.elyonRecoveryDraftPanel.classList.contains("hidden"), true);
  const suppressKey = "elyon_amazon_importer_manually_deleted_feed_tasks_v1";
  assert.ok(h.cache.has(suppressKey));
  const removed = JSON.parse(h.cache.get(suppressKey));
  assert.equal(removed.length, 2);
  assert.ok(!h.actions.some(x => ["create-draft", "publish", "withdraw"].includes(x.action)));
});

test("deletion prompt cancellation does not touch the ELYON registry", async () => {
  const h = createHarness([...one, { sku: "AMZ-B0D63HF7Z4", taskId: "old-ebay-feed-task", title: "Moxled" }],
    { cleanupConfirmed: false });
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  h.ctx.__draftRecoveryTest.initSellerHubDraftFlow();
  h.elements.elyonRecoveryDraftChoice.value = "1";
  h.elements.elyonRecoveryDraftChoice.listeners.change();
  await h.elements.elyonRecoveryDraftDeleteInElyon.listeners.click(click);
  assert.deepEqual(h.actions.map(x => x.action), ["list-draft-recovery-candidates", "preview-deleted-feed"]);
  assert.match(h.statuses.at(-1).message, /abgebrochen/);
});

test("ambiguous registry preview blocks deletion and keeps user's existing selection", async () => {
  const h = createHarness([...one, { sku: "AMZ-B0D63HF7Z4", taskId: "old-ebay-feed-task", title: "Moxled" }],
    { cleanupPreviewError: true });
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  h.ctx.__draftRecoveryTest.initSellerHubDraftFlow();
  h.elements.elyonRecoveryDraftChoice.value = "1";
  h.elements.elyonRecoveryDraftChoice.listeners.change();
  await h.elements.elyonRecoveryDraftDeleteInElyon.listeners.click(click);
  assert.deepEqual(h.actions.map(x => x.action), ["list-draft-recovery-candidates", "preview-deleted-feed"]);
  assert.equal(h.elements.elyonRecoveryDraftPanel.classList.contains("hidden"), false);
});

test("contradicting loaded Amazon ASINs block discovery without changing eBay", async () => {
  const h = createHarness(one, { product: { asin: "B0BWND9WBR" }, asin: "B0D63HF7Z4" });
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  assert.equal(h.actions.length, 0);
  assert.match(h.statuses.at(-1).message, /widersprüchlich/);
});
