(() => {
  'use strict';

  const DRAFT_TASKS_STORAGE_KEY = 'elyon_amazon_importer_seller_hub_draft_tasks_v1';

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const norm = (value) => clean(value).toLocaleLowerCase('de-DE').replace(/[.:]/g, '');

  function readJsonTextarea() {
    const el = document.getElementById('ebayItemSpecifics');
    if (!el) return {};
    try {
      const parsed = JSON.parse(el.value || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeJsonTextarea(value) {
    const el = document.getElementById('ebayItemSpecifics');
    if (!el) return;
    el.value = Object.keys(value).length ? JSON.stringify(value, null, 2) : '';
  }

  function sourceText() {
    return [
      document.getElementById('title')?.value,
      document.getElementById('description')?.value,
      document.getElementById('rawData')?.value
    ].map((value) => String(value || '')).join('\n');
  }

  function rawLines() {
    return String(document.getElementById('rawData')?.value || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function detailValue(aliases) {
    const wanted = aliases.map(norm);
    for (const line of rawLines()) {
      const match = line.match(/^([^:]{2,80}):\s*(.+)$/);
      if (!match) continue;
      if (wanted.includes(norm(match[1]))) return clean(match[2]);
    }
    return '';
  }

  function values(value) {
    if (Array.isArray(value)) return value.map(clean).filter(Boolean);
    const text = clean(value);
    return text ? [text] : [];
  }

  function existingKey(specifics, aliases) {
    const wanted = aliases.map(norm);
    return Object.keys(specifics).find((key) => wanted.includes(norm(key))) || '';
  }

  function put(specifics, name, value, aliases = []) {
    const incoming = values(value);
    if (!incoming.length) return false;
    const key = existingKey(specifics, [name, ...aliases]) || name;
    if (values(specifics[key]).length) return false;
    specifics[key] = incoming;
    return true;
  }

  function connectivity(text) {
    const out = [];
    const push = (value) => { if (!out.includes(value)) out.push(value); };
    if (/\b(?:usb[\s-]?c|type[\s-]?c|usb type[\s-]?c)\b/i.test(text)) push('USB-C');
    if (/\b(?:usb[\s-]?a|usb type[\s-]?a)\b/i.test(text)) push('USB-A');
    if (/\blightning\b/i.test(text)) push('Lightning');
    if (/\bmicro[\s-]?usb\b/i.test(text)) push('Micro-USB');
    return out;
  }

  function wirelessStandard(text) {
    if (/\bqi2\b/i.test(text)) return 'Qi2';
    if (/\bmagsafe\b/i.test(text)) return 'MagSafe';
    if (/\bqi\b/i.test(text)) return 'Qi';
    return '';
  }

  function portCount(text) {
    const explicit = detailValue([
      'Anzahl der Anschlüsse', 'Anzahl Anschlüsse', 'Number of Ports', 'Number of USB Ports', 'Ports'
    ]);
    const direct = explicit.match(/\b(\d{1,2})\b/);
    if (direct) return direct[1];
    const match = text.match(/\b(\d{1,2})\s*(?:-?port|ports|anschlü(?:ss|s)e|usb[- ]?ports?)\b/i);
    return match ? match[1] : '';
  }

  function voltage(text) {
    const explicit = detailValue(['Spannung', 'Voltage', 'Ausgangsspannung', 'Output Voltage']);
    if (explicit) return explicit;
    const matches = [...text.matchAll(/\b(5|9|10|12|15|20)\s*V\b/gi)].map((match) => `${match[1]} V`);
    return [...new Set(matches)].slice(0, 4);
  }

  function brandCompatibility(text) {
    const explicit = detailValue([
      'Markenkompatibilität', 'Kompatible Marke', 'Compatible Brand', 'Compatible Devices', 'Kompatible Geräte'
    ]);
    if (explicit) return explicit;
    const brands = [];
    const checks = [
      ['Apple', /\b(?:iphone|ipad|apple)\b/i],
      ['Samsung', /\bsamsung\b/i],
      ['Google', /\b(?:google pixel|pixel)\b/i],
      ['Huawei', /\bhuawei\b/i],
      ['Xiaomi', /\bxiaomi\b/i]
    ];
    checks.forEach(([brand, regex]) => { if (regex.test(text)) brands.push(brand); });
    return brands;
  }

  function includedItems() {
    return detailValue([
      'Inbegriffene Artikel', 'Lieferumfang', 'Inbegriffene Komponenten', 'Included Components', 'Included Items', 'Was ist im Lieferumfang enthalten'
    ]);
  }

  function mountingLocation() {
    return detailValue(['Befestigungsort', 'Mounting Location', 'Montageort']);
  }

  function capacity(text) {
    const explicit = detailValue(['Kapazität', 'Akkukapazität', 'Batteriekapazität', 'Battery Capacity']);
    if (explicit) return explicit;
    const match = text.match(/\b(\d{3,6})\s*mAh\b/i);
    return match ? `${match[1]} mAh` : '';
  }

  function wattage(text) {
    const explicit = detailValue(['Leistung', 'Wattzahl', 'Ausgangsleistung', 'Output Power', 'Maximale Ausgangsleistung']);
    if (explicit) return explicit;
    const match = text.match(/\b(\d{1,3}(?:[.,]\d)?)\s*W\b/i);
    return match ? `${match[1].replace(',', '.')} W` : '';
  }

  function isChargingProduct(text) {
    return /power\s*bank|powerbank|ladegerät|charger|battery pack|akku(?:pack)?|wireless charg/i.test(text);
  }

  function forgetCurrentDraftTask() {
    const asin = clean(document.getElementById('asin')?.value);
    if (!asin) return;
    try {
      const tasks = JSON.parse(localStorage.getItem(DRAFT_TASKS_STORAGE_KEY) || '{}');
      if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks)) return;
      const key = `amazon:${asin}`;
      if (tasks[key]) {
        delete tasks[key];
        localStorage.setItem(DRAFT_TASKS_STORAGE_KEY, JSON.stringify(tasks));
      }
    } catch {}
  }

  function enrichItemSpecifics() {
    const specifics = readJsonTextarea();
    const before = JSON.stringify(specifics);
    const text = sourceText();

    const explicitConnectivity = detailValue(['Konnektivität', 'Connectivity', 'Anschlusstyp', 'Connector Type']);
    put(specifics, 'Konnektivität', explicitConnectivity || connectivity(text), ['Connectivity']);
    put(specifics, 'Kabelloser Ladestandard', detailValue(['Kabelloser Ladestandard', 'Wireless Charging Standard']) || wirelessStandard(text), ['Wireless Charging Standard']);
    put(specifics, 'Anzahl der Anschlüsse', portCount(text), ['Number of Ports']);
    put(specifics, 'Befestigungsort', mountingLocation(), ['Mounting Location']);
    put(specifics, 'Inbegriffene Artikel', includedItems(), ['Included Items', 'Included Components']);
    put(specifics, 'Markenkompatibilität', brandCompatibility(text), ['Compatible Brand']);
    put(specifics, 'Spannung', voltage(text), ['Voltage']);

    if (isChargingProduct(text)) {
      put(specifics, 'Kapazität', capacity(text), ['Akkukapazität', 'Battery Capacity']);
      put(specifics, 'Leistung', wattage(text), ['Ausgangsleistung', 'Output Power']);
    }

    const after = JSON.stringify(specifics);
    if (after !== before) {
      writeJsonTextarea(specifics);
      forgetCurrentDraftTask();
      return true;
    }
    return false;
  }

  const originalMerge = typeof globalThis.mergeDesignerFactsIntoSpecifics === 'function'
    ? globalThis.mergeDesignerFactsIntoSpecifics
    : (typeof mergeDesignerFactsIntoSpecifics === 'function' ? mergeDesignerFactsIntoSpecifics : null);

  if (originalMerge) {
    const wrappedMerge = function wrappedMerge(...args) {
      const result = originalMerge(...args);
      enrichItemSpecifics();
      return readJsonTextarea();
    };
    try { globalThis.mergeDesignerFactsIntoSpecifics = wrappedMerge; } catch {}
    try { mergeDesignerFactsIntoSpecifics = wrappedMerge; } catch {}
  }

  const originalSafeDraftPayload = typeof globalThis.safeDraftPayload === 'function'
    ? globalThis.safeDraftPayload
    : (typeof safeDraftPayload === 'function' ? safeDraftPayload : null);

  if (originalSafeDraftPayload) {
    const wrappedSafeDraftPayload = function wrappedSafeDraftPayload(...args) {
      enrichItemSpecifics();
      return originalSafeDraftPayload(...args);
    };
    try { globalThis.safeDraftPayload = wrappedSafeDraftPayload; } catch {}
    try { safeDraftPayload = wrappedSafeDraftPayload; } catch {}
  }

  function scheduleEnrichment() {
    setTimeout(enrichItemSpecifics, 250);
    setTimeout(enrichItemSpecifics, 1200);
  }

  ['loadProduct', 'rerunDesigner', 'applyEbayCategory'].forEach((id) => {
    document.getElementById(id)?.addEventListener('click', scheduleEnrichment);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleEnrichment, { once: true });
  } else {
    scheduleEnrichment();
  }
})();
