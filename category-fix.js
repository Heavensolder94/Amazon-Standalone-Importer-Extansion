(() => {
  'use strict';

  const originalGetCurrentProduct = getCurrentProduct;
  const originalSearchEbayCategories = searchEbayCategories;

  const STOP_WORDS = new Set([
    'amazon','artikel','produkt','produkte','weiter','einkaufen','kaufen','online','shop','store',
    'fuer','für','mit','ohne','und','oder','von','der','die','das','den','dem','des','eine','einer',
    'eines','ein','zum','zur','bei','auf','aus','neu','original','angebot','angebote'
  ]);

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ß/g, 'ss')
      .toLocaleLowerCase('de-DE')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanAmazonTitle(value) {
    return String(value || '')
      .replace(/^\s*amazon\.[^:]+\s*:\s*/i, '')
      .replace(/\s*:\s*amazon\.[^:]+(?::.*)?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function keywordRoots(value) {
    const roots = new Set();
    for (const token of normalizeText(value).split(' ')) {
      if (!token || token.length < 4 || STOP_WORDS.has(token)) continue;
      roots.add(token.length >= 7 ? token.slice(0, 6) : token);
    }
    return roots;
  }

  function sourceCategoryRoots() {
    const product = state.product || {};
    const facts = state.designerFacts || {};
    const text = [
      product.title,
      Array.isArray(product.breadcrumbs) ? product.breadcrumbs.join(' ') : '',
      facts.productType,
      facts.category,
      facts.brand,
      $('title')?.value
    ].filter(Boolean).join(' ');
    return keywordRoots(text);
  }

  function categoryConfidence(category) {
    const sourceRoots = sourceCategoryRoots();
    const categoryRoots = keywordRoots(`${category?.breadcrumb || ''} ${category?.categoryName || ''}`);
    let overlap = 0;
    for (const root of categoryRoots) if (sourceRoots.has(root)) overlap += 1;

    const sourceText = normalizeText([
      state.product?.title,
      Array.isArray(state.product?.breadcrumbs) ? state.product.breadcrumbs.join(' ') : ''
    ].filter(Boolean).join(' '));
    const categoryText = normalizeText(`${category?.breadcrumb || ''} ${category?.categoryName || ''}`);

    const bookCategory = /\b(buch|bucher|zeitschrift|roman|comic|magazin)\b/.test(categoryText);
    const bookSource = /\b(buch|bucher|zeitschrift|roman|comic|magazin)\b/.test(sourceText);
    if (bookCategory && !bookSource) return -100;

    return overlap;
  }

  async function readAmazonPageIdentity() {
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return {};
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/amazon\./i.test(String(tab.url || ''))) return {};

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const canonical = document.querySelector('link[rel="canonical"]')?.href || '';
        const current = location.href;
        const productTitle = clean(document.querySelector('#productTitle')?.textContent || '');
        const directAsin = [
          document.querySelector('#ASIN')?.value,
          document.querySelector('input[name="ASIN"]')?.value,
          document.querySelector('[data-detail-page-asin]')?.getAttribute('data-detail-page-asin'),
          document.querySelector('#dp[data-asin]')?.getAttribute('data-asin'),
          document.querySelector('#ppd[data-asin]')?.getAttribute('data-asin')
        ].map(clean).find((value) => /^[A-Z0-9]{10}$/i.test(value)) || '';

        const extractFromUrl = (value) => {
          const text = String(value || '');
          const pathMatch = text.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i);
          if (pathMatch?.[1]) return pathMatch[1];
          const queryMatch = text.match(/[?&](?:asin|ASIN)=([A-Z0-9]{10})(?:[&#]|$)/i);
          return queryMatch?.[1] || '';
        };

        return {
          url: current,
          canonical,
          title: productTitle,
          asin: directAsin || extractFromUrl(canonical) || extractFromUrl(current)
        };
      }
    });
    return result && typeof result === 'object' ? result : {};
  }

  getCurrentProduct = async function getValidatedAmazonProduct() {
    const identity = await readAmazonPageIdentity().catch(() => ({}));
    const product = await originalGetCurrentProduct();
    if (!product || typeof product !== 'object') throw new Error('Amazon-Produktdaten konnten nicht gelesen werden.');

    if (!product.asin && identity.asin) product.asin = String(identity.asin).toUpperCase();
    product.title = cleanAmazonTitle(identity.title || product.title);

    const validAsin = /^[A-Z0-9]{10}$/i.test(String(product.asin || '').trim());
    const genericTitle = !product.title || /\bweiter einkaufen\b/i.test(product.title) || /^amazon\./i.test(product.title);

    if (!validAsin || genericTitle) {
      throw new Error('Keine eindeutige Amazon-Produktdetailseite erkannt. Bitte das konkrete Produkt öffnen und erneut importieren.');
    }

    return product;
  };

  searchEbayCategories = async function searchEbayCategoriesWithConfidence(options = {}) {
    if (!options.automatic) return originalSearchEbayCategories(options);

    const categories = await originalSearchEbayCategories({ ...options, automatic: false });
    if (!Array.isArray(categories) || !categories.length) return categories;

    const ranked = categories
      .map((category, index) => ({ category, index, score: categoryConfidence(category) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);

    const best = ranked[0];
    if (!best || best.score <= 0) {
      state.ebaySelectedCategory = null;
      state.ebayCategoryMetadata = null;
      if ($('ebayCategoryId')) $('ebayCategoryId').value = '';
      if ($('ebayCategorySuggestions')) $('ebayCategorySuggestions').value = categories[0]?.categoryId || '';
      if ($('ebayCategoryNote')) {
        $('ebayCategoryNote').textContent = 'eBay-Vorschläge geladen, aber keine Kategorie wurde automatisch übernommen, weil der Treffer nicht eindeutig zum Amazon-Produkt passt. Bitte Suchbegriff oder Auswahl prüfen.';
      }
      return categories;
    }

    if ($('ebayCategorySuggestions')) $('ebayCategorySuggestions').value = best.category.categoryId;
    await applySelectedEbayCategory({ automatic: true, silent: true });
    return categories;
  };
})();
