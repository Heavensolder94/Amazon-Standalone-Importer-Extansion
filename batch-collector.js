(() => {
  'use strict';

  const STORAGE_KEY = 'elyon_amazon_importer_batch_queue_v1';
  const MAX_QUEUE = 50;
  const MAX_BATCH = 20;
  const STYLE_ID = 'elyonBatchCollectorStyles';
  const CARD_ID = 'elyonBatchCollectorCard';
  let queue = [];
  let batchRunning = false;
  let stopRequested = false;

  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const value = (id) => String(document.getElementById(id)?.value || '');
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function safeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function sanitizeItem(item) {
    const status = ['collected', 'queued', 'loading', 'designer', 'ready', 'error'].includes(item?.status)
      ? item.status
      : 'collected';
    return {
      asin: clean(item?.asin).toUpperCase().slice(0, 10),
      title: clean(item?.title).slice(0, 500),
      url: clean(item?.url).slice(0, 2000),
      image: clean(item?.image).slice(0, 2000),
      price: clean(item?.price).slice(0, 80),
      sponsored: item?.sponsored === true,
      selected: item?.selected !== false,
      status: ['loading', 'designer'].includes(status) ? 'queued' : status,
      error: clean(item?.error).slice(0, 1000),
      product: safeObject(item?.product),
      snapshot: safeObject(item?.snapshot),
      updatedAt: Number(item?.updatedAt || Date.now())
    };
  }

  function readQueue() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      const items = Array.isArray(parsed) ? parsed : [];
      return items.map(sanitizeItem).filter((item) => /^[A-Z0-9]{10}$/.test(item.asin)).slice(0, MAX_QUEUE);
    } catch {
      return [];
    }
  }

  function saveQueue() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(0, MAX_QUEUE))); } catch {}
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CARD_ID} .batchIntro { margin-top: -2px; }
      #${CARD_ID} .batchToolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      #${CARD_ID} .batchToolbar .btn { flex: 1 1 145px; }
      #${CARD_ID} .batchProgressWrap { margin: 12px 0 8px; height: 7px; overflow: hidden; border-radius: 999px; background: rgba(148,163,184,.22); }
      #${CARD_ID} .batchProgressBar { height: 100%; width: 0%; border-radius: inherit; background: linear-gradient(90deg,#7c3aed,#2563eb); transition: width .25s ease; }
      #${CARD_ID} .batchSummary { margin: 8px 0 0; font-size: 12px; line-height: 1.45; color: #64748b; }
      #${CARD_ID} .batchList { display: grid; gap: 9px; margin-top: 12px; }
      #${CARD_ID} .batchEmpty { padding: 18px 14px; border: 1px dashed rgba(148,163,184,.45); border-radius: 12px; text-align: center; color: #64748b; font-size: 12px; }
      #${CARD_ID} .batchItem { display: grid; grid-template-columns: auto 54px minmax(0,1fr); gap: 10px; align-items: start; padding: 10px; border: 1px solid rgba(148,163,184,.24); border-radius: 12px; background: rgba(248,250,252,.78); }
      #${CARD_ID} .batchItem.active { border-color: rgba(124,58,237,.38); background: rgba(245,243,255,.72); }
      #${CARD_ID} .batchSelect { margin-top: 19px; width: 16px; height: 16px; }
      #${CARD_ID} .batchImage { width: 54px; height: 54px; border-radius: 10px; object-fit: contain; background: #fff; border: 1px solid rgba(148,163,184,.2); }
      #${CARD_ID} .batchImageFallback { width: 54px; height: 54px; border-radius: 10px; display:grid;place-items:center;background:#eef2ff;color:#6366f1;font-weight:800; }
      #${CARD_ID} .batchTitle { margin: 0; font-size: 12px; line-height: 1.35; font-weight: 750; color: #172033; }
      #${CARD_ID} .batchMeta { margin: 4px 0 0; font-size: 10.5px; line-height: 1.35; color: #64748b; }
      #${CARD_ID} .batchRowBottom { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:8px; }
      #${CARD_ID} .batchState { display:inline-flex; align-items:center; min-height:24px; border-radius:999px; padding:4px 8px; font-size:10px; font-weight:800; background:#e2e8f0;color:#475569; }
      #${CARD_ID} .batchState.ready { background:#dcfce7;color:#15803d; }
      #${CARD_ID} .batchState.running { background:#ede9fe;color:#6d28d9; }
      #${CARD_ID} .batchState.error { background:#fee2e2;color:#b91c1c; }
      #${CARD_ID} .batchMiniBtn { appearance:none;border:1px solid rgba(148,163,184,.3);background:#fff;color:#334155;border-radius:8px;padding:5px 7px;font:inherit;font-size:10px;font-weight:750;cursor:pointer; }
      #${CARD_ID} .batchMiniBtn.primary { background:#111827;color:#fff;border-color:#111827; }
      #${CARD_ID} .batchMiniBtn.danger { color:#b91c1c; }
      #${CARD_ID} .batchError { margin:6px 0 0;font-size:10px;line-height:1.35;color:#b91c1c;overflow-wrap:anywhere; }
      #${CARD_ID} .batchNotice { margin-top:10px;padding:9px 10px;border-radius:10px;background:#f8fafc;color:#475569;font-size:11px;line-height:1.45; }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function statusLabel(item) {
    return {
      collected: 'Gesammelt',
      queued: 'Wartet',
      loading: 'Amazon lädt …',
      designer: 'Designer / KI …',
      ready: 'Bereit zur Prüfung',
      error: 'Fehler'
    }[item.status] || 'Gesammelt';
  }

  function statusClass(item) {
    if (item.status === 'ready') return 'ready';
    if (item.status === 'error') return 'error';
    if (['queued', 'loading', 'designer'].includes(item.status)) return 'running';
    return '';
  }

  function selectedItems() {
    return queue.filter((item) => item.selected);
  }

  function renderQueue() {
    const list = document.getElementById('batchCollectorList');
    const chip = document.getElementById('batchCollectorChip');
    const summary = document.getElementById('batchCollectorSummary');
    const prepare = document.getElementById('prepareCollectedBatch');
    const stop = document.getElementById('stopCollectedBatch');
    const progress = document.getElementById('batchCollectorProgress');
    if (!list || !chip || !summary || !prepare || !stop || !progress) return;

    const selected = selectedItems().length;
    const ready = queue.filter((item) => item.status === 'ready').length;
    const errors = queue.filter((item) => item.status === 'error').length;
    const finished = queue.filter((item) => ['ready', 'error'].includes(item.status)).length;
    chip.textContent = queue.length ? `${queue.length} gesammelt` : 'Leer';
    chip.className = queue.length ? 'chip violet' : 'chip';
    summary.textContent = queue.length
      ? `${queue.length} gesammelt · ${selected} ausgewählt · ${ready} bereit${errors ? ` · ${errors} Fehler` : ''}. Pro Lauf werden maximal ${MAX_BATCH} Produkte vorbereitet.`
      : 'Noch keine Produkte gesammelt. Öffne eine Amazon-Suche oder Kategorie und starte „Produkte auf Seite sammeln“.';
    prepare.disabled = batchRunning || selected === 0;
    stop.disabled = !batchRunning;
    const progressValue = queue.length ? Math.round((finished / queue.length) * 100) : 0;
    progress.style.width = `${batchRunning ? Math.max(4, progressValue) : progressValue}%`;

    list.replaceChildren();
    if (!queue.length) {
      const empty = document.createElement('div');
      empty.className = 'batchEmpty';
      empty.textContent = 'Auf einer Amazon-Suchergebnisseite kannst du mit einem Klick alle erkannten Produktkarten einsammeln.';
      list.appendChild(empty);
      return;
    }

    queue.forEach((item) => {
      const row = document.createElement('article');
      row.className = `batchItem ${['loading', 'designer'].includes(item.status) ? 'active' : ''}`.trim();

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'batchSelect';
      checkbox.checked = item.selected;
      checkbox.disabled = batchRunning;
      checkbox.title = 'Für Batch-Vorbereitung auswählen';
      checkbox.addEventListener('change', () => {
        item.selected = checkbox.checked;
        item.updatedAt = Date.now();
        saveQueue();
        renderQueue();
      });

      let visual;
      if (item.image) {
        visual = document.createElement('img');
        visual.className = 'batchImage';
        visual.src = item.image;
        visual.alt = '';
        visual.referrerPolicy = 'no-referrer';
      } else {
        visual = document.createElement('div');
        visual.className = 'batchImageFallback';
        visual.textContent = 'A';
      }

      const body = document.createElement('div');
      const title = document.createElement('p');
      title.className = 'batchTitle';
      title.textContent = item.title || item.asin;
      body.appendChild(title);

      const meta = document.createElement('p');
      meta.className = 'batchMeta';
      meta.textContent = [item.asin, item.price, item.sponsored ? 'Gesponsert' : ''].filter(Boolean).join(' · ');
      body.appendChild(meta);

      const bottom = document.createElement('div');
      bottom.className = 'batchRowBottom';
      const stateChip = document.createElement('span');
      stateChip.className = `batchState ${statusClass(item)}`.trim();
      stateChip.textContent = statusLabel(item);
      bottom.appendChild(stateChip);

      if (item.status === 'ready' && Object.keys(item.snapshot || {}).length) {
        const load = document.createElement('button');
        load.type = 'button';
        load.className = 'batchMiniBtn primary';
        load.textContent = 'Zur Prüfung laden';
        load.addEventListener('click', () => loadPreparedItem(item));
        bottom.appendChild(load);
      }

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'batchMiniBtn';
      open.textContent = 'Amazon';
      open.addEventListener('click', () => {
        if (globalThis.chrome?.tabs) chrome.tabs.create({ url: item.url });
        else window.open(item.url, '_blank', 'noopener');
      });
      bottom.appendChild(open);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'batchMiniBtn danger';
      remove.textContent = 'Entfernen';
      remove.disabled = batchRunning;
      remove.addEventListener('click', () => {
        queue = queue.filter((entry) => entry.asin !== item.asin);
        saveQueue();
        renderQueue();
      });
      bottom.appendChild(remove);
      body.appendChild(bottom);

      if (item.error) {
        const error = document.createElement('p');
        error.className = 'batchError';
        error.textContent = item.error;
        body.appendChild(error);
      }

      row.append(checkbox, visual, body);
      list.appendChild(row);
    });
  }

  function createUi() {
    if (document.getElementById(CARD_ID)) return;
    const content = document.querySelector('.content');
    if (!content) return;
    installStyles();

    const card = document.createElement('section');
    card.id = CARD_ID;
    card.className = 'card';

    const head = document.createElement('div');
    head.className = 'head';
    const heading = document.createElement('h3');
    heading.textContent = 'Amazon Sammelmodus';
    const chip = document.createElement('span');
    chip.id = 'batchCollectorChip';
    chip.className = 'chip';
    chip.textContent = 'Leer';
    head.append(heading, chip);

    const intro = document.createElement('p');
    intro.className = 'small batchIntro';
    intro.textContent = 'Öffne eine Amazon-Suche oder Kategorie. Die Extension sammelt die erkannten Produktkarten, entfernt ASIN-Duplikate und kann die Auswahl anschließend nacheinander mit Listing Designer + DeepSeek vorbereiten.';

    const toolbar = document.createElement('div');
    toolbar.className = 'batchToolbar';
    const collect = button('collectAmazonPage', '🔎 Produkte auf Seite sammeln', 'btn violet');
    const selectAll = button('selectAllCollected', 'Alle auswählen', 'btn soft');
    const prepare = button('prepareCollectedBatch', '✨ Auswahl vorbereiten', 'btn gold');
    const stop = button('stopCollectedBatch', 'Stoppen', 'btn soft');
    stop.disabled = true;
    toolbar.append(collect, selectAll, prepare, stop);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'batchProgressWrap';
    const progress = document.createElement('div');
    progress.id = 'batchCollectorProgress';
    progress.className = 'batchProgressBar';
    progressWrap.appendChild(progress);

    const summary = document.createElement('p');
    summary.id = 'batchCollectorSummary';
    summary.className = 'batchSummary';

    const list = document.createElement('div');
    list.id = 'batchCollectorList';
    list.className = 'batchList';

    const footer = document.createElement('div');
    footer.className = 'batchToolbar';
    const clearReady = button('clearFinishedBatch', 'Fertige entfernen', 'btn soft');
    const clearAll = button('clearAllBatch', 'Liste leeren', 'btn soft');
    footer.append(clearReady, clearAll);

    const notice = document.createElement('div');
    notice.className = 'batchNotice';
    notice.textContent = 'Wichtig: Der Sammelmodus veröffentlicht nichts automatisch. Fertige Produkte werden nur als vorbereitete Arbeitsentwürfe gespeichert. Vor dem eBay-Entwurf lädst du sie zur Prüfung in den normalen Editor.';

    card.append(head, intro, toolbar, progressWrap, summary, list, footer, notice);
    content.insertBefore(card, content.firstElementChild);

    collect.addEventListener('click', collectCurrentAmazonPage);
    selectAll.addEventListener('click', () => {
      const shouldSelect = queue.some((item) => !item.selected);
      queue.forEach((item) => { item.selected = shouldSelect; });
      saveQueue();
      renderQueue();
    });
    prepare.addEventListener('click', prepareSelectedBatch);
    stop.addEventListener('click', () => {
      stopRequested = true;
      stop.disabled = true;
      stop.textContent = 'Stoppt nach aktuellem Produkt …';
    });
    clearReady.addEventListener('click', () => {
      if (batchRunning) return;
      queue = queue.filter((item) => item.status !== 'ready');
      saveQueue();
      renderQueue();
    });
    clearAll.addEventListener('click', () => {
      if (batchRunning) return;
      queue = [];
      saveQueue();
      renderQueue();
    });

    renderQueue();
  }

  function button(id, label, className) {
    const element = document.createElement('button');
    element.id = id;
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    return element;
  }

  async function activeAmazonTab() {
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) {
      throw new Error('Der Sammelmodus ist nur in der installierten Chrome-Erweiterung verfügbar.');
    }
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https:\/\/(?:www\.)?amazon\./i.test(tab.url || '')) {
      throw new Error('Bitte zuerst eine Amazon-Suche, Kategorie oder Produktseite öffnen.');
    }
    return tab;
  }

  function scanAmazonPage() {
    const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const asinFromUrl = (href) => {
      const raw = String(href || '');
      return (raw.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i) || [])[1]?.toUpperCase() || '';
    };
    const canonicalUrl = (asin) => `${location.origin}/dp/${asin}`;
    const products = new Map();

    const add = (asin, node, link = null) => {
      asin = cleanText(asin).toUpperCase();
      if (!/^[A-Z0-9]{10}$/.test(asin) || products.has(asin)) return;
      const root = node || document;
      const anchor = link || root.querySelector?.('h2 a[href*="/dp/"], a.a-link-normal.s-no-outline[href*="/dp/"], a[href*="/gp/product/"], a[href*="/dp/"]');
      const title = cleanText(
        root.querySelector?.('h2 span')?.textContent ||
        root.querySelector?.('[data-cy="title-recipe"] h2')?.textContent ||
        root.querySelector?.('img.s-image')?.alt ||
        anchor?.getAttribute?.('aria-label') ||
        anchor?.textContent ||
        (asinFromUrl(location.href) === asin ? document.querySelector('#productTitle')?.textContent : '')
      );
      if (!title || title.length < 3) return;
      const imageNode = root.querySelector?.('img.s-image, img[data-image-latency], img') || null;
      const image = imageNode?.currentSrc || imageNode?.src || '';
      const price = cleanText(root.querySelector?.('.a-price .a-offscreen')?.textContent || root.querySelector?.('.a-price')?.textContent || '');
      const sponsored = /\b(?:Gesponsert|Sponsored)\b/i.test(cleanText(root.textContent).slice(0, 1600));
      products.set(asin, {
        asin,
        title,
        url: canonicalUrl(asin),
        image,
        price,
        sponsored
      });
    };

    const selectors = [
      '[data-component-type="s-search-result"][data-asin]',
      '.s-result-item[data-asin]',
      '[data-asin].sg-col-outer'
    ];
    document.querySelectorAll(selectors.join(',')).forEach((node) => {
      const asin = cleanText(node.getAttribute('data-asin')).toUpperCase();
      const link = node.querySelector('h2 a[href*="/dp/"], a.a-link-normal.s-no-outline[href*="/dp/"], a[href*="/gp/product/"], a[href*="/dp/"]');
      add(asin || asinFromUrl(link?.href), node, link);
    });

    if (products.size < 2) {
      document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]').forEach((link) => {
        const asin = asinFromUrl(link.href);
        if (!asin) return;
        const root = link.closest('[data-asin], .s-result-item, article, li, div') || link.parentElement;
        add(asin, root, link);
      });
    }

    const detailAsin = cleanText(
      document.querySelector('#ASIN')?.value ||
      document.querySelector('input[name="ASIN"]')?.value ||
      document.querySelector('[data-detail-page-asin]')?.getAttribute('data-detail-page-asin') ||
      asinFromUrl(location.href)
    ).toUpperCase();
    if (document.querySelector('#productTitle') && detailAsin) add(detailAsin, document, null);

    return [...products.values()].slice(0, 50);
  }

  async function collectCurrentAmazonPage() {
    const collect = document.getElementById('collectAmazonPage');
    if (collect) {
      collect.disabled = true;
      collect.textContent = '🔎 Sammle …';
    }
    try {
      const tab = await activeAmazonTab();
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scanAmazonPage
      });
      const found = Array.isArray(result) ? result : [];
      if (!found.length) throw new Error('Auf dieser Amazon-Seite wurden keine eindeutigen Produktkarten mit ASIN erkannt.');

      const existing = new Map(queue.map((item) => [item.asin, item]));
      let added = 0;
      let updated = 0;
      for (const raw of found) {
        if (queue.length >= MAX_QUEUE && !existing.has(raw.asin)) break;
        const incoming = sanitizeItem({ ...raw, selected: true, status: 'collected' });
        const old = existing.get(incoming.asin);
        if (old) {
          old.title = incoming.title || old.title;
          old.url = incoming.url || old.url;
          old.image = incoming.image || old.image;
          old.price = incoming.price || old.price;
          old.sponsored = incoming.sponsored;
          old.selected = true;
          old.updatedAt = Date.now();
          updated += 1;
        } else {
          queue.push(incoming);
          existing.set(incoming.asin, incoming);
          added += 1;
        }
      }
      queue = queue.slice(0, MAX_QUEUE);
      saveQueue();
      renderQueue();
      try { setStatus(`Sammelmodus: ${found.length} Amazon-Produkte erkannt · ${added} neu · ${updated} bereits vorhanden.`, 'warn'); } catch {}
      globalThis.showElyonToast?.({
        kind: 'success',
        title: 'Amazon-Produkte gesammelt',
        message: `${found.length} Produktkarten erkannt · ${added} neu in der Liste.`,
        duration: 6500,
        action: { label: 'Liste ansehen', run: () => document.getElementById(CARD_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
      });
    } catch (error) {
      const message = clean(error?.message || 'Amazon-Produkte konnten nicht gesammelt werden.');
      try { setStatus(message, 'err'); } catch {}
    } finally {
      if (collect) {
        collect.disabled = false;
        collect.textContent = '🔎 Produkte auf Seite sammeln';
      }
    }
  }

  function waitForTabComplete(tabId, timeoutMs = 22000) {
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error('Amazon-Produktseite konnte nicht rechtzeitig geladen werden.')), timeoutMs);
      const onUpdated = (updatedId, info) => {
        if (updatedId === tabId && info.status === 'complete') finish();
      };
      const finish = (error = null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        error ? reject(error) : resolve();
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      chrome.tabs.get(tabId).then((tab) => {
        if (tab?.status === 'complete') finish();
      }).catch(() => {});
    });
  }

  function extractAmazonProductPage() {
    const txt = (selector) => document.querySelector(selector)?.textContent?.trim() || '';
    const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name) || '';
    const cleanText = (entry) => String(entry || '').replace(/\s+/g, ' ').trim();
    const title = txt('#productTitle') || '';
    const price = txt('#corePrice_feature_div .a-price .a-offscreen') || txt('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen') || txt('.a-price .a-offscreen') || txt('#priceblock_ourprice') || txt('#priceblock_dealprice') || attr('meta[itemprop="price"]', 'content');
    const img = attr('#landingImage', 'data-old-hires') || attr('#landingImage', 'src') || attr('#imgBlkFront', 'src') || document.querySelector('#altImages img')?.src || '';
    const asin = cleanText(
      document.querySelector('#ASIN')?.value ||
      document.querySelector('input[name="ASIN"]')?.value ||
      document.querySelector('[data-detail-page-asin]')?.getAttribute('data-detail-page-asin') ||
      (location.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i) || [])[1] || ''
    ).toUpperCase();
    const brand = cleanText(txt('#bylineInfo'))
      .replace(/^Marke:\s*/i, '')
      .replace(/^Besuche den\s+/i, '')
      .replace(/\s+Store$/i, '')
      .trim();
    const bullets = [...document.querySelectorAll('#feature-bullets li span.a-list-item, #feature-bullets li span')]
      .map((element) => cleanText(element.textContent))
      .filter(Boolean)
      .slice(0, 12);
    const description = txt('#productDescription') || txt('#aplus') || '';
    const images = [];
    const addImage = (url) => {
      url = String(url || '').trim();
      if (!/^https:\/\//i.test(url)) return;
      const normalized = url.replace(/\._[^.]+_\./, '.');
      if (!images.includes(normalized)) images.push(normalized);
    };
    addImage(img);
    document.querySelectorAll('#altImages img').forEach((image) => addImage(image.currentSrc || image.src));
    try {
      const dynamic = JSON.parse(attr('#landingImage', 'data-a-dynamic-image') || '{}');
      Object.keys(dynamic || {}).forEach(addImage);
    } catch {}

    const details = {};
    const addDetail = (key, detailValue) => {
      key = cleanText(key).replace(/:$/, '');
      detailValue = cleanText(detailValue);
      if (!key || !detailValue || key.length > 120 || detailValue.length > 500 || Object.keys(details).length >= 60) return;
      if (!details[key]) details[key] = detailValue;
    };
    document.querySelectorAll('#productOverview_feature_div tr, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr, .prodDetTable tr, table.a-normal.a-spacing-micro tr').forEach((row) => {
      const cells = row.querySelectorAll('th,td');
      if (cells.length >= 2) addDetail(cells[0].textContent, cells[cells.length - 1].textContent);
    });
    document.querySelectorAll('#detailBullets_feature_div li').forEach((li) => {
      const bold = li.querySelector('.a-text-bold');
      if (!bold) return;
      addDetail(bold.textContent, li.textContent.replace(bold.textContent, ''));
    });

    const variations = {};
    document.querySelectorAll('[id^="variation_"]').forEach((block) => {
      const id = block.id.replace(/^variation_/, '').replace(/_name$/, '').replace(/_/g, ' ');
      const label = cleanText(block.querySelector('label')?.textContent || id).replace(/:$/, '');
      const selected = cleanText(block.querySelector('.selection')?.textContent || block.querySelector('select option:checked')?.textContent || '');
      if (label && selected) variations[label] = selected;
    });
    const breadcrumbs = [...document.querySelectorAll('#wayfinding-breadcrumbs_feature_div a')]
      .map((anchor) => cleanText(anchor.textContent))
      .filter(Boolean)
      .slice(0, 10);

    const blocked = /captcha|automated access|geben sie die zeichen unten ein/i.test(`${document.title} ${document.body?.innerText?.slice(0, 1200) || ''}`);
    return { title, price, img: images[0] || img, images: images.slice(0, 12), asin, brand, bullets, description, details, variations, breadcrumbs, url: location.href, blocked };
  }

  async function extractProduct(item) {
    const tab = await chrome.tabs.create({ url: item.url, active: false });
    try {
      await waitForTabComplete(tab.id);
      await sleep(350);
      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractAmazonProductPage
      });
      const product = safeObject(result);
      if (product.blocked) throw new Error('Amazon hat die Produktseite mit einer Zugriffs-/Captcha-Seite blockiert. Später erneut versuchen.');
      if (!clean(product.title) || !/^[A-Z0-9]{10}$/.test(clean(product.asin))) {
        throw new Error('Produktdetails konnten auf der Amazon-Seite nicht eindeutig gelesen werden.');
      }
      if (clean(product.asin) !== item.asin) {
        throw new Error(`Amazon hat eine andere ASIN geöffnet (${clean(product.asin)} statt ${item.asin}).`);
      }
      return product;
    } finally {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }

  const SNAPSHOT_FIELDS = [
    'title','description','brand','department','style','material','modelNumber','ebayCategoryId','ebayCategoryQuery','ebayCondition',
    'ebayItemSpecifics','buyPrice','sellPrice','manufacturerName','manufacturerAddress','manufacturerCity','manufacturerPostalCode','manufacturerCountry','manufacturerContact',
    'responsibleName','responsibleAddress','responsibleCity','responsiblePostalCode','responsibleCountry','responsibleContact'
  ];

  function captureSnapshot() {
    const fields = {};
    SNAPSHOT_FIELDS.forEach((id) => { fields[id] = value(id); });
    return {
      fields,
      designerFacts: safeObject(typeof state !== 'undefined' ? state.designerFacts : {}),
      ebaySelectedCategory: safeObject(typeof state !== 'undefined' ? state.ebaySelectedCategory : {}),
      ebayCategoryMetadata: safeObject(typeof state !== 'undefined' ? state.ebayCategoryMetadata : {}),
      deepseekNote: clean(document.getElementById('deepseekAiNote')?.textContent || ''),
      preparedAt: new Date().toISOString()
    };
  }

  function applySnapshot(snapshot) {
    const fields = safeObject(snapshot?.fields);
    SNAPSHOT_FIELDS.forEach((id) => {
      const element = document.getElementById(id);
      if (!element || !(id in fields)) return;
      element.value = String(fields[id] ?? '');
    });
    try {
      state.designerFacts = safeObject(snapshot?.designerFacts);
      state.ebaySelectedCategory = Object.keys(safeObject(snapshot?.ebaySelectedCategory)).length ? snapshot.ebaySelectedCategory : null;
      state.ebayCategoryMetadata = Object.keys(safeObject(snapshot?.ebayCategoryMetadata)).length ? snapshot.ebayCategoryMetadata : null;
      state.ebayDraft = null;
    } catch {}
    const note = document.getElementById('deepseekAiNote');
    if (note && snapshot?.deepseekNote) note.textContent = snapshot.deepseekNote;
    const rights = document.getElementById('contentRightsConfirmed');
    if (rights) rights.checked = false;
    const fulfillment = document.getElementById('fulfillmentModelConfirmed');
    if (fulfillment) fulfillment.checked = false;
    try { if (typeof calc === 'function') calc(); } catch {}
    try { if (typeof renderDesignerReadiness === 'function') renderDesignerReadiness(); } catch {}
  }

  function loadPreparedItem(item) {
    if (!item?.product || !Object.keys(item.product).length) return;
    try {
      if (typeof fill !== 'function') throw new Error('Arbeitsentwurf konnte nicht geladen werden.');
      fill(item.product);
      applySnapshot(item.snapshot);
      document.getElementById('productCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setStatus(`Batch-Produkt ${item.asin} zur Prüfung geladen. Bitte Inhalt, Bilder, Preis und Pflichtmerkmale prüfen.`, 'warn');
    } catch (error) {
      setStatus(error?.message || 'Batch-Produkt konnte nicht geladen werden.', 'err');
    }
  }

  async function prepareSelectedBatch() {
    if (batchRunning) return;
    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) {
      setStatus('Batch-Vorbereitung ist nur in der installierten Chrome-Erweiterung verfügbar.', 'err');
      return;
    }
    if (typeof fill !== 'function' || typeof runAutomaticListingDesigner !== 'function') {
      setStatus('Listing Designer ist noch nicht bereit. Extension bitte neu laden.', 'err');
      return;
    }

    const candidates = selectedItems()
      .filter((item) => item.status !== 'ready')
      .slice(0, MAX_BATCH);
    if (!candidates.length) {
      setStatus('Die ausgewählten Produkte sind bereits vorbereitet oder es ist nichts ausgewählt.', 'warn');
      return;
    }

    batchRunning = true;
    stopRequested = false;
    globalThis.__elyonBatchPreparing = true;
    candidates.forEach((item) => {
      item.status = 'queued';
      item.error = '';
    });
    saveQueue();
    renderQueue();
    setStatus(`Massenimport gestartet: ${candidates.length} Produkte werden nacheinander vorbereitet.`, 'warn');

    let prepared = 0;
    let failed = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      if (stopRequested) break;
      const item = candidates[index];
      try {
        item.status = 'loading';
        item.error = '';
        item.updatedAt = Date.now();
        saveQueue();
        renderQueue();
        setStatus(`Massenimport ${index + 1}/${candidates.length}: Amazon-Daten für ${item.asin} werden geladen …`, 'warn');

        const product = await extractProduct(item);
        item.product = product;
        item.title = clean(product.title) || item.title;
        item.price = clean(product.price) || item.price;
        item.image = clean(product.img) || item.image;
        item.status = 'designer';
        item.updatedAt = Date.now();
        saveQueue();
        renderQueue();

        fill(product);
        await runAutomaticListingDesigner({ silent: true, batch: true });
        await sleep(350);
        try { if (typeof safeDraftPayload === 'function') safeDraftPayload(); } catch {}
        await sleep(80);

        item.snapshot = captureSnapshot();
        item.status = 'ready';
        item.error = '';
        item.updatedAt = Date.now();
        prepared += 1;
      } catch (error) {
        item.status = 'error';
        item.error = clean(error?.message || 'Produkt konnte nicht vorbereitet werden.');
        item.updatedAt = Date.now();
        failed += 1;
      }
      saveQueue();
      renderQueue();
      await sleep(120);
    }

    const stopped = stopRequested;
    batchRunning = false;
    stopRequested = false;
    const stop = document.getElementById('stopCollectedBatch');
    if (stop) stop.textContent = 'Stoppen';
    saveQueue();
    renderQueue();

    const remaining = candidates.filter((item) => !['ready', 'error'].includes(item.status)).length;
    const summary = stopped
      ? `Massenimport pausiert: ${prepared} vorbereitet · ${failed} Fehler · ${remaining} warten.`
      : `Massenimport vorbereitet ✅\n${prepared} Produkte bereit zur Prüfung${failed ? ` · ${failed} Fehler` : ''}.`;
    try { setStatus(summary, stopped ? 'warn' : (prepared ? 'ok' : 'err')); } catch {}
    globalThis.__elyonBatchPreparing = false;

    globalThis.showElyonToast?.({
      kind: prepared ? 'success' : 'error',
      title: stopped ? 'Massenimport pausiert' : (prepared ? 'Massenimport vorbereitet' : 'Massenimport fehlgeschlagen'),
      message: `${prepared} bereit zur Prüfung${failed ? ` · ${failed} Fehler` : ''}${remaining ? ` · ${remaining} warten` : ''}.`,
      duration: prepared ? 8500 : 12000,
      action: { label: 'Ergebnisse ansehen', run: () => document.getElementById(CARD_ID)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    });
  }

  function init() {
    queue = readQueue();
    saveQueue();
    createUi();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
