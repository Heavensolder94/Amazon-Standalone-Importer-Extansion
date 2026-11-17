import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bridge = fs.readFileSync(new URL('../company-os-bridge.js', import.meta.url), 'utf8');
const loader = fs.readFileSync(new URL('../popup-fixed.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

function sandbox({ code = 'company-workspace-secret' } = {}) {
  const calls = [];
  const sessions = {};
  const field = { value: code, focus() {} };
  const sessionNote = { textContent: '' };
  const nodes = { companySyncCode: field, companySessionStatus: sessionNote };
  const ctx = {
    URL,
    document: {
      readyState: 'loading',
      getElementById: (id) => nodes[id] || null,
      addEventListener() {}
    },
    chrome: { storage: { session: {
      set: async (value) => { Object.assign(sessions, value); },
      get: async (key) => ({ [key]: sessions[key] }),
      remove: async (key) => { delete sessions[key]; }
    } } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({
        ok: true, imported: true, importId: 'nova-import-123', status: 'nova_inbox'
      }) };
    },
    COMPANY_OS_IMPORT_URL: 'https://elyon-company-os.vercel.app/api/nova/import-product',
    setStatus() {},
    setCompanyUi() {}
  };
  vm.createContext(ctx);
  vm.runInContext(bridge, ctx);
  return { ctx, calls, sessions, field, sessionNote };
}

const prepared = {
  asin: 'B012345678',
  status: 'ready',
  url: 'https://www.amazon.de/dp/B012345678',
  product: {
    title: 'Beispiel Produkt',
    url: 'https://www.amazon.de/dp/B012345678',
    price: '19,99 €',
    images: ['https://images.example.org/item.jpg']
  },
  snapshot: { fields: { title: 'Bearbeiteter Titel', buyPrice: '19.99', sellPrice: '31.99' } }
};

test('Company OS bridge is loaded after core and uses Chrome session storage only', () => {
  assert.ok(loader.indexOf('popup.js') < loader.indexOf('company-os-bridge.js'));
  assert.ok(loader.indexOf('company-os-bridge.js') < loader.indexOf('batch-collector.js'));
  assert.ok(manifest.permissions.includes('storage'));
  assert.equal(manifest.version, '1.3.0');
  assert.match(bridge, /chrome\.storage\.session\.set/);
  assert.match(bridge, /chrome\.storage\.session\.remove/);
  assert.doesNotMatch(bridge, /localStorage\.(setItem|getItem)/);
});

test('prepared products are imported by HTTPS POST with session-only sync code, never in body', async () => {
  const { ctx, calls, sessions, field } = sandbox();
  const events = [];
  const result = await ctx.elyonCompanyOsImportPreparedBatch([prepared], (event) => events.push(event));
  assert.equal(result.length, 1);
  assert.equal(result[0].ok, true);
  assert.equal(result[0].importId, 'nova-import-123');
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, ctx.COMPANY_OS_IMPORT_URL);
  assert.equal(options.method, 'POST');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers['X-Elyon-Sync-Code'], 'company-workspace-secret');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(field.value, '');
  const body = JSON.parse(options.body);
  assert.equal(body.product.meta.importerVersion, '1.3.0');
  assert.equal(body.product.sourceRole, 'retail_research_source');
  assert.equal(body.product.rawPrice, 19.99);
  assert.equal(body.product.title, 'Bearbeiteter Titel');
  assert.equal(body.product.sourceUrl, prepared.url);
  assert.ok(!options.body.includes('company-workspace-secret'));
  assert.ok(!JSON.stringify(events).includes('company-workspace-secret'));
  assert.equal(Object.keys(sessions).length, 1);
});

test('batch rejects missing workspace code before any network import', async () => {
  const { ctx, calls } = sandbox({ code: '' });
  await assert.rejects(() => ctx.elyonCompanyOsImportPreparedBatch([prepared]), /Sync-Code/);
  assert.equal(calls.length, 0);
});

test('batch never processes unprepared products or more than 20 per run', async () => {
  const { ctx, calls } = sandbox();
  const many = Array.from({ length: 22 }, (_, i) => ({
    ...prepared,
    asin: 'B' + String(i).padStart(9, '0')
  }));
  await ctx.elyonCompanyOsImportPreparedBatch([{ ...prepared, status: 'collected' }, ...many]);
  assert.equal(calls.length, 20);
});

test('Company OS import cannot accept non-Amazon HTTP addresses', async () => {
  const { ctx, calls } = sandbox();
  const evil = { ...prepared, url: 'https://other.example/dp/B012345678', product: { ...prepared.product, url: 'https://other.example/dp/B012345678' } };
  const result = await ctx.elyonCompanyOsImportPreparedBatch([evil]);
  assert.equal(result[0].ok, false);
  assert.match(result[0].error, /Amazon/);
  assert.equal(calls.length, 0);
});
