import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const toast = await readFile(new URL('../toast-notifications.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('status toasts are injected into the active browser tab instead of the extension popup', () => {
  assert.match(toast, /chrome\.tabs\.query\(\{ active: true, currentWindow: true \}\)/);
  assert.match(toast, /chrome\.scripting\.executeScript/);
  assert.match(toast, /target:\s*\{\s*tabId:/);
  assert.doesNotMatch(toast, /document\.body.*elyonToastStack/s);
});

test('tab toast keeps slide-in behavior and falls back safely on restricted pages', () => {
  assert.match(toast, /translateX\(calc\(100% \+ 34px\)\)/);
  assert.match(toast, /showElyonToast/);
  assert.match(toast, /catch/);
  assert.equal(manifest.version, '1.2.17');
});
