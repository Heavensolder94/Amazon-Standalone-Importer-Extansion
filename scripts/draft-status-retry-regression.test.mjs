import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../direct-ebay-bridge.js", import.meta.url), "utf8");
const checkStart = source.indexOf("  async function checkSavedTask(");
const checkEnd = source.indexOf("  async function pollDraftTask(", checkStart);
const createStart = source.indexOf("  async function createSellerHubDraftFromButton(");
const createEnd = source.indexOf("  async function syncExistingSellerHubDraft(", createStart);
assert.ok(checkStart >= 0 && checkEnd > checkStart && createStart >= 0 && createEnd > createStart);
const handlers = source.slice(checkStart, checkEnd) + source.slice(createStart, createEnd);

function setup(statusResponse) {
  const actions = [];
  const statuses = [];
  let saved = { taskId: "task-existing", sku: "AMZ-B0BWND9WBR" };
  const context = {
    safeDraftPayload: () => ({ data: { sku: "AMZ-B0BWND9WBR", categoryId: "1234" } }),
    savedDraftTask: () => saved,
    forgetDraftTask: () => { saved = null; },
    readSellerSession: async () => "session",
    feedTaskLookup: (_p, taskId, sku) => ({ taskId, sku }),
    requestSellerAction: async (_s, action) => {
      actions.push(action);
      return action === "draft-status" ? statusResponse : { ok: true, body: { taskId: "new-task" } };
    },
    rememberDraftTask: () => {},
    pollDraftTask: async () => null,
    statusTextFromTask: () => "Status geprüft",
    setStatus: (message, level) => statuses.push({ message, level }),
  };
  vm.runInNewContext(handlers + "\nthis.run = createSellerHubDraftFromButton", context);
  return { context, actions, statuses, getSaved: () => saved };
}

for (const status of [404, 500]) {
  test(`HTTP ${status} beim Taskstatus bewahrt Task und erstellt keinen neuen Entwurf`, async () => {
    const { context, actions, statuses, getSaved } = setup({ ok: false, status, body: {} });
    await context.run();
    await context.run();
    assert.deepEqual(actions, ["draft-status", "draft-status"]);
    assert.equal(getSaved().taskId, "task-existing");
    assert.match(statuses.at(-1).message, /kein neuer Entwurf/);
  });
}

test("vorhandener oder noch laufender Task wird wiederverwendet", async () => {
  const { context, actions } = setup({ ok: true, body: { complete: false } });
  await context.run();
  assert.deepEqual(actions, ["draft-status"]);
});

test("nach eindeutig fehlgeschlagenem Task ist ein neuer Versuch möglich", async () => {
  const { context, actions } = setup({ ok: true, body: { complete: true, failureCount: 1, successCount: 0 } });
  await context.run();
  assert.deepEqual(actions, ["draft-status", "create-draft"]);
});
