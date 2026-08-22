(() => {
  'use strict';

  const originalGetCurrentProduct = getCurrentProduct;
  const originalFill = fill;

  function decodeImageText(value) {
    return String(value || '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  function normalizeImageCandidate(value) {
    let text = decodeImageText(value);
    if (!text || /^data:/i.test(text) || /^blob:/i.test(text)) return '';
    if (text.startsWith('//')) text = `https:${text}`;
    if (/^http:\/\//i.test(text)) text = `https://${text.slice(7)}`;

    try {
      const url = new URL(text);
      if (url.protocol !== 'https:') return '';
      url.hash = '';
      if (/amazon\.|media-amazon\./i.test(url.hostname)) {
        url.pathname = url.pathname.replace(/\._[^/]+_\.(?=[^./]+$)/, '.');
      }
      return url.toString();
    } catch {
      return '';
    }
  }

  function normalizeImageList(values) {
    const output = [];
    for (const value of values || []) {
      const normalized = normalizeImageCandidate(value);
      if (normalized && !output.includes(normalized)) output.push(normalized);
      if (output.length >= 12) break;
    }
    return output;
  }

  async function extractHighResAmazonImages() {
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return [];
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/amazon\./i.test(tab.url || '')) return [];

    const [{ result } = {}] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const found = [];
        const push = (value) => {
          const text = String(value || '').trim();
          if (text && !found.includes(text)) found.push(text);
        };
        const addSrcset = (value) => {
          String(value || '').split(',').forEach((entry) => push(entry.trim().split(/\s+/)[0] || ''));
        };
        const addDynamic = (value) => {
          if (!value) return;
          try {
            const parsed = JSON.parse(value);
            Object.keys(parsed || {}).forEach(push);
          } catch {
            // Ignore malformed Amazon image metadata and keep scanning other sources.
          }
        };
        const scanImage = (image) => {
          if (!image) return;
          push(image.getAttribute?.('data-old-hires'));
          push(image.getAttribute?.('data-a-hires'));
          addDynamic(image.getAttribute?.('data-a-dynamic-image'));
          push(image.currentSrc);
          push(image.src);
          push(image.getAttribute?.('src'));
          push(image.getAttribute?.('data-src'));
          push(image.getAttribute?.('data-lazy-src'));
          addSrcset(image.getAttribute?.('srcset'));
        };

        push(document.querySelector('meta[property="og:image"]')?.getAttribute('content'));
        push(document.querySelector('meta[name="twitter:image"]')?.getAttribute('content'));

        document.querySelectorAll([
          '#landingImage',
          '#imgBlkFront',
          '#main-image-container img',
          '.imgTagWrapper img',
          '#altImages img',
          '[data-a-dynamic-image]'
        ].join(',')).forEach(scanImage);

        return found.slice(0, 40);
      }
    });

    return Array.isArray(result) ? result : [];
  }

  getCurrentProduct = async function getCurrentProductWithVerifiedImages() {
    const product = await originalGetCurrentProduct();
    if (!product || typeof product !== 'object') return product;

    let highResImages = [];
    try {
      highResImages = await extractHighResAmazonImages();
    } catch {
      // The original importer result remains usable if Amazon changes its DOM.
    }

    const images = normalizeImageList([
      ...highResImages,
      product.img,
      ...(Array.isArray(product.images) ? product.images : [])
    ]);

    product.images = images;
    product.img = images[0] || normalizeImageCandidate(product.img) || '';
    return product;
  };

  manualEbayImages = function manualEbayImagesWithHttpsNormalization() {
    const values = String($('ebayImageUrls')?.value || '').split(/\r?\n/);
    return normalizeImageList(values);
  };

  fill = function fillWithImageHandoff(product) {
    originalFill(product);

    const images = normalizeImageList([
      product?.img,
      ...(Array.isArray(product?.images) ? product.images : [])
    ]);
    const field = $('ebayImageUrls');
    if (field && !String(field.value || '').trim() && images.length) {
      field.value = images.join('\n');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const mainImage = $('mainImage');
    if (mainImage && images[0]) mainImage.src = images[0];

    const note = [...document.querySelectorAll('#productCard .goldNote')]
      .find((element) => /Amazon-Texte und -Bilder|Amazon-Bilder/i.test(element.textContent || ''));
    if (note) {
      note.textContent = 'Amazon-Bild-URLs werden nach dem Import zur Prüfung vorausgefüllt. Vor dem eBay-Entwurf musst du die Inhalte und Nutzungsrechte weiterhin ausdrücklich bestätigen; ohne Bestätigung wird nichts an eBay gesendet.';
    }
  };
})();
