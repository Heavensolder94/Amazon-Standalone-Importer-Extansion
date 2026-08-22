(() => {
  'use strict';

  const STORAGE_KEY = 'elyon_amazon_importer_batch_queue_v1';
  const CARD_ID = 'elyonBatchCollectorCard';
  let refreshTimer = 0;
  let observerScheduled = false;

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

  function readQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeQueue(queue) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue)); } catch {}
  }

  function scanAmazonImages() {
    const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const asinFromUrl = (href) => {
      const raw = String(href || '');
      return (raw.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i) || [])[1]?.toUpperCase() || '';
    };
    const validUrl = (url) => {
      const value = String(url || '').trim();
      if (!/^https:\/\//i.test(value)) return false;
      if (/transparent|spacer|grey-pixel|blank|loading|sprite/i.test(value)) return false;
      if (/\.gif(?:[?#]|$)/i.test(value)) return false;
      return true;
    };
    const pushSrcset = (bucket, value) => {
      String(value || '').split(',').forEach((part) => {
        const match = part.trim().match(/^(https?:\/\/\S+?)(?:\s+(\d+(?:\.\d+)?)(w|x))?$/i);
        if (!match || !validUrl(match[1])) return;
        const amount = Number(match[2] || 1);
        const multiplier = match[3] === 'x' ? 1000 : 1;
        bucket.push({ url: match[1], score: amount * multiplier + 250 });
      });
    };
    const addCandidate = (bucket, url, score = 0) => {
      url = String(url || '').trim();
      if (!validUrl(url)) return;
      let bonus = score;
      if (/m\.media-amazon\.com\/images\/I\//i.test(url) || /images-na\.ssl-images-amazon\.com\/images\/I\//i.test(url)) bonus += 900;
      if (/\/images\/I\//i.test(url)) bonus += 500;
      if (/\._AC_|\._SL|\._SX|\._SY|\._UL/i.test(url)) bonus += 120;
      bucket.push({ url, score: bonus });
    };
    const bestImage = (root) => {
      if (!root?.querySelectorAll) return '';
      const candidates = [];
      const images = [...root.querySelectorAll('img.s-image, img[data-image-latency], picture img, img[data-src], img[data-lazy-src], img')].slice(0, 30);
      images.forEach((img, index) => {
        const base = Math.max(0, 300 - index * 4);
        addCandidate(candidates, img.currentSrc, base + 300);
        addCandidate(candidates, img.src, base + 250);
        addCandidate(candidates, img.getAttribute('data-src'), base + 240);
        addCandidate(candidates, img.getAttribute('data-lazy-src'), base + 235);
        addCandidate(candidates, img.getAttribute('data-old-hires'), base + 420);
        addCandidate(candidates, img.getAttribute('data-a-hires'), base + 410);
        pushSrcset(candidates, img.getAttribute('srcset'));
        pushSrcset(candidates, img.getAttribute('data-srcset'));
        try {
          const dynamic = JSON.parse(img.getAttribute('data-a-dynamic-image') || '{}');
          Object.entries(dynamic || {}).forEach(([url, dimensions]) => {
            const size = Array.isArray(dimensions) ? Number(dimensions[0] || 0) * Number(dimensions[1] || 0) : 0;
            addCandidate(candidates, url, 600 + Math.min(600, Math.round(size / 2000)));
          });
        } catch {}
        img.closest('picture')?.querySelectorAll('source').forEach((source) => {
          pushSrcset(candidates, source.getAttribute('srcset'));
          pushSrcset(candidates, source.getAttribute('data-srcset'));
        });
      });
      candidates.sort((a, b) => b.score - a.score);
      return candidates[0]?.url || '';
    };

    const result = {};
    const cards = document.querySelectorAll('[data-component-type="s-search-result"][data-asin], .s-result-item[data-asin], [data-asin].sg-col-outer');
    cards.forEach((card) => {
      const asin = cleanText(card.getAttribute('data-asin')).toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin)) return;
      const image = bestImage(card);
      if (image) result[asin] = image;
    });

    document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]').forEach((link) => {
      const asin = asinFromUrl(link.href);
      if (!asin || result[asin]) return;
      const root = link.closest('[data-asin], .s-result-item, article, li, div') || link.parentElement;
      const image = bestImage(root);
      if (image) result[asin] = image;
    });

    const detailAsin = cleanText(
      document.querySelector('#ASIN')?.value ||
      document.querySelector('input[name="ASIN"]')?.value ||
      document.querySelector('[data-detail-page-asin]')?.getAttribute('data-detail-page-asin') ||
      asinFromUrl(location.href)
    ).toUpperCase();
    if (/^[A-Z0-9]{10}$/.test(detailAsin)) {
      const image = bestImage(document);
      if (image) result[detailAsin] = image;
    }

    return result;
  }

  function fallbackFor(row) {
    const existing = row.querySelector('.batchImageFallback');
    if (existing) return existing;
    const fallback = document.createElement('div');
    fallback.className = 'batchImageFallback';
    fallback.textContent = 'A';
    return fallback;
  }

  function applyQueueImagesToDom() {
    const queue = readQueue();
    const byAsin = new Map(queue.map((item) => [String(item?.asin || '').toUpperCase(), String(item?.image || '')]));
    document.querySelectorAll(`#${CARD_ID} .batchItem`).forEach((row) => {
      const meta = clean(row.querySelector('.batchMeta')?.textContent || '');
      const asin = (meta.match(/\b[A-Z0-9]{10}\b/) || [])[0] || '';
      if (!asin) return;
      const url = byAsin.get(asin) || '';
      let image = row.querySelector('.batchImage');
      const fallback = row.querySelector('.batchImageFallback');

      if (url) {
        if (!image) {
          image = document.createElement('img');
          image.className = 'batchImage';
          image.alt = '';
          image.referrerPolicy = 'no-referrer';
          fallback?.replaceWith(image);
        }
        if (image.src !== url) image.src = url;
        if (image.dataset.elyonErrorHandler !== '1') {
          image.dataset.elyonErrorHandler = '1';
          image.addEventListener('error', () => {
            if (!image.isConnected) return;
            image.replaceWith(fallbackFor(row));
          }, { once: true });
        }
      } else if (image) {
        image.replaceWith(fallbackFor(row));
      }
    });
  }

  async function refreshFromActiveAmazonPage() {
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !/^https:\/\/(?:www\.)?amazon\./i.test(tab.url || '')) return;
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanAmazonImages
      });
      const images = result && typeof result === 'object' && !Array.isArray(result) ? result : {};
      if (!Object.keys(images).length) {
        applyQueueImagesToDom();
        return;
      }

      const queue = readQueue();
      let changed = false;
      queue.forEach((item) => {
        const asin = String(item?.asin || '').toUpperCase();
        const image = String(images[asin] || '').trim();
        if (!image || item.image === image) return;
        item.image = image;
        item.updatedAt = Date.now();
        changed = true;
      });
      if (changed) writeQueue(queue);
      applyQueueImagesToDom();
    } catch {
      applyQueueImagesToDom();
    }
  }

  function scheduleRefresh(delay = 450) {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refreshFromActiveAmazonPage, delay);
  }

  function install() {
    applyQueueImagesToDom();
    const collect = document.getElementById('collectAmazonPage');
    collect?.addEventListener('click', () => {
      scheduleRefresh(500);
      window.setTimeout(() => refreshFromActiveAmazonPage(), 1400);
    });

    const card = document.getElementById(CARD_ID);
    if (card && typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(() => {
        if (observerScheduled) return;
        observerScheduled = true;
        requestAnimationFrame(() => {
          observerScheduled = false;
          applyQueueImagesToDom();
        });
      });
      observer.observe(card, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
