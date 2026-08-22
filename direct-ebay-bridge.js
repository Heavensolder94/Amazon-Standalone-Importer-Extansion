(() => {
  'use strict';

  const SELLER_SESSION_COOKIE = 'elyon_seller_session';
  const SELLER_SESSION_HEADER = 'X-Elyon-Seller-Session';
  const SELLER_EXTENSION_ACTION_URL = 'https://elyonsellertool.vercel.app/api/ebay/extension-action';
  const OFFER_LINKS_STORAGE_KEY = 'elyon_amazon_importer_ebay_offer_links_v1';
  const SELLER_SESSION_ORIGINS = [
    'https://elyonsellertool.vercel.app/',
    'https://elyon-seller-tool.vercel.app/'
  ];

  async function readSellerSession() {
    if (!globalThis.chrome?.cookies) {
      throw new Error('Chrome-Cookie-Zugriff fehlt. Erweiterung bitte in chrome://extensions neu laden.');
    }

    for (const url of SELLER_SESSION_ORIGINS) {
      const cookie = await chrome.cookies.get({ url, name: SELLER_SESSION_COOKIE }).catch(() => null);
      if (cookie?.value) return cookie.value;
    }

    throw new Error(
      'Keine gültige Seller-Tool-Sitzung gefunden. Öffne das Seller Tool einmal, melde dich an und versuche den eBay-Vorentwurf danach erneut. Der Importer öffnet das Seller Tool nicht mehr automatisch.'
    );
  }

  function ebayErrorDetails(details) {
    const errors = Array.isArray(details?.errors) ? details.errors : [];
    return errors.slice(0, 3).map((entry) => {
      const base = String(entry?.longMessage || entry?.message || '').trim();
      const errorId = entry?.errorId ? `Fehler ${entry.errorId}` : '';
      const parameters = (Array.isArray(entry?.parameters) ? entry.parameters : [])
        .map((parameter) => String(parameter?.value || '').trim())
        .filter(Boolean)
        .slice(0, 6);
      return [errorId, base, parameters.length ? `(${parameters.join(', ')})` : ''].filter(Boolean).join(' · ');
    }).filter(Boolean).join(' | ');
  }

  function sourceKey(payload) {
    return String(payload?.sourceProductId || payload?.sku || '').trim();
  }

  function readOfferLinks() {
    try {
      const value = JSON.parse(localStorage.getItem(OFFER_LINKS_STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function rememberOfferLink(payload, body) {
    const key = sourceKey(payload);
    const offerId = String(body?.offerId || '').trim();
    if (!key || !offerId) return;
    const links = readOfferLinks();
    links[key] = {
      offerId,
      sku: String(body?.sku || payload?.sku || '').trim(),
      savedAt: Date.now()
    };
    try { localStorage.setItem(OFFER_LINKS_STORAGE_KEY, JSON.stringify(links)); } catch {}
  }

  function forgetOfferLink(payload) {
    const key = sourceKey(payload);
    if (!key) return;
    const links = readOfferLinks();
    if (!(key in links)) return;
    delete links[key];
    try { localStorage.setItem(OFFER_LINKS_STORAGE_KEY, JSON.stringify(links)); } catch {}
  }

  function restoreOfferLink(payload) {
    const source = payload && typeof payload === 'object' ? { ...payload } : {};
    if (String(source.offerId || '').trim()) return source;
    const key = sourceKey(source);
    const saved = key ? readOfferLinks()[key] : null;
    if (!saved?.offerId) return source;
    return {
      ...source,
      offerId: String(saved.offerId).trim(),
      sku: String(source.sku || saved.sku || '').trim()
    };
  }

  function duplicateOfferId(details) {
    const errors = Array.isArray(details?.errors) ? details.errors : [];
    for (const entry of errors) {
      const duplicate = Number(entry?.errorId) === 25002 || /offer entity already exists/i.test(String(entry?.message || entry?.longMessage || ''));
      if (!duplicate) continue;
      const parameter = (Array.isArray(entry?.parameters) ? entry.parameters : [])
        .find((item) => String(item?.name || '').toLowerCase() === 'offerid');
      const offerId = String(parameter?.value || '').trim();
      if (offerId) return offerId;
    }
    return '';
  }

  async function requestSellerAction(session, action, payload) {
    const response = await fetch(SELLER_EXTENSION_ACTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SELLER_SESSION_HEADER]: session
      },
      cache: 'no-store',
      body: JSON.stringify({ action, payload })
    });
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  }

  function clarifyDraftUi() {
    const mainButton = document.getElementById('prepareDraftMain');
    const mainStrong = mainButton?.querySelector('strong');
    const mainSub = mainButton?.querySelector('span');
    if (mainStrong) mainStrong.textContent = 'eBay-Vorentwurf';
    if (mainSub) mainSub.textContent = 'Inventory-API Offer · nicht Seller Hub → Entwürfe';

    ['prepareDraftEbay', 'prepareDraft'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.textContent = 'eBay-Vorentwurf';
      button.title = 'Unveröffentlichter Inventory-API Offer. Er erscheint nicht unter Seller Hub → Entwürfe.';
    });

    const ebayButton = document.getElementById('prepareDraftEbay');
    const card = ebayButton?.closest('.card');
    const note = card?.querySelector('p.small');
    if (note) {
      note.textContent = 'Elyon speichert hier einen unveröffentlichten eBay Inventory-API Offer. Dieser ist technisch bei eBay vorhanden, erscheint aber nicht unter Seller Hub → Entwürfe. Nach deiner Prüfung kann Elyon ihn über „Jetzt veröffentlichen“ live stellen.';
    }
  }

  async function directSellerLifecycleAction(action, requestData) {
    const session = await readSellerSession();
    const payload = restoreOfferLink(requestData || {});
    const result = await requestSellerAction(session, action, payload);
    const body = result.body || {};

    if (result.status === 403 && (body?.error === 'seller_access_denied' || body?.error === 'seller_extension_session_missing')) {
      body.message = body.message || 'Seller-Tool-Sitzung ist abgelaufen. Bitte einmal im Seller Tool neu anmelden.';
    }

    if (!result.ok && (action === 'create-draft' || action === 'draft')) {
      const existingOfferId = duplicateOfferId(body?.details);
      if (existingOfferId) {
        return {
          ok: true,
          status: 200,
          body: {
            ok: true,
            draftCreated: true,
            published: false,
            reusedExisting: true,
            offerId: existingOfferId,
            sku: String(payload?.sku || '').trim(),
            message: 'Vorhandener unveröffentlichter eBay Inventory-Offer wurde wiedererkannt.'
          }
        };
      }
    }

    if (result.ok && body?.ok !== false && (action === 'create-draft' || action === 'draft')) {
      rememberOfferLink(payload, body);
    }
    if (result.ok && body?.published === true && action === 'publish') {
      forgetOfferLink(payload);
    }

    if (!result.ok) {
      const detail = ebayErrorDetails(body?.details);
      if (detail) {
        body.message = `${body.message || 'eBay-Vorentwurf konnte nicht erstellt werden.'}\n${detail}`;
      } else if (!body.message) {
        body.message = `eBay-Vorentwurf konnte nicht erstellt werden (HTTP ${result.status}).`;
      }
    }

    return { ok: result.ok, status: result.status, body };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', clarifyDraftUi, { once: true });
  } else {
    clarifyDraftUi();
  }

  sellerLifecycleAction = directSellerLifecycleAction;
})();
