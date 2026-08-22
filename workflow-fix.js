(() => {
  'use strict';

  const originalGetCurrentProduct = getCurrentProduct;
  const originalFill = fill;
  const originalMergeDesignerFactsIntoSpecifics = mergeDesignerFactsIntoSpecifics;
  const originalSellerLifecycleAction = sellerLifecycleAction;

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

  function parseAmazonPriceText(value) {
    let raw = String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[^0-9,.-]/g, '')
      .trim();
    if (!raw) return 0;

    raw = raw.replace(/(?!^)-/g, '');
    const comma = raw.lastIndexOf(',');
    const dot = raw.lastIndexOf('.');

    if (comma >= 0 && dot >= 0) {
      if (comma > dot) raw = raw.replace(/\./g, '').replace(',', '.');
      else raw = raw.replace(/,/g, '');
    } else if (comma >= 0) {
      const decimals = raw.length - comma - 1;
      raw = decimals > 0 && decimals <= 2 ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
    } else if (dot >= 0) {
      const decimals = raw.length - dot - 1;
      if (!(decimals > 0 && decimals <= 2)) raw = raw.replace(/\./g, '');
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function suggestedSellPrice(buyPrice) {
    const buy = Number(buyPrice || 0);
    if (!(buy > 0)) return 0;
    const ebayFeeRate = 0.12;
    const fixedFee = 0.35;
    const targetMargin = 0.20;
    const targetProfit = 5;
    const byMargin = (buy + fixedFee) / (1 - ebayFeeRate - targetMargin);
    const byProfit = (buy + fixedFee + targetProfit) / (1 - ebayFeeRate);
    const raw = Math.max(buy, byMargin, byProfit);
    return Math.max(0.99, Math.ceil(raw + 0.01) - 0.01);
  }

  async function extractAmazonCommerceData() {
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return {};
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/amazon\./i.test(tab.url || '')) return {};

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const candidates = [];
        const push = (value, source) => {
          const text = clean(value);
          if (!text || !/\d/.test(text)) return;
          if (!candidates.some((entry) => entry.value === text)) candidates.push({ value: text, source });
        };
        const pushSelector = (selector) => {
          document.querySelectorAll(selector).forEach((node) => push(node.textContent || node.getAttribute?.('content') || node.value, selector));
        };

        [
          '#apex_desktop .priceToPay .a-offscreen',
          '#corePrice_feature_div .priceToPay .a-offscreen',
          '#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen',
          '#corePrice_feature_div .a-price .a-offscreen',
          '#corePriceDisplay_desktop_feature_div .a-price .a-offscreen',
          '#apex_desktop .a-price .a-offscreen',
          '#buybox .a-price .a-offscreen',
          '#price_inside_buybox',
          '#newBuyBoxPrice',
          '#priceblock_ourprice',
          '#priceblock_dealprice',
          '#priceblock_saleprice',
          '.reinventPricePriceToPayMargin .a-offscreen',
          '[data-a-color="price"] .a-offscreen'
        ].forEach(pushSelector);

        push(document.querySelector('meta[itemprop="price"]')?.getAttribute('content'), 'meta[itemprop=price]');
        push(document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content'), 'meta[product:price:amount]');

        document.querySelectorAll('script[type="application/ld+json"]').forEach((node) => {
          try {
            const parsed = JSON.parse(node.textContent || '{}');
            const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
            while (queue.length) {
              const item = queue.shift();
              if (!item || typeof item !== 'object') continue;
              const offers = item.offers;
              if (Array.isArray(offers)) queue.push(...offers);
              else if (offers && typeof offers === 'object') queue.push(offers);
              push(item.price, 'jsonld.price');
              push(item.lowPrice, 'jsonld.lowPrice');
              push(item.highPrice, 'jsonld.highPrice');
              if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
            }
          } catch {
            // Amazon occasionally emits non-JSON snippets; DOM prices still cover the normal case.
          }
        });

        if (!candidates.length) {
          const whole = clean(document.querySelector('.a-price .a-price-whole')?.textContent);
          const fraction = clean(document.querySelector('.a-price .a-price-fraction')?.textContent);
          if (whole) push(`${whole},${fraction || '00'}`, 'whole+fraction');
        }

        const title = clean(document.querySelector('#productTitle')?.textContent || document.title);
        const buyBoxText = clean(document.querySelector('#buybox')?.textContent || document.querySelector('#desktop_buybox')?.textContent || '');
        const hasAddToCart = Boolean(document.querySelector('#add-to-cart-button, #buy-now-button'));
        const usedOrRefurbished = /\b(gebraucht|used|warehouse|erneuert|refurbished|renewed)\b/i.test(`${title} ${buyBoxText}`);
        const conditionEnum = hasAddToCart && !usedOrRefurbished ? 'NEW' : '';

        return { candidates, conditionEnum };
      }
    });

    return result && typeof result === 'object' ? result : {};
  }

  function choosePrice(candidates) {
    for (const entry of Array.isArray(candidates) ? candidates : []) {
      const amount = parseAmazonPriceText(entry?.value);
      if (amount > 0 && amount < 1000000) return { amount, raw: String(entry.value || ''), source: entry.source || '' };
    }
    return { amount: 0, raw: '', source: '' };
  }

  function normalizeSpecificKey(value) {
    return normalizeText(value).replace(/\b(artikel|produkt|angabe|details?)\b/g, '').replace(/\s+/g, ' ').trim();
  }

  function knownDetailValue(aspectName) {
    const product = state.product || {};
    const facts = state.designerFacts || {};
    const wanted = normalizeSpecificKey(aspectName);
    if (!wanted) return '';

    const direct = {
      marke: facts.brand || product.brand,
      brand: facts.brand || product.brand,
      farbe: facts.color,
      color: facts.color,
      material: facts.material,
      stil: facts.style,
      style: facts.style,
      abteilung: facts.department,
      department: facts.department,
      modell: facts.model || facts.mpn,
      herstellernummer: facts.mpn || facts.model,
      mpn: facts.mpn || facts.model,
      produktart: facts.productType || facts.category,
      produkttyp: facts.productType || facts.category,
      ean: facts.ean,
      gtin: facts.ean,
      upc: facts.ean,
      herstellungsland: facts.countryOfOrigin,
      ursprungsland: facts.countryOfOrigin
    };
    if (direct[wanted]) return clean(direct[wanted]);

    const entries = [
      ...Object.entries(product.variations || {}),
      ...Object.entries(product.details || {})
    ].filter(([, value]) => clean(value));

    const exact = entries.find(([key]) => normalizeSpecificKey(key) === wanted);
    if (exact) return clean(exact[1]);

    const fuzzy = entries.find(([key]) => {
      const candidate = normalizeSpecificKey(key);
      return candidate.length >= 4 && wanted.length >= 4 && (candidate.includes(wanted) || wanted.includes(candidate));
    });
    return fuzzy ? clean(fuzzy[1]) : '';
  }

  function fitAllowedValue(value, meta = {}) {
    const textValue = clean(value);
    if (!textValue) return '';
    const allowed = Array.isArray(meta.values) ? meta.values.filter(Boolean) : [];
    if (!allowed.length) return textValue;
    const wanted = normalizeText(textValue);
    const exact = allowed.find((candidate) => normalizeText(candidate) === wanted);
    const loose = allowed.find((candidate) => {
      const normalized = normalizeText(candidate);
      return normalized.includes(wanted) || wanted.includes(normalized);
    });
    if (exact || loose) return exact || loose;
    return /selection/i.test(clean(meta.mode)) ? '' : textValue;
  }

  getCurrentProduct = async function getCurrentProductWithCommerceData() {
    const product = await originalGetCurrentProduct();
    if (!product || typeof product !== 'object') return product;

    let commerce = {};
    try {
      commerce = await extractAmazonCommerceData();
    } catch {
      commerce = {};
    }

    const detected = choosePrice(commerce.candidates);
    const existing = parseAmazonPriceText(product.price);
    const amount = detected.amount || existing;
    if (amount > 0) {
      product.priceValue = amount;
      product.price = detected.raw || product.price || `${amount.toFixed(2)} €`;
      product.priceSource = detected.source || 'existing';
    }
    if (commerce.conditionEnum) product.conditionEnum = commerce.conditionEnum;
    return product;
  };

  fill = function fillWithPriceAndDraftDefaults(product) {
    originalFill(product);

    const amount = Number(product?.priceValue || parseAmazonPriceText(product?.price));
    const buyField = $('buyPrice');
    if (buyField && amount > 0) {
      buyField.value = amount.toFixed(2);
      buyField.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const sellField = $('sellPrice');
    if (sellField && !(Number(sellField.value) > 0) && amount > 0) {
      const suggestion = suggestedSellPrice(amount);
      if (suggestion > 0) {
        sellField.value = suggestion.toFixed(2);
        sellField.dataset.elyonAutoSuggested = '1';
        sellField.dispatchEvent(new Event('input', { bubbles: true }));
        const label = sellField.closest?.('.field')?.querySelector?.('label');
        if (label) label.textContent = 'eBay Verkaufspreis € · Elyon-Vorschlag, bitte prüfen';
      }
    }

    const conditionField = $('ebayCondition');
    if (conditionField && !conditionField.value && product?.conditionEnum === 'NEW') {
      conditionField.value = 'NEW';
      conditionField.dispatchEvent(new Event('change', { bubbles: true }));
    }

    calc();
    renderDesignerReadiness();
  };

  mergeDesignerFactsIntoSpecifics = function mergeDesignerFactsIntoSpecificsWithAmazonDetails(metadata = null) {
    const current = originalMergeDesignerFactsIntoSpecifics(metadata) || {};
    const aspects = Array.isArray(metadata?.aspects) ? metadata.aspects : [];
    const required = Array.isArray(metadata?.required) ? metadata.required : [];
    const names = [...new Set([...required, ...aspects.map((aspect) => aspect?.name).filter(Boolean)])];

    for (const name of names) {
      if (Array.isArray(current[name]) && current[name].length) continue;
      const meta = aspects.find((aspect) => aspect?.name === name) || {};
      const value = fitAllowedValue(knownDetailValue(name), meta);
      if (value) current[name] = [value];
    }

    if ($('ebayItemSpecifics')) {
      $('ebayItemSpecifics').value = Object.keys(current).length ? JSON.stringify(current, null, 2) : '';
      $('ebayItemSpecifics').dispatchEvent(new Event('input', { bubbles: true }));
    }
    return current;
  };

  validateDraftInput = function validateDraftInputWithFullBlockerList(data) {
    const blockers = [];
    if (!data?.title) blockers.push('Titel');
    if (!(Number(data?.price) > 0)) blockers.push('Verkaufspreis');
    if (!/^\d{2,12}$/.test(clean(data?.categoryId || ''))) blockers.push('eBay-Kategorie');
    if (!clean(data?.conditionEnum || '')) blockers.push('Artikelzustand');
    if (!Array.isArray(data?.images) || !data.images.length) blockers.push('mindestens ein geprüftes HTTPS-Bild');
    else if (data.images.some((url) => !/^https:\/\//i.test(url))) blockers.push('nur HTTPS-Bild-URLs');
    if (!data?.itemSpecifics || !Object.keys(data.itemSpecifics).length) blockers.push('Artikelmerkmale');
    const requiredMissing = missingRequiredAspects();
    if (requiredMissing.length) blockers.push(`Pflichtmerkmale: ${requiredMissing.join(', ')}`);
    if (!$('contentRightsConfirmed')?.checked) blockers.push('Inhalts-/Rechteprüfung bestätigen');

    return blockers.length
      ? `eBay-Entwurf noch nicht bereit. Offen: ${blockers.join(' · ')}.`
      : '';
  };

  sellerLifecycleAction = async function sellerLifecycleActionWithDetailedBlockers(action, requestData) {
    const response = await originalSellerLifecycleAction(action, requestData);
    const result = response?.body;
    const blockers = Array.isArray(result?.details?.blockers) ? result.details.blockers.filter(Boolean) : [];
    if (result && blockers.length) {
      const base = clean(result.message || result.error || 'eBay-Aktion blockiert.');
      result.message = `${base} Offen: ${blockers.join(' · ')}`;
    }
    return response;
  };

  const sellField = $('sellPrice');
  if (sellField) {
    sellField.addEventListener('input', (event) => {
      if (event.isTrusted) delete sellField.dataset.elyonAutoSuggested;
    });
  }
})();
