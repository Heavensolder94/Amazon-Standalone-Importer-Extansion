const $ = (id) => document.getElementById(id);

const EBAY_CONNECT_URL = 'https://elyonsellertool.vercel.app/api/ebay/auth-start?source=amazon-importer-extension';
const EBAY_CONNECTION_STATUS_URL = 'https://elyonsellertool.vercel.app/api/ebay/status?source=amazon-importer-extension';
const EBAY_SETUP_INFO_URL = 'https://elyonsellertool.vercel.app/api/ebay/setup-info';
const EBAY_CREATE_DRAFT_URL = 'https://elyonsellertool.vercel.app/api/ebay/create-draft'; // Legacy/Diagnose; v1.1.9 nutzt für Aktionen den Seller-Lifecycle.
const SELLER_TOOL_URL = 'https://elyonsellertool.vercel.app/';
const SELLER_EBAY_LIFECYCLE_PATH = '/api/ebay/index?action=';
const AMAZON_STANDALONE_EBAY_CATEGORY_URL = 'https://elyonsellertool.vercel.app/api/amazon-standalone/ebay-categories';

const COMPANY_OS_URL = 'https://elyon-company-os.vercel.app/';
const COMPANY_OS_OPEN_URL = 'https://elyon-company-os.vercel.app/nova';
const COMPANY_OS_IMPORT_URL = 'https://elyon-company-os.vercel.app/api/nova/import-product';

const STORAGE_KEYS = {
  ebayFulfillmentPolicyId: 'elyon_amazon_importer_ebay_fulfillment_policy_id',
  ebayPaymentPolicyId: 'elyon_amazon_importer_ebay_payment_policy_id',
  ebayReturnPolicyId: 'elyon_amazon_importer_ebay_return_policy_id',
  ebayMerchantLocationKey: 'elyon_amazon_importer_ebay_merchant_location_key',
  ebayDirectPublishEnabled: 'elyon_amazon_importer_ebay_direct_publish_enabled',
  autoDesignerEnabled: 'elyon_amazon_importer_auto_designer_enabled'
};
const LEGACY_DEEPSEEK_KEY = 'elyon_deepseek_key';
const LEGACY_COMPANY_SYNC_CODE = 'elyon_amazon_importer_company_os_sync_code';

let state = {
  product: null,
  ebayStatus: 'not_checked',
  ebaySetup: null,
  ebayDraft: null,
  ebayCategories: [],
  ebaySelectedCategory: null,
  ebayCategoryMetadata: null,
  designerFacts: {},
  designerRunning: false,
  companyStatus: 'not_checked'
};

const money = (n) => Number(n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function setStatus(text, cls = '') {
  $('status').className = `status ${cls}`.trim();
  $('status').textContent = text;
}

function setMiniStatus(id, status) {
  const el = $(id);
  if (!el) return;
  const cls = {
    connected: 'ok',
    ready: 'ok',
    connected_not_ready: 'warn',
    checking: 'warn',
    disconnected: 'warn',
    error: 'error',
    not_checked: 'neutral'
  }[status] || 'neutral';
  el.className = `integrationMini ${cls}`;
}

function directPublishEnabled() {
  return localStorage.getItem(STORAGE_KEYS.ebayDirectPublishEnabled) === '1';
}

function autoDesignerEnabled() {
  return localStorage.getItem(STORAGE_KEYS.autoDesignerEnabled) !== '0';
}

function setDraftButtonsEnabled(enabled) {
  ['prepareDraftMain', 'prepareDraft', 'prepareDraftEbay'].forEach((id) => {
    const button = $(id);
    if (!button) return;
    button.disabled = !enabled;
    button.title = enabled
      ? 'Unveröffentlichten eBay-Entwurf erstellen und im Seller Tool registrieren'
      : 'eBay-Entwurf ist noch nicht technisch bereit';
  });
  setPublishButtonsEnabled(enabled && directPublishEnabled());
}

function setPublishButtonsEnabled(enabled) {
  const button = $('publishEbay');
  if (!button) return;
  button.disabled = !enabled;
  button.title = enabled
    ? 'Nach ausdrücklicher Bestätigung wirklich bei eBay veröffentlichen'
    : 'Sofort-Veröffentlichung ist deaktiviert oder eBay noch nicht bereit';
}

function setEbayUi(status) {
  state.ebayStatus = status;
  const map = {
    not_checked: { text: 'Status: eBay noch nicht geprüft', chip: 'Nicht geprüft', cls: 'chip' },
    checking: { text: 'Status: eBay-Entwurfsstatus wird geprüft', chip: 'Prüfen', cls: 'chip gold' },
    ready: { text: 'Status: eBay verbunden · Entwurf bereit', chip: 'Entwurf bereit', cls: 'chip green' },
    connected_not_ready: { text: 'Status: eBay verbunden · Entwurf noch nicht bereit', chip: 'Setup offen', cls: 'chip gold' },
    disconnected: { text: 'Status: eBay nicht verbunden', chip: 'Nicht verbunden', cls: 'chip red' },
    error: { text: 'Status: Fehler bei eBay-Prüfung', chip: 'Fehler', cls: 'chip red' }
  };
  const item = map[status] || map.not_checked;
  $('ebayText').textContent = item.text;
  $('ebayChip').className = item.cls;
  $('ebayChip').textContent = item.chip;
  $('ebaySettingsChip').className = item.cls;
  $('ebaySettingsChip').textContent = item.chip;
  setMiniStatus('ebayStatusMini', status);
  setDraftButtonsEnabled(status === 'ready');
}

function setCompanyUi(status, customText = '') {
  state.companyStatus = status;
  const map = {
    not_checked: { text: 'Status: Company OS nicht geprüft', chip: 'Nicht geprüft', cls: 'chip' },
    checking: { text: 'Status: Company OS wird geprüft', chip: 'Prüfen', cls: 'chip gold' },
    connected: { text: 'Status: Company OS bereit', chip: 'Bereit', cls: 'chip green' },
    disconnected: { text: 'Status: Company OS nicht eingerichtet', chip: 'Nicht bereit', cls: 'chip red' },
    error: { text: 'Status: Fehler bei Company OS', chip: 'Fehler', cls: 'chip red' }
  };
  const item = map[status] || map.not_checked;
  $('companyText').textContent = customText || item.text;
  $('companyChip').className = item.cls;
  $('companyChip').textContent = item.chip;
  $('companySettingsChip').className = item.cls;
  $('companySettingsChip').textContent = item.chip;
  setMiniStatus('companyStatusMini', status);
}

function ebayTitle(title) {
  return clean(title).replace(/Amazon|Prime|Versand durch Amazon/gi, '').slice(0, 80);
}

function ebayDesc(product) {
  const bullets = (product.bullets || []).filter(Boolean).map((x) => `• ${clean(x)}`).join('\n');
  return clean(`${product.title || ''}\n\n${bullets}\n\n${product.description || ''}`)
    .replace(/Prime|Amazon|Versand durch Amazon/gi, '')
    .trim();
}

function parsePrice(value) {
  const normalized = String(value || '')
    .replace(/[^0-9,.]/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(',', '.');
  return Number(normalized) || 0;
}

function normalizedKey(value) {
  return clean(value).toLocaleLowerCase('de-DE').replace(/[.:]/g, '');
}

function firstDetail(product, aliases = []) {
  const details = product?.details && typeof product.details === 'object' ? product.details : {};
  const entries = Object.entries(details);
  for (const alias of aliases) {
    const wanted = normalizedKey(alias);
    const found = entries.find(([key]) => normalizedKey(key) === wanted);
    if (found && clean(found[1])) return clean(found[1]);
  }
  return '';
}

function stripMarketplaceNoise(value) {
  return clean(value)
    .replace(/\bAmazon(?:\.de)?\b/gi, '')
    .replace(/\bPrime\b/gi, '')
    .replace(/Versand durch Amazon/gi, '')
    .replace(/\bBestseller\b/gi, '')
    .replace(/\s*[|–—-]\s*(?:Amazon[^|–—-]*)$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractDesignerFacts(product) {
  const variations = product?.variations && typeof product.variations === 'object' ? product.variations : {};
  const breadcrumbs = Array.isArray(product?.breadcrumbs) ? product.breadcrumbs.filter(Boolean) : [];
  const category = breadcrumbs.length ? clean(breadcrumbs[breadcrumbs.length - 1]) : '';
  const brand = clean(product?.brand || firstDetail(product, ['Marke', 'Brand']));
  const manufacturer = firstDetail(product, ['Hersteller', 'Manufacturer']);
  const model = firstDetail(product, ['Modellnummer', 'Modell', 'Model number', 'Model']);
  const mpn = firstDetail(product, ['Herstellerreferenz', 'Herstellernummer', 'MPN', 'Part Number']);
  const color = clean(variations.Farbe || variations.Color || firstDetail(product, ['Farbe', 'Color']));
  const size = clean(variations.Größe || variations.Size || firstDetail(product, ['Größe', 'Size']));
  const material = firstDetail(product, ['Material', 'Materialtyp', 'Material type']);
  const style = firstDetail(product, ['Stil', 'Style']);
  const department = firstDetail(product, ['Abteilung', 'Department', 'Zielgruppe']);
  const productType = firstDetail(product, ['Produkttyp', 'Produktart', 'Item type']) || category;
  const ean = firstDetail(product, ['EAN', 'GTIN', 'UPC']);
  const countryOfOrigin = firstDetail(product, ['Herkunftsland', 'Ursprungsland', 'Country of origin']);
  return {
    brand, manufacturer, model, mpn, color, size, material, style, department,
    productType, ean, countryOfOrigin, category,
    variations,
    details: product?.details || {}
  };
}

function buildDesignerTitle(product, facts) {
  const raw = stripMarketplaceNoise(product?.title || '');
  const prefix = facts.brand && !raw.toLocaleLowerCase('de-DE').startsWith(facts.brand.toLocaleLowerCase('de-DE'))
    ? `${facts.brand} `
    : '';
  return clean(`${prefix}${raw}`)
    .replace(/[★✓✔]/g, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 80);
}

function buildDesignerDescription(product, facts) {
  const lines = [];
  const type = facts.productType || 'Produkt';
  const brand = facts.brand ? `${facts.brand} ` : '';
  lines.push(`${brand}${type}`.trim());
  lines.push('');
  const details = [
    ['Marke', facts.brand],
    ['Modell', facts.model || facts.mpn],
    ['Farbe', facts.color],
    ['Größe', facts.size],
    ['Material', facts.material],
    ['Stil', facts.style],
    ['Abteilung', facts.department]
  ].filter(([, value]) => clean(value));
  if (details.length) {
    lines.push('Produktdetails:');
    details.forEach(([label, value]) => lines.push(`• ${label}: ${clean(value)}`));
  }
  const featureLines = (Array.isArray(product?.bullets) ? product.bullets : [])
    .map(stripMarketplaceNoise)
    .filter(Boolean)
    .slice(0, 5);
  if (featureLines.length) {
    lines.push('');
    lines.push('Merkmale:');
    featureLines.forEach((value) => lines.push(`• ${value}`));
  }
  if (clean(product?.description)) {
    const extra = stripMarketplaceNoise(product.description).slice(0, 1000);
    if (extra) {
      lines.push('');
      lines.push(extra);
    }
  }
  return lines.join('\n').trim().slice(0, 8000);
}

function setDesignerStep(step, status, detail = '') {
  const el = document.querySelector(`.designerStep[data-step="${step}"]`);
  if (!el) return;
  el.className = `designerStep ${status || 'neutral'}`;
  const small = el.querySelector('small');
  if (small && detail) small.textContent = detail;
}

function valueForAspect(name, facts) {
  const key = normalizedKey(name);
  if (/^(marke|brand)$/.test(key)) return facts.brand;
  if (key.includes('farbe') || key === 'color') return facts.color;
  if (key.includes('material')) return facts.material;
  if (key.includes('größe') || key === 'size') return facts.size;
  if (key.includes('stil') || key === 'style') return facts.style;
  if (key.includes('abteilung') || key.includes('department')) return facts.department;
  if (key === 'modell' || key.includes('model')) return facts.model;
  if (key.includes('herstellernummer') || key === 'mpn') return facts.mpn || facts.model;
  if (key.includes('produktart') || key.includes('produkttyp') || key.includes('type')) return facts.productType;
  if (key === 'ean' || key === 'gtin' || key === 'upc') return facts.ean;
  if (key.includes('herstellungsland') || key.includes('ursprungsland')) return facts.countryOfOrigin;
  return '';
}

function mergeDesignerFactsIntoSpecifics(metadata = null) {
  const facts = state.designerFacts || {};
  let current = {};
  try { current = manualEbayItemSpecifics(); } catch { current = {}; }
  const aspects = Array.isArray(metadata?.aspects) ? metadata.aspects : [];
  const names = aspects.length ? aspects.map((aspect) => aspect.name) : ['Marke','Farbe','Material','Größe','Stil','Abteilung','Modell','Herstellernummer'];
  for (const name of names) {
    if (current[name]?.length) continue;
    let value = clean(valueForAspect(name, facts));
    if (!value) continue;
    const meta = aspects.find((aspect) => aspect.name === name) || {};
    const allowed = Array.isArray(meta.values) ? meta.values.filter(Boolean) : [];
    if (allowed.length) {
      const exact = allowed.find((candidate) => normalizedKey(candidate) === normalizedKey(value));
      const loose = allowed.find((candidate) => normalizedKey(candidate).includes(normalizedKey(value)) || normalizedKey(value).includes(normalizedKey(candidate)));
      if (exact || loose) value = exact || loose;
      else if (/selection/i.test(clean(meta.mode))) continue;
    }
    current[name] = [value];
  }
  if (facts.brand && !current.Marke && !current.Brand) current.Marke = [facts.brand];
  $('ebayItemSpecifics').value = Object.keys(current).length ? JSON.stringify(current, null, 2) : '';
  return current;
}

function missingRequiredAspects() {
  const required = Array.isArray(state.ebayCategoryMetadata?.required) ? state.ebayCategoryMetadata.required : [];
  let specifics = {};
  try { specifics = manualEbayItemSpecifics(); } catch { return required; }
  return required.filter((name) => !Array.isArray(specifics[name]) || !specifics[name].length);
}

function contactFromFields(prefix) {
  const value = (suffix) => clean($(`${prefix}${suffix}`)?.value || '');
  const contact = value('Contact');
  const result = {
    companyName: value('Name'),
    addressLine1: value('Address'),
    city: value('City'),
    postalCode: value('PostalCode'),
    country: value('Country').toUpperCase()
  };
  if (/^https?:\/\//i.test(contact)) result.contactUrl = contact;
  else if (/@/.test(contact)) result.email = contact;
  else if (contact) result.phone = contact;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value));
}

function designerOpenItems() {
  const open = [];
  if (!/^\d{2,12}$/.test(clean($('ebayCategoryId')?.value || ''))) open.push('Kategorie');
  const missing = missingRequiredAspects();
  if (missing.length) open.push(`Pflichtmerkmale (${missing.length})`);
  if (!clean($('ebayCondition')?.value || '')) open.push('Zustand');
  if (!(Number($('sellPrice')?.value) > 0)) open.push('Verkaufspreis');
  if (!manualEbayImages().length) open.push('geprüfte Bilder');
  if (!$('contentRightsConfirmed')?.checked) open.push('Inhalts-/Rechteprüfung');
  const policies = selectedEbayPolicies();
  if (!policies.fulfillmentPolicyId || !policies.paymentPolicyId || !policies.returnPolicyId || !policies.merchantLocationKey) open.push('eBay Setup');
  return open;
}

function renderDesignerReadiness() {
  if (!$('designerChip')) return;
  const open = designerOpenItems();
  const ready = open.length === 0;
  $('designerChip').className = ready ? 'chip green' : 'chip gold';
  $('designerChip').textContent = ready ? 'Bereit' : `${open.length} offen`;
  const detail = ready ? 'Alle lokalen Checks erfüllt. Vor Publish bleibt die ausdrückliche Bestätigung.' : `Offen: ${open.join(', ')}`;
  $('designerReadinessText').textContent = detail;
  setDesignerStep('review', ready ? 'ok' : 'warn', detail);
  $('designerNote').textContent = ready
    ? 'Designer-Vorbereitung vollständig. Es wurde nichts bei eBay erstellt oder veröffentlicht.'
    : `Automatischer Lauf abgeschlossen. Manuelle Punkte bleiben bewusst offen: ${open.join(', ')}.`;
}

async function runAutomaticListingDesigner(options = {}) {
  if (!state.product || state.designerRunning) return;
  state.designerRunning = true;
  $('designerCard')?.classList.remove('hidden');
  $('designerChip').className = 'chip gold';
  $('designerChip').textContent = 'Läuft';
  setDesignerStep('facts', 'running', 'Amazon-Fakten werden strukturiert ...');
  setDesignerStep('copy', 'neutral');
  setDesignerStep('category', 'neutral');
  setDesignerStep('aspects', 'neutral');
  setDesignerStep('review', 'neutral', 'Automatischer Lauf aktiv');
  if (!options.silent) setStatus('Listing Designer läuft automatisch ...', 'warn');

  try {
    const facts = extractDesignerFacts(state.product);
    state.designerFacts = facts;
    setDesignerStep('facts', 'ok', `${Object.keys(facts.details || {}).length} technische Angaben · ${Object.keys(facts.variations || {}).length} Variantenmerkmale`);

    $('title').value = buildDesignerTitle(state.product, facts);
    $('description').value = buildDesignerDescription(state.product, facts);
    $('brand').value = facts.brand || $('brand').value || '';
    $('department').value = facts.department || '';
    $('style').value = facts.style || '';
    $('material').value = facts.material || '';
    $('modelNumber').value = facts.mpn || facts.model || '';
    $('manufacturerName').value = facts.manufacturer || '';
    $('contentRightsConfirmed').checked = false;
    mergeDesignerFactsIntoSpecifics();
    setDesignerStep('copy', 'ok', 'Titel, Beschreibung und erkannte Produktmerkmale vorbereitet');

    const query = clean([facts.productType, facts.brand, facts.model, $('title').value].filter(Boolean).join(' ')).slice(0, 300);
    $('ebayCategoryQuery').value = query || $('title').value;
    setDesignerStep('category', 'running', 'Beste eBay-DE-Kategorie wird gesucht ...');
    const categories = await searchEbayCategories({ automatic: true, silent: true });
    if (categories?.length && state.ebaySelectedCategory) {
      setDesignerStep('category', 'ok', `${state.ebaySelectedCategory.categoryName} · ID ${state.ebaySelectedCategory.categoryId}`);
      const missing = missingRequiredAspects();
      setDesignerStep('aspects', missing.length ? 'warn' : 'ok', missing.length ? `Noch offen: ${missing.join(', ')}` : 'Erkannte Fakten wurden auf eBay-Merkmale abgebildet');
    } else {
      setDesignerStep('category', 'warn', 'Keine Kategorie automatisch bestätigt – bitte manuell auswählen');
      setDesignerStep('aspects', 'warn', 'Wartet auf eine Kategorie');
    }
  } catch (error) {
    setDesignerStep('category', 'warn', error.message || 'Kategorie konnte nicht automatisch geladen werden');
    setDesignerStep('aspects', 'warn', 'Manuelle Prüfung erforderlich');
  } finally {
    state.designerRunning = false;
    renderDesignerReadiness();
    if (!options.silent) {
      const open = designerOpenItems();
      setStatus(open.length
        ? `Listing Designer automatisch durchgelaufen. Noch offen: ${open.join(', ')}. Es wurde nichts bei eBay erstellt.`
        : 'Listing Designer automatisch durchgelaufen ✅ · lokal bereit für den bewussten eBay-Schritt.', open.length ? 'warn' : 'ok');
    }
  }
}

function fill(product) {
  state.product = product;
  state.designerFacts = {};
  $('productCard').classList.remove('hidden');
  $('designerCard').classList.remove('hidden');
  $('priceCard').classList.remove('hidden');
  $('mainImage').src = product.img || '';
  $('title').value = ebayTitle(product.title);
  $('asin').value = product.asin || '';
  $('brand').value = product.brand || '';
  $('department').value = '';
  $('style').value = '';
  $('material').value = '';
  $('modelNumber').value = '';
  $('manufacturerName').value = '';
  $('manufacturerAddress').value = '';
  $('manufacturerCity').value = '';
  $('manufacturerPostalCode').value = '';
  $('manufacturerCountry').value = '';
  $('manufacturerContact').value = '';
  $('responsibleName').value = '';
  $('responsibleAddress').value = '';
  $('responsibleCity').value = '';
  $('responsiblePostalCode').value = '';
  $('responsibleCountry').value = '';
  $('responsibleContact').value = '';
  $('description').value = ebayDesc(product);
  $('ebayCategoryId').value = '';
  $('ebayCategoryQuery').value = ebayTitle(product.title);
  resetCategorySuggestions('Listing Designer startet nach dem Import automatisch.');
  $('ebayCondition').value = '';
  $('ebayImageUrls').value = '';
  $('ebayItemSpecifics').value = product.brand ? JSON.stringify({ Marke: [product.brand] }, null, 2) : '';
  $('contentRightsConfirmed').checked = false;
  $('fulfillmentModelConfirmed').checked = false;
  state.ebayDraft = null;
  const detailLines = Object.entries(product.details || {}).slice(0, 40).map(([key, value]) => `${key}: ${value}`);
  const variationLines = Object.entries(product.variations || {}).map(([key, value]) => `${key}: ${value}`);
  $('rawData').value = `AMAZON-QUELLDATEN – nur Recherche / interne Bearbeitung\n\nTitel: ${product.title}\nPreis: ${product.price}\nASIN: ${product.asin}\nMarke: ${product.brand}\n\nVarianten:\n${variationLines.join('\n') || 'keine erkannt'}\n\nTechnische Angaben:\n${detailLines.join('\n') || 'keine erkannt'}\n\nBulletpoints:\n${(product.bullets || []).join('\n')}\n\nBeschreibung:\n${product.description || ''}`;
  $('buyPrice').value = parsePrice(product.price).toFixed(2);
  setMiniStatus('amazonStatusMini', 'connected');
  calc();
  ['facts','copy','category','aspects','review'].forEach((step) => setDesignerStep(step, 'neutral'));
  $('designerReadinessText').textContent = 'Import abgeschlossen – Designer noch nicht ausgeführt';
  $('designerChip').className = 'chip gold';
  $('designerChip').textContent = 'Wartet';
}

function calc() {
  const buy = Number($('buyPrice').value) || 0;
  const sell = Number($('sellPrice').value) || 0;
  const fees = sell * 0.12 + 0.35;
  const profit = sell - buy - fees;
  $('fees').textContent = money(fees);
  $('profit').textContent = money(profit);
  $('profitBox').className = `price ${profit >= 0 ? 'profit' : 'loss'}`;
  $('marginChip').textContent = sell ? `${((profit / sell) * 100).toFixed(1)} %` : 'Berechnen';
}

function demoProduct() {
  return {
    title: 'Demo Amazon Produkt – Beispiel Artikel mit hochwertiger Ausstattung',
    price: '29,99 €',
    img: '',
    images: [],
    asin: 'DEMO123456',
    brand: 'DemoBrand',
    bullets: ['Hochwertige Verarbeitung', 'Ideal für Alltag und Geschenk', 'Schnell einsatzbereit'],
    description: 'Demo Beschreibung für den Testmodus.',
    url: ''
  };
}

async function getCurrentProduct() {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return demoProduct();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/amazon\./i.test(tab.url || '')) throw new Error('Bitte eine Amazon-Produktseite öffnen.');

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => {
      const txt = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
      const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || '';
      const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      const title = txt('#productTitle') || document.title;
      const price = txt('.a-price .a-offscreen') || txt('#priceblock_ourprice') || txt('#priceblock_dealprice');
      const img = attr('#landingImage', 'src') || attr('#imgBlkFront', 'src') || document.querySelector('#altImages img')?.src || '';
      const asin = (location.pathname.match(/\/dp\/([A-Z0-9]{10})/) || location.href.match(/[?&]asin=([A-Z0-9]{10})/) || [])[1] || '';
      const brand = txt('#bylineInfo').replace(/^Marke:\s*/i, '').replace(/^Besuche den .*?Store/i, '').trim();
      const bullets = [...document.querySelectorAll('#feature-bullets li span')]
        .map((e) => cleanText(e.textContent))
        .filter(Boolean)
        .slice(0, 8);
      const description = txt('#productDescription') || txt('#aplus') || '';
      const images = [...document.querySelectorAll('#altImages img')]
        .map((image) => image.currentSrc || image.src || '')
        .filter(Boolean)
        .map((url) => url.replace(/\._[^.]+_\./, '.'))
        .slice(0, 12);
      if (img && !images.includes(img)) images.unshift(img);

      const details = {};
      const addDetail = (key, value) => {
        key = cleanText(key).replace(/:$/, '');
        value = cleanText(value);
        if (!key || !value || key.length > 120 || value.length > 500 || Object.keys(details).length >= 60) return;
        if (!details[key]) details[key] = value;
      };
      document.querySelectorAll('#productOverview_feature_div tr, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .prodDetTable tr, table.a-normal.a-spacing-micro tr').forEach((row) => {
        const cells = row.querySelectorAll('th,td');
        if (cells.length >= 2) addDetail(cells[0].textContent, cells[cells.length - 1].textContent);
      });
      document.querySelectorAll('#detailBullets_feature_div li').forEach((li) => {
        const bold = li.querySelector('.a-text-bold');
        if (!bold) return;
        const key = bold.textContent;
        const value = li.textContent.replace(bold.textContent, '');
        addDetail(key, value);
      });

      const variations = {};
      document.querySelectorAll('[id^="variation_"]').forEach((block) => {
        const id = block.id.replace(/^variation_/, '').replace(/_name$/, '').replace(/_/g, ' ');
        const label = cleanText(block.querySelector('label')?.textContent || id).replace(/:$/, '');
        const selected = cleanText(block.querySelector('.selection')?.textContent || block.querySelector('select option:checked')?.textContent || '');
        if (label && selected) variations[label] = selected;
      });
      const breadcrumbs = [...document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a')]
        .map((a) => cleanText(a.textContent))
        .filter(Boolean)
        .slice(0, 8);
      return { title, price, img, images, asin, brand, bullets, description, details, variations, breadcrumbs, url: location.href };
    }
  });
  return result;
}

function listingText() {
  return `Titel:\n${$('title').value}\n\nBeschreibung:\n${$('description').value}\n\nPreis:\n${$('sellPrice').value || 'noch offen'} €\n\nASIN: ${$('asin').value}\nMarke: ${$('brand').value}\nQuelle: ${state.product?.url || ''}`;
}

function getProductImages() {
  const images = Array.isArray(state.product?.images) ? [...state.product.images] : [];
  if (state.product?.img && !images.includes(state.product.img)) images.unshift(state.product.img);
  return images.filter(Boolean).slice(0, 12);
}

function payload() {
  return {
    source: 'elyon-amazon-importer-extension',
    sourceType: 'retail_research',
    contentUsage: 'source_material_only',
    status: 'draft_prepared_only',
    integrations: {
      ebayStatus: state.ebayStatus,
      ebayReadyForDraft: effectiveEbayDraftReady(state.ebaySetup),
      companyOsStatus: state.companyStatus
    },
    product: {
      title: $('title').value,
      description: $('description').value,
      asin: $('asin').value,
      brand: $('brand').value,
      department: $('department').value,
      style: $('style').value,
      material: $('material').value,
      modelNumber: $('modelNumber').value,
      designerFacts: state.designerFacts,
      buyPrice: Number($('buyPrice').value) || 0,
      sellPrice: Number($('sellPrice').value) || 0,
      images: getProductImages(),
      sourceUrl: state.product?.url || ''
    }
  };
}

function selectedPolicyId(storageKey, elementId) {
  const elementValue = clean($(elementId)?.value || '');
  return elementValue || clean(localStorage.getItem(storageKey) || '');
}

function selectedEbayPolicies() {
  return {
    fulfillmentPolicyId: selectedPolicyId(STORAGE_KEYS.ebayFulfillmentPolicyId, 'ebayFulfillmentPolicy'),
    paymentPolicyId: selectedPolicyId(STORAGE_KEYS.ebayPaymentPolicyId, 'ebayPaymentPolicy'),
    returnPolicyId: selectedPolicyId(STORAGE_KEYS.ebayReturnPolicyId, 'ebayReturnPolicy'),
    merchantLocationKey: selectedPolicyId(STORAGE_KEYS.ebayMerchantLocationKey, 'ebayMerchantLocation')
  };
}

function populatePolicySelect(elementId, items, storageKey, preferredMatcher, idKey = 'id', labelBuilder = null) {
  const select = $(elementId);
  if (!select) return '';
  const list = Array.isArray(items) ? items.filter((item) => item?.[idKey]) : [];
  const saved = clean(localStorage.getItem(storageKey) || '');
  let selected = saved && list.some((item) => String(item[idKey]) === saved) ? saved : '';

  if (!selected && typeof preferredMatcher === 'function') {
    const preferred = list.find(preferredMatcher);
    if (preferred?.[idKey]) selected = String(preferred[idKey]);
  }
  if (!selected && list.length === 1) selected = String(list[0][idKey]);

  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = list.length ? 'Bitte auswählen' : 'Keine Richtlinie gefunden';
  select.appendChild(placeholder);

  list.forEach((item) => {
    const option = document.createElement('option');
    option.value = String(item[idKey]);
    option.textContent = typeof labelBuilder === 'function' ? labelBuilder(item) : (item.name || String(item[idKey]));
    select.appendChild(option);
  });

  select.value = selected;
  if (selected) localStorage.setItem(storageKey, selected);
  else localStorage.removeItem(storageKey);
  return selected;
}

function updateEbayPolicySettings(data) {
  if (!data?.connected) return;
  const fulfillmentId = populatePolicySelect(
    'ebayFulfillmentPolicy',
    data.fulfillmentPolicies,
    STORAGE_KEYS.ebayFulfillmentPolicyId,
    (item) => /standard versand elyon/i.test(clean(item.name))
  );
  const paymentId = populatePolicySelect(
    'ebayPaymentPolicy',
    data.paymentPolicies,
    STORAGE_KEYS.ebayPaymentPolicyId,
    (item) => /standard zahlung elyon/i.test(clean(item.name))
  );
  const returnId = populatePolicySelect(
    'ebayReturnPolicy',
    data.returnPolicies,
    STORAGE_KEYS.ebayReturnPolicyId,
    (item) => /rücknahmebedingungen/i.test(clean(item.name)) && /14 tage/i.test(clean(item.name))
  );
  const locationKey = populatePolicySelect(
    'ebayMerchantLocation',
    data.locations,
    STORAGE_KEYS.ebayMerchantLocationKey,
    null,
    'merchantLocationKey',
    (item) => [item.name || item.merchantLocationKey, item.city, item.postalCode, item.country].filter(Boolean).join(' · ')
  );

  const note = $('ebayPolicyNote');
  if (note) {
    note.textContent = fulfillmentId && paymentId && returnId && locationKey
      ? 'eBay-Standardwerte für diesen Amazon Standalone Importer gespeichert. Es wird dadurch nichts bei eBay geändert.'
      : 'Bitte alle benötigten eBay-Standardwerte auswählen. Die Auswahl wird nur im Amazon Standalone Importer gespeichert.';
  }
}

function effectiveEbayDraftReady(data) {
  if (!data?.connected) return false;
  const policies = selectedEbayPolicies();
  return Boolean(
    policies.fulfillmentPolicyId &&
    policies.paymentPolicyId &&
    policies.returnPolicyId &&
    policies.merchantLocationKey
  );
}

function manualEbayImages() {
  return String($('ebayImageUrls')?.value || '')
    .split(/\n/)
    .map((value) => clean(value))
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 12);
}

function manualEbayItemSpecifics() {
  const raw = clean($('ebayItemSpecifics')?.value || '');
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Artikelmerkmale müssen ein JSON-Objekt sein.');
  const output = {};
  for (const [name, rawValues] of Object.entries(parsed)) {
    const key = clean(name);
    const values = (Array.isArray(rawValues) ? rawValues : [rawValues]).map((value) => clean(value)).filter(Boolean);
    if (key && values.length) output[key] = values;
  }
  return output;
}

function draftPayload() {
  const policies = selectedEbayPolicies();
  const asin = clean($('asin').value);
  const linkedDraft = state.ebayDraft && state.ebayDraft.asin === asin ? state.ebayDraft : null;
  return {
    source: 'elyon-amazon-standalone-importer',
    sourceProductId: asin ? `amazon:${asin}` : '',
    title: clean($('title').value),
    description: $('description').value || '',
    price: Number($('sellPrice').value) || 0,
    shipping: 0,
    // Nur manuell geprüfte/eingetragene Bild-URLs werden an eBay übertragen.
    images: manualEbayImages(),
    itemSpecifics: manualEbayItemSpecifics(),
    // Amazon-Quell-URL bleibt im Standalone-Importer.
    sourceUrl: '',
    categoryId: clean($('ebayCategoryId')?.value || ''),
    categoryName: clean(state.ebaySelectedCategory?.categoryName || ''),
    conditionEnum: clean($('ebayCondition')?.value || ''),
    quantity: 1,
    sku: linkedDraft?.sku || (asin ? `AMZ-${asin}` : ''),
    offerId: linkedDraft?.offerId || '',
    fulfillmentPolicyId: policies.fulfillmentPolicyId,
    paymentPolicyId: policies.paymentPolicyId,
    returnPolicyId: policies.returnPolicyId,
    merchantLocationKey: policies.merchantLocationKey,
    manufacturer: contactFromFields('manufacturer'),
    responsiblePerson: contactFromFields('responsible'),
    notes: 'Erstellt im Elyon Amazon Standalone Importer mit automatischem Listing Designer.'
  };
}

function companyOsPayload() {
  return {
    product: {
      title: clean($('title').value || state.product?.title),
      description: $('description').value || state.product?.description || '',
      source: 'amazon',
      sourceLabel: 'Amazon',
      sourceRole: 'retail_research_source',
      sourceUrl: state.product?.url || '',
      rawPrice: Number($('buyPrice').value) || parsePrice(state.product?.price),
      salePrice: Number($('sellPrice').value) || 0,
      images: getProductImages(),
      variants: Array.isArray(state.product?.variants) ? state.product.variants : [],
      brand: $('brand').value || '',
      department: $('department').value || '',
      style: $('style').value || '',
      material: $('material').value || '',
      modelNumber: $('modelNumber').value || '',
      itemSpecifics: (() => { try { return manualEbayItemSpecifics(); } catch { return {}; } })(),
      ebayCategoryId: clean($('ebayCategoryId').value || ''),
      category: clean(state.ebaySelectedCategory?.categoryName || ''),
      riskNotes: 'Amazon ist hier Retail-/Recherchequelle. Inhalte und Bilder nicht automatisch für eBay übernehmen. Produkt noch nicht geprüft.',
      importedAt: new Date().toISOString(),
      meta: {
        asin: $('asin').value || '',
        importSource: 'elyon_amazon_importer_extension',
        sourceType: 'retail_research',
        contentUsage: 'source_material_only',
        importerVersion: '1.1.9',
        automaticListingDesigner: true
      }
    }
  };
}

function safeDraftPayload() {
  try {
    return { data: draftPayload(), error: '' };
  } catch (error) {
    return { data: null, error: error?.message || 'eBay-Daten konnten nicht gelesen werden.' };
  }
}


function resetCategorySuggestions(message = 'Titel laden und „Suchen“ drücken. Die Auswahl nutzt die eBay Taxonomy für EBAY_DE.') {
  state.ebayCategories = [];
  state.ebaySelectedCategory = null;
  state.ebayCategoryMetadata = null;
  const select = $('ebayCategorySuggestions');
  if (select) {
    select.innerHTML = '<option value="">Noch nicht gesucht</option>';
    select.disabled = true;
  }
  const apply = $('applyEbayCategory');
  if (apply) apply.disabled = true;
  const note = $('ebayCategoryNote');
  if (note) note.textContent = message;
}

function categoryLabel(category) {
  const name = clean(category?.categoryName || '');
  const breadcrumb = clean(category?.breadcrumb || '');
  const id = clean(category?.categoryId || '');
  return `${breadcrumb || name} · ID ${id}`;
}

function populateCategorySuggestions(categories) {
  const select = $('ebayCategorySuggestions');
  const apply = $('applyEbayCategory');
  const list = Array.isArray(categories) ? categories.filter((entry) => /^\d+$/.test(clean(entry?.categoryId)) && clean(entry?.categoryName)) : [];
  state.ebayCategories = list;
  state.ebaySelectedCategory = null;
  state.ebayCategoryMetadata = null;
  select.innerHTML = '';

  if (!list.length) {
    select.appendChild(new Option('Keine passende Kategorie gefunden', ''));
    select.disabled = true;
    apply.disabled = true;
    $('ebayCategoryNote').textContent = 'eBay hat keine Kategorie vorgeschlagen. Suchbegriff anpassen oder Kategorie-ID manuell eintragen.';
    return;
  }

  list.forEach((category) => {
    const option = new Option(categoryLabel(category), category.categoryId);
    option.dataset.categoryName = category.categoryName || '';
    option.dataset.breadcrumb = category.breadcrumb || '';
    select.appendChild(option);
  });
  select.disabled = false;
  select.selectedIndex = 0;
  apply.disabled = false;
  const first = list[0];
  $('ebayCategoryNote').textContent = `eBay-Vorschlag: ${first.breadcrumb || first.categoryName} · ID ${first.categoryId}. Bitte prüfen und „Übernehmen“ drücken.`;
}

async function standaloneCategoryPost(requestData) {
  const response = await fetch(AMAZON_STANDALONE_EBAY_CATEGORY_URL, {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestData)
  });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}

async function sellerProtectedPost(path, requestData) {
  const tab = await getSellerToolTab();
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: 'MAIN',
    func: async (targetPath, payload) => {
      try {
        const response = await fetch(targetPath, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const body = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, body };
      } catch (error) {
        return { ok: false, status: 0, body: { error: error?.message || 'Seller Tool Anfrage fehlgeschlagen.' } };
      }
    },
    args: [path, requestData]
  });
  if (!result) throw new Error('Seller Tool hat keine Antwort geliefert.');
  if (result.status === 403) {
    openTab(SELLER_TOOL_URL);
    throw new Error('Seller-Tool-Sitzung fehlt oder ist abgelaufen. Seller Tool wurde geöffnet; dort einmal anmelden und danach erneut versuchen.');
  }
  return result;
}

async function searchEbayCategories(options = {}) {
  const automatic = Boolean(options.automatic);
  const silent = Boolean(options.silent);
  const query = clean($('ebayCategoryQuery')?.value || $('title')?.value || '');
  if (query.length < 2) {
    if (!silent) setStatus('Bitte einen Produkttitel oder Suchbegriff für die eBay-Kategorie eingeben.', 'err');
    return [];
  }

  $('searchEbayCategory').disabled = true;
  $('ebayCategoryNote').textContent = 'eBay-Kategorien werden gesucht ...';
  if (!silent) setStatus('eBay-Kategorie wird über die Taxonomy API gesucht ...', 'warn');
  try {
    const response = await standaloneCategoryPost({ action: 'search', query, limit: 12 });
    const result = response.body || {};
    if (!response.ok || !result.ok) {
      resetCategorySuggestions(result.message || result.error || 'eBay-Kategoriesuche fehlgeschlagen.');
      if (!silent) setStatus(result.message || result.error || 'eBay-Kategoriesuche fehlgeschlagen.', 'err');
      return [];
    }
    populateCategorySuggestions(result.categories || []);
    if (automatic && state.ebayCategories.length) {
      $('ebayCategorySuggestions').value = state.ebayCategories[0].categoryId;
      await applySelectedEbayCategory({ automatic: true, silent: true });
    }
    if (!silent) {
      setStatus(automatic && state.ebaySelectedCategory
        ? `eBay-Kategorie automatisch vorbereitet: ${state.ebaySelectedCategory.categoryName}. Bitte vor Veröffentlichung prüfen.`
        : `${result.count || 0} eBay-Kategorie-Vorschläge geladen. Bitte passende Kategorie prüfen und übernehmen.`, result.count ? 'ok' : 'warn');
    }
    return state.ebayCategories;
  } catch (error) {
    resetCategorySuggestions(error.message || 'eBay-Kategoriesuche fehlgeschlagen.');
    if (!silent) setStatus(error.message || 'eBay-Kategoriesuche fehlgeschlagen.', 'err');
    return [];
  } finally {
    $('searchEbayCategory').disabled = false;
  }
}

function selectedCategorySuggestion() {
  const id = clean($('ebayCategorySuggestions')?.value || '');
  return state.ebayCategories.find((entry) => String(entry.categoryId) === id) || null;
}

function mergeKnownBrandIntoSpecifics(required = []) {
  const brand = clean($('brand')?.value || '');
  if (!brand || !Array.isArray(required) || !required.some((name) => /^(marke|brand)$/i.test(clean(name)))) return;
  try {
    const current = manualEbayItemSpecifics();
    if (!current.Marke && !current.Brand) {
      current.Marke = [brand];
      $('ebayItemSpecifics').value = JSON.stringify(current, null, 2);
    }
  } catch {}
}

async function applySelectedEbayCategory(options = {}) {
  const automatic = Boolean(options.automatic);
  const silent = Boolean(options.silent);
  const selected = selectedCategorySuggestion();
  if (!selected) {
    if (!silent) setStatus('Bitte zuerst eine vorgeschlagene eBay-Kategorie auswählen.', 'err');
    return null;
  }

  state.ebaySelectedCategory = selected;
  $('ebayCategoryId').value = selected.categoryId;
  $('ebayCategoryNote').textContent = `${automatic ? 'Automatisch vorgeschlagen' : 'Kategorie übernommen'}: ${selected.breadcrumb || selected.categoryName} · ID ${selected.categoryId}. Pflichtmerkmale werden geprüft ...`;
  if (!silent) setStatus(`eBay-Kategorie „${selected.categoryName}“ übernommen.`, 'ok');

  try {
    const response = await standaloneCategoryPost({ action: 'inspect', categoryId: selected.categoryId });
    const result = response.body || {};
    if (!response.ok || !result.ok) {
      $('ebayCategoryNote').textContent = `${automatic ? 'Automatisch vorgeschlagen' : 'Kategorie übernommen'}: ${selected.breadcrumb || selected.categoryName} · ID ${selected.categoryId}. Pflichtmerkmale konnten nicht geladen werden.`;
      renderDesignerReadiness();
      return selected;
    }
    state.ebayCategoryMetadata = result.categoryMetadata || null;
    const required = Array.isArray(result.categoryMetadata?.required) ? result.categoryMetadata.required : [];
    mergeDesignerFactsIntoSpecifics(result.categoryMetadata || null);
    const missing = missingRequiredAspects();
    $('ebayCategoryNote').textContent = required.length
      ? `${automatic ? 'Automatisch vorgeschlagen' : 'Kategorie übernommen'}: ${selected.breadcrumb || selected.categoryName} · ID ${selected.categoryId}. Pflichtmerkmale: ${required.join(', ')}${missing.length ? ` · offen: ${missing.join(', ')}` : ' · automatisch befüllt, soweit Quelldaten vorhanden'}.`
      : `${automatic ? 'Automatisch vorgeschlagen' : 'Kategorie übernommen'}: ${selected.breadcrumb || selected.categoryName} · ID ${selected.categoryId}. Keine zusätzlichen Pflichtmerkmale gemeldet.`;
    renderDesignerReadiness();
    return selected;
  } catch (error) {
    $('ebayCategoryNote').textContent = `${automatic ? 'Automatisch vorgeschlagen' : 'Kategorie übernommen'}: ${selected.breadcrumb || selected.categoryName} · ID ${selected.categoryId}. ${error.message || 'Pflichtmerkmale konnten nicht geprüft werden.'}`;
    renderDesignerReadiness();
    return selected;
  }
}

function validateDraftInput(data) {
  if (!data.title) return 'Titel fehlt.';
  if (!data.price || data.price <= 0) return 'Preis fehlt.';
  if (!data.categoryId || !/^\d{2,12}$/.test(data.categoryId)) return 'Bitte eine eBay-Kategorie suchen und übernehmen oder eine gültige numerische Kategorie-ID eintragen.';
  if (!data.conditionEnum) return 'Bitte den eBay-Artikelzustand bewusst auswählen.';
  if (!Array.isArray(data.images) || !data.images.length) return 'Mindestens eine geprüfte HTTPS-Bild-URL für eBay fehlt.';
  if (data.images.some((url) => !/^https:\/\//i.test(url))) return 'eBay-Bild-URLs müssen mit https:// beginnen.';
  if (!data.itemSpecifics || !Object.keys(data.itemSpecifics).length) return 'eBay-Artikelmerkmale fehlen. Bitte mindestens ein Merkmal als JSON eintragen.';
  const requiredMissing = missingRequiredAspects();
  if (requiredMissing.length) return `eBay-Pflichtmerkmale fehlen noch: ${requiredMissing.join(', ')}.`;
  if (!$('contentRightsConfirmed').checked) {
    return 'Bitte zuerst bestätigen, dass du die Listing-Inhalte geprüft hast und nur nutzbare Inhalte verwendest.';
  }
  return '';
}

function validateCompanyInput(data) {
  if (!state.product) return 'Erst Produkt importieren.';
  if (!data.product.title) return 'Titel fehlt.';
  if (!data.product.sourceUrl) return 'Amazon-Produktlink fehlt.';
  return '';
}

function describeEbaySetup(data) {
  if (!data) return '';
  const policies = selectedEbayPolicies();
  const missing = [];
  if (!policies.fulfillmentPolicyId) missing.push('Versandrichtlinie');
  if (!policies.paymentPolicyId) missing.push('Zahlungsrichtlinie');
  if (!policies.returnPolicyId) missing.push('Rücknahmerichtlinie');
  if (!policies.merchantLocationKey) missing.push('Inventory-Standort');
  if (!missing.length) return 'eBay verbunden ✅ · Richtlinien und Standort sind für Entwürfe ausgewählt.';
  return `eBay verbunden, Entwurf noch nicht bereit. Fehlt/Auswahl offen: ${missing.join(', ')}`;
}

async function checkEbayStatus(options = {}) {
  const silent = Boolean(options.silent);
  setEbayUi('checking');
  if (!silent) setStatus('eBay Entwurfsstatus wird geprüft ...', 'warn');

  try {
    const response = await fetch(EBAY_SETUP_INFO_URL, { method: 'GET', credentials: 'omit', cache: 'no-store' });
    const data = await response.json().catch(() => ({}));
    state.ebaySetup = data;
    updateEbayPolicySettings(data);
    renderDesignerReadiness();
    const locallyReady = effectiveEbayDraftReady(data);

    if (response.ok && data?.connected === true && locallyReady) {
      setEbayUi('ready');
      if (!silent) setStatus('eBay verbunden ✅ · Unveröffentlichte Entwürfe sind technisch bereit.', 'ok');
      return data;
    }

    if (data?.connected === true) {
      setEbayUi('connected_not_ready');
      if (!silent) setStatus(describeEbaySetup(data), 'warn');
      return data;
    }

    if (response.status === 401 || data?.connected === false) {
      setEbayUi('disconnected');
      if (!silent) setStatus(data?.error || 'eBay nicht verbunden. Bitte neu verbinden.', 'warn');
      return data;
    }

    setEbayUi('error');
    if (!silent) setStatus(data?.error || `Fehler bei eBay-Prüfung (HTTP ${response.status}).`, 'err');
    return data;
  } catch (error) {
    state.ebaySetup = null;
    setEbayUi('error');
    if (!silent) setStatus(`Fehler bei eBay-Prüfung: ${error.message}`, 'err');
    return null;
  }
}

function waitForTabComplete(tabId, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(new Error('Seller Tool konnte nicht rechtzeitig geladen werden.')), timeoutMs);
    const onUpdated = (updatedId, info) => {
      if (updatedId === tabId && info.status === 'complete') finish();
    };
    function finish(error = null) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      error ? reject(error) : resolve();
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then((tab) => {
      if (tab?.status === 'complete') finish();
    }).catch(() => {});
  });
}

async function getSellerToolTab() {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) {
    throw new Error('Seller-Tool-Sitzungsbrücke ist nur in der installierten Chrome-Erweiterung verfügbar.');
  }
  const tabs = await chrome.tabs.query({ url: ['https://elyonsellertool.vercel.app/*', 'https://elyon-seller-tool.vercel.app/*'] });
  let tab = tabs.find((item) => item.status === 'complete') || tabs[0] || null;
  if (!tab) {
    tab = await chrome.tabs.create({ url: SELLER_TOOL_URL, active: false });
  }
  if (tab.status !== 'complete') await waitForTabComplete(tab.id);
  return tab;
}

async function sellerLifecycleAction(action, requestData) {
  return sellerProtectedPost(`${SELLER_EBAY_LIFECYCLE_PATH}${encodeURIComponent(action)}`, requestData);
}

async function createEbayDraft(options = {}) {
  const builtDraft = safeDraftPayload();
  if (builtDraft.error) { setStatus(builtDraft.error, 'err'); return null; }
  const data = builtDraft.data;
  const validationError = validateDraftInput(data);
  if (validationError) {
    $('payloadPreview').value = JSON.stringify(data, null, 2);
    setStatus(validationError, 'err');
    return null;
  }

  const setup = await checkEbayStatus({ silent: true });
  if (!effectiveEbayDraftReady(setup)) {
    setStatus(describeEbaySetup(setup) || 'eBay ist für Entwürfe noch nicht vollständig eingerichtet.', 'warn');
    return null;
  }

  const rebuiltDraft = safeDraftPayload();
  if (rebuiltDraft.error) { setStatus(rebuiltDraft.error, 'err'); return null; }
  const requestData = rebuiltDraft.data;
  const selected = selectedEbayPolicies();
  if (!selected.fulfillmentPolicyId || !selected.paymentPolicyId || !selected.returnPolicyId || !selected.merchantLocationKey) {
    setStatus('Bitte in Einstellungen → eBay Versand-, Zahlungs-, Rücknahmerichtlinie und Inventory-Standort auswählen.', 'warn');
    return null;
  }
  $('payloadPreview').value = JSON.stringify(requestData, null, 2);
  setStatus(options.forPublish ? 'eBay-Entwurf wird für die Veröffentlichung vorbereitet ...' : 'eBay-Entwurf wird erstellt und im Seller Tool registriert ...', 'warn');

  try {
    const response = await sellerLifecycleAction('create-draft', requestData);
    const result = response.body || {};
    $('payloadPreview').value = JSON.stringify({ request: requestData, response: result }, null, 2);

    if (!response.ok || !result.ok) {
      setStatus(result.message || result.error || 'eBay-Entwurf konnte nicht erstellt werden.', 'err');
      return null;
    }

    state.ebayDraft = {
      asin: clean($('asin').value),
      offerId: clean(result.offerId),
      sku: clean(result.sku)
    };

    if (!options.forPublish) {
      setStatus(`eBay-Entwurf erstellt ✅\nIm Seller Tool als Elyon-Entwurf registriert.\nNicht veröffentlicht.`, 'ok');
    }
    return result;
  } catch (error) {
    setStatus(`eBay-Entwurf konnte nicht erstellt werden. ${error.message || ''}`.trim(), 'err');
    return null;
  }
}

async function publishEbayNow() {
  if (!directPublishEnabled()) {
    openSettingsBlock('ebaySettingsBlock');
    setStatus('Sofort-Veröffentlichung ist deaktiviert. Aktiviere sie bewusst in Einstellungen → eBay.', 'warn');
    return;
  }

  if (!$('fulfillmentModelConfirmed')?.checked) {
    setStatus('Bitte vor der Veröffentlichung bestätigen, dass Beschaffung und Versandmodell geprüft sind und kein unzulässiger Retail-Direktversand an den eBay-Käufer vorgesehen ist.', 'err');
    return;
  }

  const builtDraft = safeDraftPayload();
  if (builtDraft.error) { setStatus(builtDraft.error, 'err'); return; }
  const draftData = builtDraft.data;
  const validationError = validateDraftInput(draftData);
  if (validationError) {
    setStatus(validationError, 'err');
    return;
  }

  const confirmed = window.confirm(
    `WIRKLICH BEI eBay VERÖFFENTLICHEN?\n\n${draftData.title}\n${money(draftData.price)}\n\nDas Angebot wird nach der Prüfung live bei eBay veröffentlicht.`
  );
  if (!confirmed) {
    setStatus('Veröffentlichung abgebrochen. Es wurde nichts veröffentlicht.', 'warn');
    return;
  }

  const draftResult = await createEbayDraft({ forPublish: true });
  if (!draftResult?.offerId) return;

  const currentDraft = safeDraftPayload().data || draftData;
  const publishPayload = {
    ...currentDraft,
    offerId: draftResult.offerId,
    sku: draftResult.sku || currentDraft.sku,
    confirmation: 'PUBLISH_EBAY_OFFER'
  };
  $('payloadPreview').value = JSON.stringify(publishPayload, null, 2);
  setStatus('eBay-Angebot wird jetzt veröffentlicht ...', 'warn');

  try {
    const response = await sellerLifecycleAction('publish', publishPayload);
    const result = response.body || {};
    $('payloadPreview').value = JSON.stringify({ request: publishPayload, response: result }, null, 2);
    if (!response.ok || !result.ok || result.published !== true) {
      setStatus(result.message || result.error || 'Veröffentlichung wurde von eBay/Seller Tool abgelehnt. Der Entwurf bleibt erhalten.', 'err');
      return;
    }
    state.ebayDraft = null;
    setStatus(`eBay-Angebot veröffentlicht ✅\nListing-ID: ${result.listingId || 'vorhanden'}\nEs wird im Seller Tool über den eBay-Abgleich unter Aktive Listings sichtbar.`, 'ok');
  } catch (error) {
    setStatus(`Veröffentlichung fehlgeschlagen. Der vorbereitete eBay-Entwurf bleibt erhalten. ${error.message || ''}`.trim(), 'err');
  }
}

async function sendToCompanyOs() {
  const data = companyOsPayload();
  const validationError = validateCompanyInput(data);
  if (validationError) {
    setStatus(validationError, 'err');
    return;
  }

  $('payloadPreview').value = JSON.stringify(data, null, 2);
  await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  setCompanyUi('connected', 'Status: Company OS Payload lokal vorbereitet');
  setStatus('Company-OS-Payload kopiert ✅\nKein Sync-Code oder anderes Geheimnis wird im Amazon Standalone Importer gespeichert.', 'ok');
}

async function copy(text) {
  await navigator.clipboard.writeText(text);
  setStatus('In die Zwischenablage kopiert.', 'ok');
}

function openTab(url) {
  if (globalThis.chrome?.tabs) chrome.tabs.create({ url });
  else window.open(url, '_blank', 'noopener,noreferrer');
}

async function checkCompanyStatus() {
  setCompanyUi('checking');
  setStatus('Company OS wird geprüft ...', 'warn');
  try {
    const response = await fetch(COMPANY_OS_IMPORT_URL, { method: 'GET', credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();

    if (data?.ok === true && data?.storage?.configured === true) {
      setCompanyUi('connected', 'Status: Route erreichbar · Standalone übergibt nur lokal vorbereitete Daten');
      setStatus('Company OS ist erreichbar. Aus Sicherheitsgründen speichert der Amazon Standalone Importer keinen Sync-Code.', 'ok');
      return;
    }

    setCompanyUi('disconnected', 'Status: Company OS Speicher nicht bereit');
    setStatus('Company OS ist erreichbar, aber der serverseitige Speicher ist nicht bereit.', 'warn');
  } catch (error) {
    setCompanyUi('error');
    setStatus(`Fehler bei Company-OS-Prüfung: ${error.message}`, 'err');
  }
}

function openSettingsBlock(blockId) {
  $('settings').classList.add('open');
  setTimeout(() => $(blockId)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function connectEbay() {
  setStatus('eBay-Verbindung wird in einem neuen Tab geöffnet.', 'warn');
  openTab(EBAY_CONNECT_URL);
}

function initEvents() {
  $('loadProduct').addEventListener('click', async () => {
    try {
      setStatus('Import läuft...', 'warn');
      const product = await getCurrentProduct();
      fill(product);
      if (autoDesignerEnabled()) {
        await runAutomaticListingDesigner();
      } else {
        setStatus('Produkt importiert. Automatischer Listing Designer ist in den Einstellungen deaktiviert.', 'ok');
        renderDesignerReadiness();
      }
    } catch (error) {
      setMiniStatus('amazonStatusMini', 'error');
      setStatus(error.message, 'err');
    }
  });

  $('connectEbay').addEventListener('click', connectEbay);
  $('connectEbaySettings').addEventListener('click', connectEbay);
  $('checkEbayStatus').addEventListener('click', () => checkEbayStatus());
  $('checkEbayStatusSettings').addEventListener('click', () => checkEbayStatus());
  $('searchEbayCategory').addEventListener('click', searchEbayCategories);
  $('ebayCategoryQuery').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); searchEbayCategories(); }
  });
  $('ebayCategorySuggestions').addEventListener('change', () => {
    const selected = selectedCategorySuggestion();
    $('applyEbayCategory').disabled = !selected;
    if (selected) $('ebayCategoryNote').textContent = `Ausgewählt: ${selected.breadcrumb || selected.categoryName} · ID ${selected.categoryId}. Mit „Übernehmen“ bestätigen.`;
  });
  $('applyEbayCategory').addEventListener('click', applySelectedEbayCategory);
  $('ebayCategoryId').addEventListener('input', () => {
    const id = clean($('ebayCategoryId').value);
    if (state.ebaySelectedCategory && id !== String(state.ebaySelectedCategory.categoryId)) {
      state.ebaySelectedCategory = null;
      state.ebayCategoryMetadata = null;
      $('ebayCategoryNote').textContent = 'Kategorie-ID wurde manuell geändert. Die eBay-Auswahl ist damit nicht mehr bestätigt.';
    }
    renderDesignerReadiness();
  });
  const bindEbaySelect = (elementId, storageKey) => {
    $(elementId).addEventListener('change', () => {
      const value = clean($(elementId).value);
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
      if (state.ebaySetup) {
        setEbayUi(effectiveEbayDraftReady(state.ebaySetup) ? 'ready' : 'connected_not_ready');
        setStatus(describeEbaySetup(state.ebaySetup), effectiveEbayDraftReady(state.ebaySetup) ? 'ok' : 'warn');
      }
      renderDesignerReadiness();
    });
  };
  bindEbaySelect('ebayFulfillmentPolicy', STORAGE_KEYS.ebayFulfillmentPolicyId);
  bindEbaySelect('ebayPaymentPolicy', STORAGE_KEYS.ebayPaymentPolicyId);
  bindEbaySelect('ebayReturnPolicy', STORAGE_KEYS.ebayReturnPolicyId);
  bindEbaySelect('ebayMerchantLocation', STORAGE_KEYS.ebayMerchantLocationKey);
  $('enableDirectPublish').addEventListener('change', () => {
    const enabled = $('enableDirectPublish').checked;
    localStorage.setItem(STORAGE_KEYS.ebayDirectPublishEnabled, enabled ? '1' : '0');
    setPublishButtonsEnabled(state.ebayStatus === 'ready' && enabled);
    setStatus(enabled
      ? 'Sofort-Veröffentlichung aktiviert. Vor jeder Veröffentlichung kommt zusätzlich eine Bestätigung.'
      : 'Sofort-Veröffentlichung deaktiviert. eBay-Entwürfe bleiben weiterhin möglich.', enabled ? 'warn' : 'ok');
  });

  $('enableAutoDesigner').addEventListener('change', () => {
    const enabled = $('enableAutoDesigner').checked;
    localStorage.setItem(STORAGE_KEYS.autoDesignerEnabled, enabled ? '1' : '0');
    setStatus(enabled
      ? 'Automatischer Listing Designer aktiviert. Beim nächsten Amazon-Import läuft die Vorbereitung automatisch.'
      : 'Automatischer Listing Designer deaktiviert. Du kannst ihn weiterhin manuell über „Designer erneut“ starten.', 'ok');
  });

  $('checkCompanyStatus').addEventListener('click', checkCompanyStatus);
  $('checkCompanyStatusSettings').addEventListener('click', checkCompanyStatus);
  $('sendCompanyOs').addEventListener('click', sendToCompanyOs);
  $('sendCompanyOsMain').addEventListener('click', sendToCompanyOs);
  $('sendCompanyOsBottom').addEventListener('click', sendToCompanyOs);
  $('prepareDraftMain').addEventListener('click', createEbayDraft);
  $('prepareDraft').addEventListener('click', createEbayDraft);
  $('prepareDraftEbay').addEventListener('click', createEbayDraft);
  $('publishEbay').addEventListener('click', publishEbayNow);

  $('openCompanyOs').addEventListener('click', () => openTab(COMPANY_OS_OPEN_URL));
  $('openCompanyOsSettings').addEventListener('click', () => openTab(COMPANY_OS_OPEN_URL));
  $('openSellerTool').addEventListener('click', () => openTab(SELLER_TOOL_URL));


  $('sellPrice').addEventListener('input', calc);
  $('buyPrice').addEventListener('input', calc);

  const rerunDesigner = () => {
    if (!state.product) return setStatus('Erst Produkt importieren.', 'err');
    runAutomaticListingDesigner();
  };
  $('localOptimize').addEventListener('click', rerunDesigner);
  $('rerunDesigner').addEventListener('click', rerunDesigner);

  $('openEbay').addEventListener('click', () => openTab('https://www.ebay.de/sl/sell'));
  $('copyOpenEbay').addEventListener('click', async () => {
    await copy(listingText());
    openTab('https://www.ebay.de/sl/sell');
  });
  $('copyListing').addEventListener('click', () => copy(listingText()));

  ['title','description','brand','department','style','material','modelNumber','sellPrice','ebayImageUrls','ebayItemSpecifics','ebayCondition','contentRightsConfirmed','manufacturerName','manufacturerAddress','manufacturerCity','manufacturerPostalCode','manufacturerCountry','responsibleName','responsibleAddress','responsibleCity','responsiblePostalCode','responsibleCountry'].forEach((id) => {
    const element = $(id);
    if (!element) return;
    element.addEventListener(element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input', renderDesignerReadiness);
  });

  $('openSettings').addEventListener('click', () => $('settings').classList.add('open'));
  $('closeSettings').addEventListener('click', () => $('settings').classList.remove('open'));

  $('amazonStatusMini').addEventListener('click', () => $('loadProduct').click());
  $('companyStatusMini').addEventListener('click', () => openSettingsBlock('companySettingsBlock'));
  $('ebayStatusMini').addEventListener('click', () => openSettingsBlock('ebaySettingsBlock'));

  $('copyEbayUrls').addEventListener('click', () => copy(`Connect URL:\n${EBAY_CONNECT_URL}\n\nVerbindungsstatus:\n${EBAY_CONNECTION_STATUS_URL}\n\nEntwurfsstatus / Setup:\n${EBAY_SETUP_INFO_URL}\n\nLegacy Draft API:\n${EBAY_CREATE_DRAFT_URL}\n\nSeller Lifecycle (Aktionen nur über angemeldete Seller-Tool-Sitzung):\n${SELLER_TOOL_URL}api/ebay/index?action=create-draft\n\neBay Kategorien (Standalone, read-only):\n${AMAZON_STANDALONE_EBAY_CATEGORY_URL}`));
  $('copyIntegrationUrls').addEventListener('click', () => copy(`Company OS:\n${COMPANY_OS_URL}\n\nCompany OS Import API:\n${COMPANY_OS_IMPORT_URL}\n\neBay Auth:\n${EBAY_CONNECT_URL}\n\neBay Verbindungsstatus:\n${EBAY_CONNECTION_STATUS_URL}\n\neBay Entwurfsstatus:\n${EBAY_SETUP_INFO_URL}\n\neBay Legacy Draft:\n${EBAY_CREATE_DRAFT_URL}\n\nSeller Lifecycle:\n${SELLER_TOOL_URL}api/ebay/index?action=create-draft\n\neBay Kategorien (Standalone):\n${AMAZON_STANDALONE_EBAY_CATEGORY_URL}`));
  $('copyJson').addEventListener('click', () => copy(JSON.stringify(payload(), null, 2)));
  $('showPayload').addEventListener('click', () => { $('payloadPreview').value = JSON.stringify(payload(), null, 2); });
}

function init() {
  $('companyOsUrl').value = COMPANY_OS_URL;
  $('companyImportUrl').value = COMPANY_OS_IMPORT_URL;
  $('sellerToolUrl').value = SELLER_TOOL_URL;
  $('ebayConnectUrl').value = EBAY_CONNECT_URL;
  $('ebayStatusUrl').value = EBAY_SETUP_INFO_URL;
  $('enableDirectPublish').checked = directPublishEnabled();
  $('enableAutoDesigner').checked = autoDesignerEnabled();

  // V1.1.9 behält die v1.1.4-Sicherheitsbereinigung für alte DeepSeek-Keys bei.
  localStorage.removeItem(LEGACY_DEEPSEEK_KEY);
  localStorage.removeItem(LEGACY_COMPANY_SYNC_CODE);

  setMiniStatus('amazonStatusMini', 'not_checked');
  setEbayUi('not_checked');
  setCompanyUi('not_checked');
  initEvents();
  checkEbayStatus({ silent: true });
}

document.addEventListener('DOMContentLoaded', init);
