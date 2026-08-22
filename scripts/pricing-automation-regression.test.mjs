import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const defaultsSource = await readFile(new URL('../pricing-defaults.js', import.meta.url), 'utf8');
const source = await readFile(new URL('../pricing-automation.js', import.meta.url), 'utf8');
const loader = await readFile(new URL('../popup-fixed.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));

function loadPricing(storage = {}) {
  const values = new Map(Object.entries(storage));
  const context = {
    console,
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); }
    },
    document: {
      readyState: 'loading',
      addEventListener() {},
      getElementById() { return null; },
      querySelector() { return null; }
    }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(defaultsSource, context);
  vm.runInContext(source, context);
  return context;
}

test('default pricing enforces 20 percent margin and 5 euro minimum profit', () => {
  const context = loadPricing();
  const result = context.calculateElyonSalePrice(10);
  assert.equal(result.price, 17.99);
  assert.ok(result.byProfit > result.byMargin);
});

test('higher margin can become the binding pricing rule', () => {
  const context = loadPricing({
    elyon_amazon_importer_target_margin_percent: '35',
    elyon_amazon_importer_min_profit_eur: '1',
    elyon_amazon_importer_price_rounding: 'cent'
  });
  const result = context.calculateElyonSalePrice(20);
  assert.equal(result.reason, 'target_margin');
  assert.ok(result.price >= result.rawPrice);
});

test('pricing settings support commercial .49 and .99 upward rounding', () => {
  const context99 = loadPricing();
  assert.equal(context99.calculateElyonSalePrice(10).price, 17.99);
  const context49 = loadPricing({ elyon_amazon_importer_price_rounding: '49' });
  assert.equal(context49.calculateElyonSalePrice(10).price, 17.49);
});

test('pricing defaults and automation load before DeepSeek and batch processing', () => {
  const defaultsIndex = loader.indexOf('pricing-defaults.js');
  const pricingIndex = loader.indexOf('pricing-automation.js');
  const aiIndex = loader.indexOf('deepseek-listing-ai.js');
  const batchIndex = loader.indexOf('batch-collector.js');
  assert.ok(defaultsIndex >= 0 && pricingIndex > defaultsIndex && aiIndex > pricingIndex && batchIndex > pricingIndex);
  assert.equal(manifest.version, '1.2.18');
});
