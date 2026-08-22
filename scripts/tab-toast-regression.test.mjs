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
  assert.equal(manifest.version, '1.2.17');
});
