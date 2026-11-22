import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../direct-ebay-bridge.js", import.meta.url), "utf8");
const start = source.indexOf("  function statusTextFromTask(");
const end = source.indexOf("  function feedTaskLookup(", start);
assert.ok(start >= 0 && end > start, "Draft status feedback functions must exist");

const context = {
  sellerHubTaskErrorDetails: () => "eBay reported an error",
};
vm.runInNewContext(
  source.slice(start, end) + "\nthis.statusTextFromTask = statusTextFromTask; this.draftSyncTone = draftSyncTone;",
  context,
);

test("successful FX_LISTING processing must not claim Seller Hub visibility", () => {
  const message = context.statusTextFromTask({
    status: "COMPLETED",
    feedConfirmed: true,
    draftVisible: true,
    complete: true,
    registration: { persisted: true },
    amazonReferenceSync: { state: "reference_recorded" },
  });
  assert.match(message, /Feed erfolgreich verarbeitet/);
  assert.match(message, /NICHT verifiziert/);
  assert.match(message, /Angebote → Entwürfe/);
  assert.equal(context.draftSyncTone({ registration: { persisted: true }, amazonReferenceSync: { state: "reference_recorded" } }), "warn");
});

test("legacy draftVisible flag still means feed confirmation only", () => {
  const message = context.statusTextFromTask({ status: "COMPLETED", draftVisible: true });
  assert.match(message, /NICHT verifiziert/);
});

test("feed confirmation explicitly false wins over legacy draftVisible", () => {
  const message = context.statusTextFromTask({
    status: "COMPLETED", feedConfirmed: false, draftVisible: true, complete: true, successCount: 0, failureCount: 0,
  });
  assert.match(message, /ein erfolgreicher Eintrag ist nicht bestätigt/);
  assert.doesNotMatch(message, /Feed erfolgreich verarbeitet/);
});

test("incomplete or failed eBay task is not shown as successful", () => {
  const processing = context.statusTextFromTask({ status: "IN_PROCESS", complete: false });
  assert.match(processing, /wird verarbeitet/);
  const failure = context.statusTextFromTask({
    status: "COMPLETED_WITH_ERROR", complete: true, failureCount: 1, successCount: 0, feedConfirmed: false,
  });
  assert.match(failure, /mit Fehlern verarbeitet/);
});

test("all draft controls warn that Seller Hub verification is still required", () => {
  assert.match(source, /Eine erfolgreiche Feed-Verarbeitung ist noch kein Beweis für einen sichtbaren Entwurf/);
  assert.match(source, /Sendet einen unveröffentlichten FX_LISTING-Feed an eBay/);
  assert.match(source, /setStatus\(statusTextFromTask\(existing\.body\), 'warn'\)/);
});
