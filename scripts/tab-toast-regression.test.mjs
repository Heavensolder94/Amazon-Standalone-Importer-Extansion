import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const toast = await readFile(new URL('../toast-notifications.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('status toasts render in the active browser tab, not inside the extension popup', () => {
  assert.match(toast, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.match(toast, /chrome\.scripting\.executeScript/);
  assert.match(toast, /target:\s*\{\s*tabId:\s*tab\.id\s*\}/);
  assert.match(toast, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.doesNotMatch(toast, /document\.body[^\n]*appendChild\([^\n]*elyonToast/i);
});

test('browser-tab toast keeps slide-in behavior and safe restricted-page fallback', () => {
  assert.match(toast, /translateX\(calc\(100% \+ 34px\)\)/);
  assert.match(toast, /\^https\?:\\\/\\\//);
  assert.match(toast, /Der normale Status in der Extension bleibt trotzdem erhalten/);
  assert.match(String(manifest.description || ''), /Slide-in-Statusmeldungen im aktiven Chrome-Tab/i);
});

test('Feed draft recovery checks the old eBay task without submitting a duplicate', async () => {
  const bridge = await readFile(new URL('../direct-ebay-bridge.js', import.meta.url), 'utf8');
  const start = bridge.indexOf('async function syncExistingSellerHubDraft(');
  const end = bridge.indexOf('function openSellerHubDrafts(', start);
  assert.ok(start > 0 && end > start);
  const recovery = bridge.slice(start, end);
  assert.match(recovery, /savedTasks\[key\]/);
  assert.match(recovery, /checkSavedTask\(session, recoveryPayload, saved\)/);
  assert.doesNotMatch(recovery, /'create-draft'/);
  assert.match(bridge, /feedTaskLookup\(payload, saved\.taskId, saved\.sku\)/);
  assert.match(bridge, /feedTaskLookup\(payload, taskId, sku\)/);
  assert.match(bridge, /body\?\.registration\?\.persisted === true/);
  assert.match(bridge, /Vorhandenen Entwurf mit ELYON abgleichen/);
});

test('when extension lost local task ID, recovery searches eBay task history by exact SKU without new draft', async () => {
  const bridge = await readFile(new URL('../direct-ebay-bridge.js', import.meta.url), 'utf8');
  const start = bridge.indexOf('async function syncExistingSellerHubDraft(');
  const end = bridge.indexOf('function openSellerHubDrafts(', start);
  assert.ok(start > 0 && end > start);
  const recovery = bridge.slice(start, end);
  assert.match(recovery, /if \(!saved\?\.taskId\)/);
  assert.match(recovery, /requestSellerAction\(session, 'recover-draft', feedTaskLookup\(recoveryPayload, '', identity\.sku\)\)/);
  assert.match(recovery, /rememberDraftTask\(recoveryPayload, response\.body\)/);
  assert.match(recovery, /registration\?\.persisted === true/);
  assert.doesNotMatch(recovery, /requestSellerAction\(session, 'create-draft'/);
});
