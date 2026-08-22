import fs from 'node:fs';
import assert from 'node:assert/strict';

const imageFix = fs.readFileSync(new URL('../batch-image-fix.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../popup-fixed.js', import.meta.url), 'utf8');

for (const token of ['data-src', 'data-lazy-src', 'data-old-hires', 'data-a-dynamic-image', 'srcset']) {
  assert.ok(imageFix.includes(token), `batch image fix should support ${token}`);
}
assert.ok(imageFix.includes("img.s-image"), 'search-result images should be scanned');
assert.ok(imageFix.includes('MutationObserver'), 'rendered batch rows should be repaired after rerenders');
assert.ok(imageFix.includes("addEventListener('error'"), 'broken image URLs should degrade to fallback');
assert.ok(loader.indexOf('batch-collector.js') < loader.indexOf('batch-image-fix.js'), 'image fix must load after batch collector');

console.log('batch image regression: ok');
