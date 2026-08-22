import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../workflow-fix.js', import.meta.url), 'utf8');
const start = source.indexOf('function parseAmazonPriceText');
const end = source.indexOf('\n\n  function suggestedSellPrice', start);
if (start < 0 || end < 0) throw new Error('parseAmazonPriceText helper not found');
const helper = source.slice(start, end).replace(/^  /gm, '');

const context = {};
vm.createContext(context);
vm.runInContext(`${helper}\nthis.parseAmazonPriceText = parseAmazonPriceText;`, context);
const parse = context.parseAmazonPriceText;

assert.equal(parse('9,99 €'), 9.99);
assert.equal(parse('19.99 EUR'), 19.99);
assert.equal(parse('1.299,99 €'), 1299.99);
assert.equal(parse('$1,299.99'), 1299.99);
assert.equal(parse('1.299 €'), 1299);
assert.equal(parse(''), 0);

console.log('✅ Amazon price parsing regression cases passed');
