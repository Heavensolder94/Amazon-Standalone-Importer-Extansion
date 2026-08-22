import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const collector = await readFile(new URL('../batch-collector.js', import.meta.url), 'utf8');
const loader = await readFile(new URL('../popup-fixed.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

test('collector scans Amazon result cards and deduplicates by ASIN', () => {
  assert.match(collector, /s-search-result/);
  assert.match(collector, /data-asin/);
  assert.match(collector, /new Map\(queue\.map/);
  assert.match(collector, /\^\[A-Z0-9\]\{10\}\$/);
});

test('batch preparation stays bounded and sequential', () => {
  assert.match(collector, /const MAX_BATCH = 20/);
  assert.match(collector, /for \(let index = 0; index < candidates\.length; index \+= 1\)/);
  assert.match(collector, /chrome\.tabs\.create\(\{ url: item\.url, active: false \}\)/);
  assert.match(collector, /await runAutomaticListingDesigner\(\{ silent: true, batch: true \}\)/);
  assert.match(collector, /status = 'ready'/);
});

test('collector persists prepared queue and never bulk publishes', () => {
  assert.match(collector, /elyon_amazon_importer_batch_queue_v1/);
  assert.match(collector, /localStorage\.setItem\(STORAGE_KEY/);
  assert.doesNotMatch(collector, /sellerLifecycleAction\(['"]publish['"]/);
  assert.doesNotMatch(collector, /createSellerHubDraftFromButton/);
});

test('popup loads toast suppression before collector and batch-capable version is retained', () => {
  const toastIndex = loader.indexOf('toast-notifications.js');
  const bridgeIndex = loader.indexOf('batch-status-bridge.js');
  const collectorIndex = loader.indexOf('batch-collector.js');
  assert.ok(toastIndex >= 0 && bridgeIndex > toastIndex && collectorIndex > bridgeIndex);

  const [major, minor, patch] = String(manifest.version).split('.').map(Number);
  const atLeastBatchVersion = major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 14)));
  assert.ok(atLeastBatchVersion, `expected extension version >= 1.2.14, got ${manifest.version}`);
});
