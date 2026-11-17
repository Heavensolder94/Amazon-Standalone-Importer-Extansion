(() => {
  'use strict';

  const SELLER_SESSION_COOKIE = 'elyon_seller_session';
  const SELLER_SESSION_HEADER = 'X-Elyon-Seller-Session';
  const SELLER_EXTENSION_ACTION_URL = 'https://elyonsellertool.vercel.app/api/ebay/extension-action';
  const SELLER_HUB_DRAFTS_URL = 'https://www.ebay.de/sh/lst/drafts';
  const DRAFT_TASKS_STORAGE_KEY = 'elyon_amazon_importer_seller_hub_draft_tasks_v1';
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
      'Keine gültige Seller-Tool-Sitzung gefunden. Öffne das Seller Tool einmal, melde dich an und versuche den eBay-Entwurf danach erneut.'
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
    return String(payload?.sourceProductId || payload?.sku || payload?.title || '').trim();
  }

  function draftFingerprint(payload) {
    const content = JSON.stringify([payload?.title, payload?.description, payload?.price,
      payload?.categoryId, payload?.conditionEnum, payload?.images, payload?.itemSpecifics,
      payload?.fulfillmentPolicyId, payload?.paymentPolicyId,
      payload?.returnPolicyId, payload?.merchantLocationKey]);
    let hash = 2166136261;
    for (let i = 0; i < content.length; i += 1) {
      hash ^= content.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16) + ':' + content.length;
  }

  function updateBatchDraft(payload, state, taskId = '') {
    const asin = String(payload?.sourceProductId || '').replace(/^amazon:/i, '').trim();
    if (asin && typeof globalThis.elyonBatchMarkEbayDraft === 'function') {
      globalThis.elyonBatchMarkEbayDraft({ asin, status: state, taskId });
    }
  }

  function readDraftTasks() {
    try {
      const value = JSON.parse(localStorage.getItem(DRAFT_TASKS_STORAGE_KEY) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      return {};
    }
  }

  function writeDraftTasks(tasks) {
    try { localStorage.setItem(DRAFT_TASKS_STORAGE_KEY, JSON.stringify(tasks || {})); } catch {}
  }

  function rememberDraftTask(payload, body) {
    const key = sourceKey(payload);
    const taskId = String(body?.taskId || '').trim();
    if (!key || !taskId) return;
    const tasks = readDraftTasks();
    tasks[key] = {
      taskId,
      sku: String(body?.sku || payload?.sku || '').trim(),
      feedType: String(body?.feedType || '').trim(),
      fingerprint: draftFingerprint(payload),
      savedAt: Date.now()
    };
    writeDraftTasks(tasks);
  }

  function forgetDraftTask(payload) {
    const key = sourceKey(payload);
    if (!key) return;
    const tasks = readDraftTasks();
    if (!(key in tasks)) return;
    delete tasks[key];
    writeDraftTasks(tasks);
  }

  function savedDraftTask(payload) {
    const key = sourceKey(payload);
    const task = key ? readDraftTasks()[key] || null : null;
    return task?.fingerprint === draftFingerprint(payload) ? task : null;
  }

  async function requestSellerAction(session, action, payload) {
    const response = await fetch(SELLER_EXTENSION_ACTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SELLER_SESSION_HEADER]: session
      },
      cache: 'no-store',
      body: JSON.stringify({ action, payload: payload || {} })
    });
    const body = await response.json().catch(() => ({}));

    if (response.status === 403 && (body?.error === 'seller_access_denied' || body?.error === 'seller_extension_session_missing')) {
      body.message = body.message || 'Seller-Tool-Sitzung ist abgelaufen. Bitte einmal im Seller Tool neu anmelden.';
    }
    if (!response.ok) {
      const detail = ebayErrorDetails(body?.details);
      if (detail) body.message = `${body.message || 'eBay-Anfrage fehlgeschlagen.'}\n${detail}`;
      else if (!body.message) body.message = `eBay-Anfrage fehlgeschlagen (HTTP ${response.status}).`;
    }

    return { ok: response.ok, status: response.status, body };
  }

  async function directSellerLifecycleAction(action, requestData) {
    const session = await readSellerSession();
    return requestSellerAction(session, action, requestData || {});
  }

  function sellerHubTaskErrorDetails(body) {
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    const details = errors.slice(0, 3).map((entry) => {
      const code = String(entry?.code || '').trim();
      const message = String(entry?.message || entry?.longMessage || entry?.shortMessage || '').trim();
      return [code ? `eBay ${code}` : '', message].filter(Boolean).join(' · ');
    }).filter(Boolean);
    if (details.length) return details.join('\n');

    const message = String(body?.message || '').trim();
    if (message && !/mit Fehlern verarbeitet/i.test(message)) return message;
    const preview = String(body?.resultPreview || '').trim();
    return preview ? preview.slice(0, 900) : '';
  }

  function statusTextFromTask(body) {
    const status = String(body?.status || '').toUpperCase();
    if (body?.draftVisible === true) {
      const sync = body?.registration?.persisted === true
        ? '\nIm ELYON Seller Tool als Feed-Entwurf registriert (Bestand im Seller Hub separat prüfen).'
        : '\nELYON-Synchronisierung nicht bestätigt. Bitte später „Vorhandenen Entwurf abgleichen“ verwenden.';
      return 'eBay-Feed erfolgreich verarbeitet ✅\nDu findest den Entwurf unter Angebote → Entwürfe.' + sync;
    }
    if (status === 'COMPLETED_WITH_ERROR' || Number(body?.failureCount || 0) > 0) {
      const base = `eBay hat den Entwurf mit Fehlern verarbeitet. Erfolgreich: ${Number(body?.successCount || 0)} · Fehler: ${Number(body?.failureCount || 0)}.`;
      const details = sellerHubTaskErrorDetails(body);
      return details ? `${base}\n${details}` : base;
    }
    if (body?.complete === true) return 'eBay-Feed verarbeitet, aber Entwurf noch nicht als sichtbar bestätigt. Bitte Seller Hub prüfen.';
    return `eBay-Entwurf wird verarbeitet …${body?.taskId ? `\nTask-ID: ${body.taskId}` : ''}\nDas kann bei eBay einige Minuten dauern.`;
  }

  function feedTaskLookup(payload, taskId, sku) {
    return {
      taskId: String(taskId || '').trim(),
      sku: String(sku || payload?.sku || '').trim(),
      sourceProductId: String(payload?.sourceProductId || '').trim(),
      title: String(payload?.title || '').trim(),
      price: Number(payload?.price || 0),
      currency: String(payload?.currency || 'EUR'),
      images: Array.isArray(payload?.images) ? payload.images.slice(0, 8) : [],
      environment: String(payload?.environment || 'production')
    };
  }

  async function checkSavedTask(session, payload, saved) {
    if (!saved?.taskId) return null;
    const response = await requestSellerAction(session, 'draft-status', feedTaskLookup(payload, saved.taskId, saved.sku));
    if (!response.ok) {
      if (response.status === 404 || response.body?.error === 'ebay_draft_task_id_required') forgetDraftTask(payload);
      return null;
    }
    const body = response.body || {};
    const complete = body.complete === true;
    const successCount = Number(body.successCount || 0);
    const failureCount = Number(body.failureCount || 0);
    if (complete && failureCount > 0 && successCount === 0) {
      forgetDraftTask(payload);
      return { retryAllowed: true, body };
    }
    return { retryAllowed: false, body };
  }

  async function pollDraftTask(session, payload, taskId, sku) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const response = await requestSellerAction(session, 'draft-status', feedTaskLookup(payload, taskId, sku));
      if (!response.ok) return null;
      const body = response.body || {};
      if (body.complete === true) {
        if (body.draftVisible !== true && Number(body.failureCount || 0) > 0 && Number(body.successCount || 0) === 0) {
          forgetDraftTask(payload);
        }
        return body;
      }
    }
    return null;
  }

  async function createSellerHubDraftFromButton(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();

    let built;
    try {
      built = typeof safeDraftPayload === 'function' ? safeDraftPayload() : { data: null, error: 'Draft-Payload ist nicht verfügbar.' };
    } catch (error) {
      setStatus(error?.message || 'eBay-Daten konnten nicht gelesen werden.', 'err');
      return;
    }
    if (built?.error || !built?.data) {
      setStatus(built?.error || 'eBay-Daten konnten nicht gelesen werden.', 'err');
      return;
    }

    const payload = { ...built.data };
    delete payload.offerId;
    const validationError = typeof validateDraftInput === 'function'
      ? validateDraftInput(payload)
      : 'Lokale eBay-Pflichtfeldprüfung nicht verfügbar. Erweiterung bitte neu laden.';
    if (validationError) {
      setStatus('eBay-Entwurf blockiert: ' + validationError, 'err');
      if (typeof renderDesignerReadiness === 'function') renderDesignerReadiness();
      return;
    }

    setStatus('Geprüfter eBay-Entwurf wird an Seller Hub übergeben …', 'warn');
    try {
      const session = await readSellerSession();
      const saved = savedDraftTask(payload);
      if (saved?.taskId) {
        const existing = await checkSavedTask(session, payload, saved);
        if (existing && !existing.retryAllowed) {
          updateBatchDraft(payload, existing.body?.draftVisible === true ? 'created' : 'processing', saved.taskId);
          setStatus(statusTextFromTask(existing.body), existing.body?.draftVisible ? 'ok' : 'warn');
          return;
        }
      }

      const response = await requestSellerAction(session, 'create-draft', payload);
      const result = response.body || {};
      if (!response.ok || result.ok === false || !result.taskId) {
        setStatus(result.message || result.error || 'eBay-Entwurf konnte nicht erstellt werden.', 'err');
        return;
      }

      rememberDraftTask(payload, result);
      updateBatchDraft(payload, 'processing', result.taskId);
      setStatus(statusTextFromTask(result), 'warn');
      const completed = await pollDraftTask(session, payload, result.taskId, result.sku);
      if (completed) {
        const nextState = completed.draftVisible === true ? 'created' : (Number(completed.failureCount || 0) > 0 ? 'error' : 'processing');
        updateBatchDraft(payload, nextState, result.taskId);
        setStatus(statusTextFromTask(completed), completed.draftVisible ? 'ok' : (Number(completed.failureCount || 0) > 0 ? 'err' : 'warn'));
      }
    } catch (error) {
      setStatus(`eBay-Entwurf konnte nicht erstellt werden. ${error?.message || ''}`.trim(), 'err');
    }
  }

  async function syncExistingSellerHubDraft(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    let built;
    try {
      built = typeof safeDraftPayload === 'function' ? safeDraftPayload() : null;
    } catch {}
    const payload = built?.data || null;
    if (!payload) {
      setStatus('Produktdaten für den Abgleich fehlen. Bitte zuerst denselben Amazon-Artikel erneut einlesen.', 'warn');
      return;
    }
    // Unlike create-draft, recovery intentionally ignores listing-content fingerprint changes.
    const key = sourceKey(payload);
    const saved = key ? readDraftTasks()[key] : null;
    if (!saved?.taskId) {
      setStatus('Für dieses Produkt ist in dieser Chrome-Installation keine eBay-Task-ID gespeichert. Der Abgleich erstellt ausdrücklich keinen neuen Entwurf.', 'warn');
      return;
    }
    setStatus('Vorhandenen eBay-Feed-Task prüfen und mit ELYON synchronisieren …', 'warn');
    try {
      const session = await readSellerSession();
      const result = await checkSavedTask(session, payload, saved);
      if (!result) {
        setStatus('Der gespeicherte eBay-Task konnte nicht geprüft werden. Es wurde kein neuer Entwurf angelegt.', 'warn');
        return;
      }
      setStatus(statusTextFromTask(result.body), result.body?.draftVisible && result.body?.registration?.persisted !== false ? 'ok' : 'warn');
    } catch (error) {
      setStatus('Abgleich fehlgeschlagen: ' + String(error?.message || 'Unbekannter Fehler'), 'err');
    }
  }

  function openSellerHubDrafts(event) {
    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    if (typeof openTab === 'function') openTab(SELLER_HUB_DRAFTS_URL);
    else window.open(SELLER_HUB_DRAFTS_URL, '_blank', 'noopener');
  }

  function clarifyDraftUi() {
    const mainButton = document.getElementById('prepareDraftMain');
    const mainStrong = mainButton?.querySelector('strong');
    const mainSub = mainButton?.querySelector('span');
    if (mainStrong) mainStrong.textContent = 'eBay-Entwurf';
    if (mainSub) mainSub.textContent = 'Direkt in Seller Hub → Entwürfe';

    ['prepareDraftEbay', 'prepareDraft'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = false;
      button.textContent = 'eBay-Entwurf';
      button.title = 'Erstellt einen echten Entwurf im eBay Verkäufer-Cockpit unter Angebote → Entwürfe.';
    });
    if (mainButton) {
      mainButton.disabled = false;
      mainButton.title = 'Erstellt einen echten Entwurf im eBay Verkäufer-Cockpit unter Angebote → Entwürfe.';
    }

    const ebayButton = document.getElementById('prepareDraftEbay');
    const card = ebayButton?.closest('.card');
    const note = card?.querySelector('p.small');
    if (note) {
      note.textContent = 'Der Button erstellt über eBays Seller-Hub-Feed einen echten eBay-Entwurf. Nach der Verarbeitung erscheint er unter Angebote → Entwürfe und kann dort fertig geprüft und veröffentlicht werden.';
    }

    const draftButton = document.getElementById('prepareDraftEbay');
    if (draftButton && !document.getElementById('syncSellerHubDraft')) {
      const sync = document.createElement('button');
      sync.id = 'syncSellerHubDraft';
      sync.type = 'button';
      sync.className = 'btn';
      sync.textContent = '🔄 Vorhandenen Entwurf mit ELYON abgleichen';
      sync.title = 'Prüft nur eine lokal gespeicherte eBay-Task-ID. Kein neuer eBay-Entwurf.';
      sync.addEventListener('click', syncExistingSellerHubDraft);
      draftButton.insertAdjacentElement('afterend', sync);
    }

    const publishButton = document.getElementById('publishEbay');
    if (publishButton) {
      publishButton.disabled = false;
      publishButton.textContent = 'Entwürfe öffnen';
      publishButton.title = 'Seller Hub → Angebote → Entwürfe öffnen';
    }
  }

  function installDraftHandlers() {
    ['prepareDraftMain', 'prepareDraft', 'prepareDraftEbay'].forEach((id) => {
      const button = document.getElementById(id);
      if (button && button.dataset.sellerHubDraftHandler !== '1') {
        button.dataset.sellerHubDraftHandler = '1';
        button.addEventListener('click', createSellerHubDraftFromButton, true);
      }
    });
    const publishButton = document.getElementById('publishEbay');
    if (publishButton && publishButton.dataset.sellerHubDraftHandler !== '1') {
      publishButton.dataset.sellerHubDraftHandler = '1';
      publishButton.addEventListener('click', openSellerHubDrafts, true);
    }
  }

  try {
    setDraftButtonsEnabled = function sellerHubDraftButtons() {
      clarifyDraftUi();
    };
    setPublishButtonsEnabled = function sellerHubDraftOpenButton() {
      clarifyDraftUi();
    };
  } catch {}

  function initSellerHubDraftFlow() {
    clarifyDraftUi();
    installDraftHandlers();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSellerHubDraftFlow, { once: true });
  } else {
    initSellerHubDraftFlow();
  }

  sellerLifecycleAction = directSellerLifecycleAction;
})();
