import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../popup.js', import.meta.url), 'utf8');
const bridge = fs.readFileSync(new URL('../direct-ebay-bridge.js', import.meta.url), 'utf8');
const batch = fs.readFileSync(new URL('../batch-collector.js', import.meta.url), 'utf8');

const start = source.indexOf('function validateDraftInput(data)');
const end = source.indexOf('\nfunction validateCompanyInput(', start);
assert.ok(start >= 0 && end > start, 'full draft validator must exist');
const validate = source.slice(start, end);

function runDraftValidation(overrides = {}, { rights = true, policiesReady = true } = {}) {
  const data = {
    title: 'Beispiel',
    price: 29.99,
    categoryId: '12345',
    conditionEnum: 'NEW',
    images: ['https://images.example.org/own-photo.jpg'],
    itemSpecifics: { Marke: ['Beispiel'] },
    ...overrides
  };
  const ctx = {
    $: (id) => id === 'contentRightsConfirmed' ? { checked: rights } : null,
    missingRequiredAspects: () => [],
    selectedEbayPolicies: () => ({
      fulfillmentPolicyId: policiesReady ? 'ship' : '',
      paymentPolicyId: policiesReady ? 'pay' : '',
      returnPolicyId: policiesReady ? 'return' : '',
      merchantLocationKey: policiesReady ? 'warehouse' : ''
    })
  };
  vm.createContext(ctx);
  vm.runInContext(validate + '\nthis.runValidation = validateDraftInput;', ctx);
  return ctx.runValidation(data);
}

test('draft guard requires manually reviewed images, rights and full eBay setup', () => {
  assert.equal(runDraftValidation(), '');
  assert.match(runDraftValidation({ images: [] }), /Bild/);
  assert.match(runDraftValidation({ categoryId: '' }), /Kategorie/);
  assert.match(runDraftValidation({ itemSpecifics: {} }), /merkmale/i);
  assert.match(runDraftValidation({}, { rights: false }), /Inhalte geprüft/);
  assert.match(runDraftValidation({}, { policiesReady: false }), /Richtlinie|Standort/);
});

test('direct Seller Hub bridge calls full validator before submitting a draft', () => {
  const validation = bridge.indexOf("validateDraftInput(payload)");
  const network = bridge.indexOf("requestSellerAction(session, 'create-draft', payload)");
  assert.ok(validation > 0 && network > validation);
  assert.match(bridge, /if \(validationError\)/);
  assert.match(bridge, /eBay-Entwurf blockiert/);
  assert.match(bridge, /body\?\.draftVisible === true/);
  assert.doesNotMatch(bridge, /status === 'COMPLETED' && Number\(body\?\.failureCount/);
});

test('batch differentiates prepared products from confirmed external actions', () => {
  assert.match(batch, /companyOsStatus:\s*\['imported', 'error'\]/);
  assert.match(batch, /ebayDraftStatus:\s*\['processing', 'created', 'error'\]/);
  assert.match(batch, /elyonBatchMarkEbayDraft = markEbayDraft/);
  assert.match(batch, /Company OS: importiert/);
  assert.match(batch, /eBay: Entwurf bestätigt/);
  assert.match(batch, /Keine eBay-Veröffentlichung|Kein eBay-Angebot veröffentlicht/);
});

test('previously created Feed draft is recoverable without another eBay submission', () => {
  const recoveryStart = bridge.indexOf('async function syncExistingSellerHubDraft(');
  const recoveryEnd = bridge.indexOf('function openSellerHubDrafts(', recoveryStart);
  assert.ok(recoveryStart > 0 && recoveryEnd > recoveryStart);
  const recovery = bridge.slice(recoveryStart, recoveryEnd);
  assert.match(recovery, /readDraftTasks\(\)\[key\]/);
  assert.match(recovery, /checkSavedTask\(session, payload, saved\)/);
  assert.doesNotMatch(recovery, /'create-draft'/);
  assert.match(bridge, /feedTaskLookup\(payload, saved\.taskId, saved\.sku\)/);
  assert.match(bridge, /feedTaskLookup\(payload, taskId, sku\)/);
  assert.match(bridge, /Vorhandenen Entwurf mit ELYON abgleichen/);
  assert.match(bridge, /body\?\.registration\?\.persisted/);
});
