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

  function recoveryAsin(value) {
    const candidate = String(value || '').trim().toUpperCase();
    const fromSku = candidate.match(/^AMZ-([A-Z0-9]{10})$/);
    if (fromSku) return fromSku[1];
    const fromSource = candidate.match(/^AMAZON:([A-Z0-9]{10})$/);
    if (fromSource) return fromSource[1];
    return /^[A-Z0-9]{10}$/.test(candidate) ? candidate : '';
  }

  function recoveryAsinFromUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      // Never infer an Amazon product identity from an unrelated website's URL.
      if (!/(^|\.)amazon\.(?:de|com|co\.uk|fr|it|es|nl|pl|se|be)$/i.test(url.hostname)) return '';
      const pathMatch = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?=\/|$)/i);
      const asinValue = pathMatch?.[1] || url.searchParams.get('asin') || url.searchParams.get('ASIN') || '';
      return recoveryAsin(asinValue);
    } catch {
      return '';
    }
  }

  function resolveRecoverySku(payload) {
    // Use only IDs associated with the product currently loaded in this extension.
    // A title, a random search result or an eBay offer number is never an identity.
    const product = typeof state === 'object' && state ? state.product : null;
    const asinField = typeof document !== 'undefined' ? document.getElementById('asin')?.value : '';
    const known = [
      recoveryAsin(payload?.sku),
      recoveryAsin(payload?.sourceProductId),
      recoveryAsin(asinField),
      recoveryAsin(product?.asin),
      recoveryAsinFromUrl(product?.url)
    ].filter(Boolean);
    const distinct = [...new Set(known)];
    if (distinct.length > 1) {
      return { sku: '', error: 'Die Amazon-ASIN ist widersprüchlich (z. B. anderer Artikel oder Variante). Bitte die richtige Amazon-Produktseite erneut einlesen. Kein eBay-Entwurf wurde verändert.' };
    }
    if (!distinct.length) {
      return { sku: '', error: 'Keine gültige Amazon-ASIN gefunden. Bitte die richtige Amazon-Produktseite erneut einlesen oder das ASIN-Feld mit der 10-stelligen Kennung ausfüllen. Es wurde kein Entwurf erstellt.' };
    }
    return { sku: 'AMZ-' + distinct[0], error: '' };
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
    return key ? readDraftTasks()[key] || null : null;
  }


  // Kept only in this popup session. Server candidates are read from the
  // authenticated eBay account; local entries are never trusted as proof.
  let recoveryCandidates = [];

  function recoveryChoicesFromLocalTasks() {
    return Object.values(readDraftTasks())
      .filter((entry) => entry && /^[A-Za-z0-9_-]{3,220}$/.test(String(entry.taskId || ''))
        && /^AMZ-[A-Z0-9]{10}$/.test(String(entry.sku || '').toUpperCase()))
      .map((entry) => ({
        taskId: String(entry.taskId).trim(),
        sku: String(entry.sku).toUpperCase(),
        title: 'Gespeicherter Amazon-Entwurf',
        feedType: String(entry.feedType || '').toUpperCase(),
      }));
  }

  function selectedRecoveryChoice() {
    const selector = document.getElementById('elyonRecoveryDraftChoice');
    const value = String(selector?.value || '');
    if (!/^\d{1,2}$/.test(value)) return null;
    const candidate = recoveryCandidates[Number(value)];
    return candidate && /^AMZ-[A-Z0-9]{10}$/.test(candidate.sku) && candidate.taskId
      ? candidate : null;
  }

  function showRecoveryChoices(candidates) {
    const button = document.getElementById('syncSellerHubDraft');
    if (!button) return;
    const known = new Set();
    recoveryCandidates = candidates
      .filter((item) => item && /^AMZ-[A-Z0-9]{10}$/.test(String(item.sku || '').toUpperCase())
        && /^[A-Za-z0-9_-]{3,220}$/.test(String(item.taskId || '')))
      .map((item) => ({
        sku: String(item.sku).toUpperCase(),
        taskId: String(item.taskId),
        title: String(item.title || 'Amazon-Entwurf').slice(0, 100),
      })).filter((item) => {
        const key = item.sku + ':' + item.taskId;
        if (known.has(key)) return false;
        known.add(key);
        return true;
      }).slice(0, 12);
    let label = document.getElementById('elyonRecoveryDraftLabel');
    if (!label) {
      label = document.createElement('label');
      label.id = 'elyonRecoveryDraftLabel';
      label.style.display = 'block';
      label.style.margin = '8px 0';
      label.style.fontSize = '12px';
      label.textContent = 'Vorhandenen eBay-Entwurf auswählen';
      const select = document.createElement('select');
      select.id = 'elyonRecoveryDraftChoice';
      select.style.width = '100%';
      select.style.marginTop = '5px';
      label.appendChild(select);
      button.insertAdjacentElement('afterend', label);
    }
    const select = document.getElementById('elyonRecoveryDraftChoice');
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Bitte einen Entwurf auswählen …';
    select.appendChild(placeholder);
    recoveryCandidates.forEach((item, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = item.title + ' · ' + item.sku;
      select.appendChild(option);
    });
    label.style.display = 'block';
  }

  async function recoverSelectedTask(session, payload, candidate) {
    // Verify the selected task and its original uploaded CSV/SKU at eBay.
    // Never creates or uploads another Draft.
    const response = await requestSellerAction(session, 'recover-draft',
      feedTaskLookup(payload, candidate.taskId, candidate.sku));
    if (!response.ok || response.body?.ok !== true) {
      setStatus(response.body?.message || 'Dieser Entwurf konnte nicht sicher zugeordnet werden. Kein neuer Entwurf erstellt.', 'warn');
      return;
    }
    rememberDraftTask(payload, response.body);
    const selectorLabel = document.getElementById('elyonRecoveryDraftLabel');
    if (selectorLabel) selectorLabel.style.display = 'none';
    setStatus(statusTextFromTask(response.body), draftSyncTone(response.body));
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
    if (body?.feedConfirmed === true || (body?.feedConfirmed == null && body?.draftVisible === true)) {
      const sync = body?.registration?.persisted === true
        ? '\nIm ELYON Seller Tool als Feed-Entwurf registriert (Bestand im Seller Hub separat prüfen).'
        : '\nELYON-Synchronisierung nicht bestätigt. Bitte „Vorhandenen Entwurf abgleichen“ verwenden.';
      const referenceStates = {
        reference_recorded: 'Amazon-Preisreferenz nachweislich in Company OS gespeichert ✅ (noch kein bestätigter Lieferanten-EK).',
        reference_missing: 'Amazon-Preisreferenz nicht übertragen: Auf der Amazon-Produktseite erst den Preis erneut einlesen.',
        invalid_sku: 'Amazon-Preisreferenz nicht übertragen: Amazon-SKU fehlt oder ist ungültig.',
        review_not_found: 'Amazon-Preisreferenz nicht übertragen: Company OS findet keinen eindeutigen bestehenden Produktprüfungsdatensatz.',
        ambiguous: 'Amazon-Preisreferenz nicht übertragen: Mehrere Produktprüfungen passen zu dieser SKU.',
        authentication_failed: 'Amazon-Preisreferenz nicht übertragen: Serververbindung zu Company OS nicht autorisiert.',
        reference_invalid: 'Amazon-Preisreferenz nicht übertragen: Ungültiger Quellpreis.',
        reference_date_invalid: 'Amazon-Preisreferenz nicht übertragen: Datum der Preisbeobachtung ungültig.',
        confirmation_missing: 'Amazon-Preisreferenz nicht bestätigt: Company OS hat den gespeicherten Preis nicht eindeutig zurückgemeldet.',
        connection_invalid: 'Amazon-Preisreferenz nicht übertragen: Company-OS-Adresse ungültig.',
        connection_unavailable: 'Amazon-Preisreferenz nicht übertragen: Company-OS-Serververbindung derzeit nicht verfügbar.',
        update_failed: 'Amazon-Preisreferenz nicht übertragen: Company OS hat den Abgleich abgelehnt.'
      };
      const refState = String(body?.amazonReferenceSync?.state || '');
      const reference = body?.amazonReferenceSync
        ? '\n' + (referenceStates[refState] || 'Amazon-Preisreferenz-Übertragung konnte nicht bestätigt werden.')
        : '\nAmazon-Preisreferenz-Übertragung nicht geprüft (kein Synchronisierungsstatus vorhanden).';
      return 'eBay-Feed erfolgreich verarbeitet. Ob der Entwurf im Seller Hub sichtbar ist, wurde NICHT verifiziert. Bitte Angebote → Entwürfe öffnen und dort prüfen.' + sync + reference;
    }
    if (body?.complete === true && Number(body?.failureCount || 0) === 0) {
      return 'eBay-Feed beendet, aber ein erfolgreicher Eintrag ist nicht bestätigt. Bitte Seller Hub prüfen.';
    }
    if (status === 'COMPLETED_WITH_ERROR' || Number(body?.failureCount || 0) > 0) {
      const base = `eBay hat den Entwurf mit Fehlern verarbeitet. Erfolgreich: ${Number(body?.successCount || 0)} · Fehler: ${Number(body?.failureCount || 0)}.`;
      const details = sellerHubTaskErrorDetails(body);
      return details ? `${base}\n${details}` : base;
    }
    return `eBay-Entwurf wird verarbeitet …${body?.taskId ? `\nTask-ID: ${body.taskId}` : ''}\nDas kann bei eBay einige Minuten dauern.`;
  }

  function draftSyncTone(body) {
    if (body?.registration?.persisted !== true) return 'warn';
    // Persisted ELYON references still do not prove Seller Hub visibility.
    return body?.sellerHubVisibility === 'verified' ? 'ok' : 'warn';
  }

  function feedTaskLookup(payload, taskId, sku) {
    return {
      taskId: String(taskId || '').trim(),
      sku: String(sku || payload?.sku || '').trim(),
      sourceProductId: String(payload?.sourceProductId || '').trim(),
      title: String(payload?.title || '').trim(),
      price: Number(payload?.price || 0),
      amazonReferencePrice: Number(payload?.amazonReferencePrice || 0) > 0 ? Number(payload.amazonReferencePrice) : null,
      amazonReferenceCapturedAt: String(payload?.amazonReferenceCapturedAt || ''),
      currency: String(payload?.currency || 'EUR'),
      images: Array.isArray(payload?.images) ? payload.images.slice(0, 8) : [],
      environment: String(payload?.environment || 'production')
    };
  }

  async function checkSavedTask(session, payload, saved) {
    if (!saved?.taskId) return null;
    const response = await requestSellerAction(session, 'draft-status', feedTaskLookup(payload, saved.taskId, saved.sku));
    if (!response.ok) {
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
        if (body.feedConfirmed !== true && Number(body.failureCount || 0) > 0 && Number(body.successCount || 0) === 0) {
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
    const categoryId = String(payload.categoryId || '').trim();
    if (!/^\d{2,10}$/.test(categoryId)) {
      setStatus('Für den eBay-Entwurf fehlt noch eine gültige eBay-Kategorie-ID.', 'err');
      return;
    }

    setStatus('eBay-Entwurf wird an Seller Hub übergeben …', 'warn');
    try {
      const session = await readSellerSession();
      const saved = savedDraftTask(payload);
      if (saved?.taskId) {
        const existing = await checkSavedTask(session, payload, saved);
        if (!existing) {
          setStatus('Der vorhandene eBay-Task konnte nicht geprüft werden. Es wurde kein neuer Entwurf angelegt. Bitte später erneut prüfen oder „Vorhandenen Entwurf mit ELYON abgleichen“ verwenden.', 'warn');
          return;
        }
        if (!existing.retryAllowed) {
          setStatus(statusTextFromTask(existing.body), 'warn');
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
      setStatus(statusTextFromTask(result), 'warn');
      const completed = await pollDraftTask(session, payload, result.taskId, result.sku);
      if (completed) {
        setStatus(statusTextFromTask(completed), Number(completed.failureCount || 0) > 0 ? 'err' : 'warn');
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
    const payload = built?.data || {};
    const identity = resolveRecoverySku(payload);
    let chosen = null;
    if (identity.error) {
      if (!identity.error.startsWith('Keine gültige Amazon-ASIN gefunden.')) {
        setStatus(identity.error, 'warn');
        return; // Conflicting ASINs are never bypassed by recovered candidates.
      }
      chosen = selectedRecoveryChoice();
      if (!chosen) {
        setStatus('Keine ASIN mehr im Popup – vorhandene eBay-Draft-Tasks werden gelesen …', 'warn');
        try {
          const session = await readSellerSession();
          const response = await requestSellerAction(session, 'list-draft-recovery-candidates',
            { environment: 'production' });
          const server = response.ok && Array.isArray(response.body?.candidates)
            ? response.body.candidates : [];
          const available = [...recoveryChoicesFromLocalTasks(), ...server];
          const deduped = [...new Map(available.filter((candidate) =>
            /^AMZ-[A-Z0-9]{10}$/.test(String(candidate.sku || '').toUpperCase())
            && /^[A-Za-z0-9_-]{3,220}$/.test(String(candidate.taskId || '')))
            .map((candidate) => [String(candidate.sku).toUpperCase() + ':' + candidate.taskId, candidate])).values()];
          if (!deduped.length) {
            setStatus((response.body?.message || '') +
              '\nKein bestehender eBay-Draft mit verifizierbarer Amazon-SKU gefunden. Bitte die ursprüngliche Amazon-Produktseite öffnen oder ihre ASIN eingeben. Es wurde nichts verändert.', 'warn');
            return;
          }
          if (deduped.length > 1) {
            showRecoveryChoices(deduped);
            setStatus('Es wurden mehrere frühere Entwürfe gefunden. Bitte den richtigen Entwurf im Auswahlfeld markieren und nochmals „Vorhandenen Entwurf mit ELYON abgleichen“ klicken. Es wird nichts neu angelegt.', 'warn');
            return;
          }
          chosen = deduped[0];
        } catch (error) {
          setStatus('Draft-Suche fehlgeschlagen: ' + String(error?.message || 'unbekannt') +
            '. Bitte die ursprüngliche Amazon-Produktseite öffnen. Kein neuer Entwurf erstellt.', 'warn');
          return;
        }
      }
    }
    const verifiedSku = chosen ? String(chosen.sku).toUpperCase() : identity.sku;
    const originalSource = recoveryAsin(payload.sourceProductId);
    const recoveryPayload = chosen ? {
      sku: verifiedSku,
      sourceProductId: 'amazon:' + verifiedSku.slice(4),
      environment: 'production',
      amazonReferencePrice: null,
      amazonReferenceCapturedAt: ''
    } : {
      ...payload,
      sku: verifiedSku,
      sourceProductId: originalSource === verifiedSku.slice(4)
        ? payload.sourceProductId
        : 'amazon:' + verifiedSku.slice(4)
    };
    if (chosen) {
      setStatus('Ausgewählten bestehenden eBay-Task sicher überprüfen und zuordnen …', 'warn');
      try {
        const session = await readSellerSession();
        await recoverSelectedTask(session, recoveryPayload, chosen);
      } catch (error) {
        setStatus('Abgleich fehlgeschlagen: ' + String(error?.message || 'unbekannt') +
          '. Kein neuer eBay-Entwurf erstellt.', 'warn');
      }
      return;
    }
    const key = sourceKey(recoveryPayload);
    const savedTasks = readDraftTasks();
    const saved = (key && savedTasks[key]) || (sourceKey(payload) && savedTasks[sourceKey(payload)]) || null;
    if (!saved?.taskId) {
      // The original Chrome extension may have been replaced and lost localStorage.
      // Search only authenticated eBay FX_DRAFT / legacy FX_LISTING history by exact SKU.
      // This action is read-only towards eBay; no new draft can be created.
      setStatus('Keine lokale Task-ID gefunden. Suche vorhandenen eBay-Feed anhand der SKU …', 'warn');
      try {
        const session = await readSellerSession();
        const response = await requestSellerAction(session, 'recover-draft', feedTaskLookup(recoveryPayload, '', identity.sku));
        if (!response.ok || response.body?.ok !== true) {
          setStatus(response.body?.message || 'Kein passender Feed-Task gefunden. Es wurde kein neuer Entwurf erstellt.', 'warn');
          return;
        }
        // The normal draft recovery is independent from the optional batch collector.
        // Only the verified eBay task is cached; no new draft or batch update is needed.
        rememberDraftTask(recoveryPayload, response.body);
        setStatus(statusTextFromTask(response.body), draftSyncTone(response.body));
      } catch (error) {
        setStatus('eBay-Feed-Wiederherstellung fehlgeschlagen: ' + String(error?.message || 'Unbekannter Fehler'), 'err');
      }
      return;
    }
    setStatus('Vorhandenen eBay-Feed-Task prüfen und mit ELYON synchronisieren …', 'warn');
    try {
      const session = await readSellerSession();
      const result = await checkSavedTask(session, recoveryPayload, saved);
      if (!result) {
        setStatus('Der gespeicherte eBay-Task konnte nicht geprüft werden. Kein neuer eBay-Entwurf wurde angelegt.', 'warn');
        return;
      }
      setStatus(statusTextFromTask(result.body), draftSyncTone(result.body));
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
    if (mainSub) mainSub.textContent = 'Per eBay-Feed – im Seller Hub prüfen';

    ['prepareDraftEbay', 'prepareDraft'].forEach((id) => {
      const button = document.getElementById(id);
      if (!button) return;
      button.disabled = false;
      button.textContent = 'eBay-Entwurf';
      button.title = 'Sendet einen unveröffentlichten FX_DRAFT-Feed an eBay. Die Sichtbarkeit im Seller Hub muss danach geprüft werden.';
    });
    if (mainButton) {
      mainButton.disabled = false;
      mainButton.title = 'Sendet einen unveröffentlichten FX_DRAFT-Feed an eBay. Die Sichtbarkeit im Seller Hub muss danach geprüft werden.';
    }

    const ebayButton = document.getElementById('prepareDraftEbay');
    const card = ebayButton?.closest('.card');
    const note = card?.querySelector('p.small');
    if (note) {
      note.textContent = 'Der Button übermittelt einen unveröffentlichten FX_DRAFT-Feed an eBay. Eine erfolgreiche Feed-Verarbeitung ist noch kein Beweis für einen sichtbaren Entwurf: Bitte anschließend unter Angebote → Entwürfe prüfen.';
    }

    const draftButton = document.getElementById('prepareDraftEbay');
    if (draftButton && !document.getElementById('syncSellerHubDraft')) {
      const sync = document.createElement('button');
      sync.id = 'syncSellerHubDraft';
      sync.type = 'button';
      sync.className = 'btn';
      sync.textContent = '🔄 Vorhandenen Entwurf mit ELYON abgleichen';
      sync.title = 'Gleicht einen bestehenden eBay-Feed-Task ab; falls die lokale Task-ID fehlt, erfolgt die Suche anhand der SKU in der eBay-Feed-Historie. Erstellt keinen neuen Entwurf.';
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

