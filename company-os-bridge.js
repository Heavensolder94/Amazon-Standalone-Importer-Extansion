(() => {
  'use strict';

  // The Company OS import API uses the same workspace sync code as Company OS.
  // Store it only in Chrome's ephemeral extension session, never localStorage.
  const SESSION_KEY = 'elyon_amazon_importer_company_sync_code_session';
  let activeCode = '';
  let importRunning = false;

  const el = (id) => document.getElementById(id);
  const clean = (value) => String(value ?? '').trim();
  const note = (value) => { if (el('companySessionStatus')) el('companySessionStatus').textContent = value; };

  async function getSessionCode() {
    const input = clean(el('companySyncCode')?.value);
    if (input) {
      if (input.length < 6) throw new Error('Der Company-OS-Sync-Code muss mindestens 6 Zeichen enthalten.');
      activeCode = input;
      if (el('companySyncCode')) el('companySyncCode').value = '';
      if (globalThis.chrome?.storage?.session) {
        await chrome.storage.session.set({ [SESSION_KEY]: input });
      }
      note('Sync-Code nur für diese Browser-Sitzung hinterlegt. Er wird beim Neustart gelöscht.');
      return input;
    }
    if (activeCode) return activeCode;
    if (globalThis.chrome?.storage?.session) {
      const stored = await chrome.storage.session.get(SESSION_KEY);
      activeCode = clean(stored?.[SESSION_KEY]);
      if (activeCode.length >= 6) {
        note('Sitzung verbunden. Für einen anderen Company-OS-Bereich den Sitzungscode löschen.');
        return activeCode;
      }
    }
    throw new Error('Bitte den Sync-Code deines Company-OS-Arbeitsbereichs eingeben. Ohne den richtigen Code landet der Import nicht in deinem Nova-Eingang.');
  }

  async function clearSessionCode() {
    activeCode = '';
    if (el('companySyncCode')) el('companySyncCode').value = '';
    if (globalThis.chrome?.storage?.session) await chrome.storage.session.remove(SESSION_KEY);
    note('Kein Company-OS-Sync-Code für diese Sitzung hinterlegt.');
    if (typeof setStatus === 'function') setStatus('Company-OS-Sitzungscode gelöscht.', 'ok');
  }

  function checkProduct(payload) {
    const product = payload?.product;
    if (!product?.title || !product?.sourceUrl) throw new Error('Für Company OS fehlen Produkttitel oder Amazon-Quelllink.');
    let url;
    try { url = new URL(product.sourceUrl); } catch { throw new Error('Ungültiger Amazon-Produktlink.'); }
    if (url.protocol !== 'https:' || !/(^|\.)amazon\.(de|com|co\.uk)$/i.test(url.hostname)) {
      throw new Error('Für den Amazon-Importer ist nur eine HTTPS-Amazon-Produktseite zulässig.');
    }
    return payload;
  }

  async function postProduct(payload, code) {
    checkProduct(payload);
    const response = await fetch(COMPANY_OS_IMPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Elyon-Sync-Code': code },
      credentials: 'omit',
      cache: 'no-store',
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true || result.imported !== true || result.status !== 'nova_inbox') {
      throw new Error(clean(result.error || result.message) || 'Company OS hat den Nova-Import nicht bestätigt (HTTP ' + response.status + ').');
    }
    return result;
  }

  async function importCurrent() {
    if (importRunning) return;
    importRunning = true;
    try {
      const payload = checkProduct(companyOsPayload());
      if (typeof setCompanyUi === 'function') setCompanyUi('checking', 'Status: Amazon-Produkt wird übertragen ...');
      if (typeof setStatus === 'function') setStatus('Import in den Company-OS-Nova-Eingang wird geprüft ...', 'warn');
      const code = await getSessionCode();
      const result = await postProduct(payload, code);
      if (typeof setCompanyUi === 'function') setCompanyUi('connected', 'Status: Import im Nova-Eingang bestätigt');
      if (typeof setStatus === 'function') {
        setStatus('Company OS hat den Import bestätigt ✅\nNova-Eingang · Import-ID: ' + clean(result.importId || 'vorhanden') + '\nKeine eBay-Veröffentlichung ausgelöst.', 'ok');
      }
      return result;
    } catch (error) {
      if (typeof setCompanyUi === 'function') setCompanyUi('error', 'Status: Company-OS-Import fehlgeschlagen');
      if (typeof setStatus === 'function') setStatus('Company-OS-Import fehlgeschlagen: ' + error.message, 'err');
      el('companySyncCode')?.focus();
      return null;
    } finally {
      importRunning = false;
    }
  }

  function batchPayload(item) {
    const source = item?.product || {};
    const fields = item?.snapshot?.fields || {};
    const specifics = (() => {
      try {
        const parsed = JSON.parse(fields.ebayItemSpecifics || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch { return {}; }
    })();
    const price = Number(fields.buyPrice || 0) || Number(String(source.price || '').replace(/[^0-9,.]/g, '').replace(',', '.')) || 0;
    return {
      product: {
        title: clean(fields.title || source.title),
        description: String(fields.description || source.description || ''),
        source: 'amazon',
        sourceLabel: 'Amazon',
        sourceRole: 'retail_research_source',
        sourceUrl: clean(source.url || item?.url),
        rawPrice: price,
        salePrice: Number(fields.sellPrice || 0) || 0,
        images: [...new Set((Array.isArray(source.images) ? source.images : [source.img]).filter((url) => /^https:\/\//i.test(url || '')))].slice(0, 12),
        brand: clean(fields.brand || source.brand),
        department: clean(fields.department),
        style: clean(fields.style),
        material: clean(fields.material),
        modelNumber: clean(fields.modelNumber),
        itemSpecifics: specifics,
        ebayCategoryId: clean(fields.ebayCategoryId),
        riskNotes: 'Retail-Recherchequelle. Amazon-Bilder und -Texte nicht ungeprüft auf eBay verwenden; Produkt und Liefermodell noch prüfen.',
        importedAt: new Date().toISOString(),
        meta: {
          asin: clean(item?.asin),
          importSource: 'elyon_amazon_importer_extension',
          sourceType: 'retail_research',
          contentUsage: 'source_material_only',
          importerVersion: '1.3.0',
          automaticListingDesigner: true
        }
      }
    };
  }

  async function importPreparedBatch(items, onResult) {
    if (importRunning) throw new Error('Es läuft bereits ein Company-OS-Import.');
    const products = (Array.isArray(items) ? items : []).filter((item) => item.status === 'ready').slice(0, 20);
    if (!products.length) throw new Error('Bitte vorbereitete Batch-Artikel auswählen.');
    importRunning = true;
    try {
      const code = await getSessionCode();
      const outcomes = [];
      for (const item of products) {
        let outcome;
        try {
          const result = await postProduct(batchPayload(item), code);
          outcome = { asin: item.asin, ok: true, importId: clean(result.importId) };
        } catch (error) {
          outcome = { asin: item.asin, ok: false, error: clean(error.message) };
        }
        outcomes.push(outcome);
        if (typeof onResult === 'function') onResult(outcome);
      }
      return outcomes;
    } finally {
      importRunning = false;
    }
  }

  function initUi() {
    el('clearCompanySession')?.addEventListener('click', () => clearSessionCode().catch((error) => {
      if (typeof setStatus === 'function') setStatus(error.message, 'err');
    }));
    el('copyCompanyOsJson')?.addEventListener('click', async () => {
      try {
        const payload = checkProduct(companyOsPayload());
        await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
        if (typeof setStatus === 'function') setStatus('Company-OS-Recherchepayload kopiert; kein Import ausgelöst.', 'ok');
      } catch (error) {
        if (typeof setStatus === 'function') setStatus(error.message, 'err');
      }
    });
    if (globalThis.chrome?.storage?.session) {
      chrome.storage.session.get(SESSION_KEY).then((stored) => {
        if (clean(stored?.[SESSION_KEY]).length >= 6) note('Sync-Code für diese Browser-Sitzung vorhanden.');
      }).catch(() => {});
    }
  }

  globalThis.elyonCompanyOsImportCurrent = importCurrent;
  globalThis.elyonCompanyOsImportPreparedBatch = importPreparedBatch;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUi, { once: true });
  else initUi();
})();
