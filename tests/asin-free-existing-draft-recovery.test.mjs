import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../direct-ebay-bridge.js", import.meta.url), "utf8");
const injection = "  sellerLifecycleAction = directSellerLifecycleAction;\n})();";
assert.ok(source.includes(injection), "recovery source injection anchor changed");
const instrumented = source.replace(injection, [
  "  sellerLifecycleAction = directSellerLifecycleAction;",
  "  globalThis.__draftRecoveryTest = { syncExistingSellerHubDraft };",
  "})();",
].join("\n"));

function createHarness(candidates, { product = null, asin = "" } = {}) {
  const actions = [];
  const statuses = [];
  const cache = new Map();
  const elements = {
    asin: { value: asin },
    syncSellerHubDraft: { insertAdjacentElement(where, el) {
      assert.equal(where, "afterend");
      elements[el.id] = el;
      if (el.children[0]) elements[el.children[0].id] = el.children[0];
    } },
  };
  const doc = {
    readyState: "loading",
    addEventListener() {},
    getElementById(id) { return elements[id] || null; },
    createElement(tag) {
      return {
        tag, id: "", children: [], value: "", style: {},
        appendChild(child) { this.children.push(child); },
        replaceChildren() { this.children = []; },
      };
    },
  };
  const ctx = {
    document: doc,
    URL,
    state: { product },
    localStorage: {
      getItem: key => cache.get(key) ?? null,
      setItem: (key, val) => cache.set(key, val),
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
      throw new Error("unexpected side-effect action " + body.action);
    },
  };
  vm.runInNewContext(instrumented, ctx);
  return { ctx, actions, statuses, elements, cache };
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
  assert.ok(h.elements.elyonRecoveryDraftChoice);
  assert.equal(h.elements.elyonRecoveryDraftChoice.children.length, 3);
  h.elements.elyonRecoveryDraftChoice.value = "1";
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  assert.deepEqual(h.actions.map(x => x.action), [
    "list-draft-recovery-candidates", "recover-draft",
  ]);
  assert.equal(h.actions[1].payload.sku, "AMZ-B0D63HF7Z4");
  assert.equal(h.actions[1].payload.taskId, "draft-task-2");
});

test("contradicting loaded Amazon ASINs block discovery without changing eBay", async () => {
  const h = createHarness(one, { product: { asin: "B0BWND9WBR" }, asin: "B0D63HF7Z4" });
  await h.ctx.__draftRecoveryTest.syncExistingSellerHubDraft(click);
  assert.equal(h.actions.length, 0);
  assert.match(h.statuses.at(-1).message, /widersprüchlich/);
});
