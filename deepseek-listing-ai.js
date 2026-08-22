(() => {
  'use strict';

  const AUTO_KEY = 'elyon_amazon_importer_deepseek_auto';
  const STRENGTH_KEY = 'elyon_amazon_importer_deepseek_strength';
  const DRAFT_TASKS_STORAGE_KEY = 'elyon_amazon_importer_seller_hub_draft_tasks_v1';
  let aiRunning = false;

  const value = (id) => String(document.getElementById(id)?.value || '').trim();

  function autoAiEnabled() {
    return localStorage.getItem(AUTO_KEY) !== '0';
  }

  function aiStrength() {
    const stored = Number(document.getElementById('deepseekStrength')?.value || localStorage.getItem(STRENGTH_KEY) || 55);
    return Math.max(0, Math.min(100, Number.isFinite(stored) ? stored : 55));
  }

  function parseSpecifics() {
    try {
      const parsed = JSON.parse(value('ebayItemSpecifics') || '{}');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function productForAi() {
    const product = (typeof state !== 'undefined' && state?.product) ? state.product : {};
    return {
      source: 'amazon',
      asin: value('asin') || product.asin || '',
      title: product.title || value('title'),
      brand: product.brand || value('brand'),
      description: product.description || '',
      bullets: Array.isArray(product.bullets) ? product.bullets.slice(0, 12) : [],
      details: product.details && typeof product.details === 'object' ? product.details : {},
      variations: product.variations && typeof product.variations === 'object' ? product.variations : {},
      breadcrumbs: Array.isArray(product.breadcrumbs) ? product.breadcrumbs.slice(0, 12) : [],
    };
  }

  function draftForAi() {
    return {
      title: value('title'),
      description: value('description'),
      longDescription: value('description'),
      brand: value('brand'),
      department: value('department'),
      style: value('style'),
      material: value('material'),
      modelNumber: value('modelNumber'),
      categoryId: value('ebayCategoryId'),
      condition: value('ebayCondition'),
      itemSpecifics: parseSpecifics(),
      buyPrice: Number(value('buyPrice')) || 0,
      sellPrice: Number(value('sellPrice')) || 0,
    };
  }

  function composeDescription(result = {}) {
    const shortDescription = String(result.shortDescription || '').trim();
    const longDescription = String(result.longDescription || '').trim();
    const chunks = [];

    if (shortDescription && !longDescription.toLocaleLowerCase('de-DE').includes(shortDescription.toLocaleLowerCase('de-DE'))) {
      chunks.push(shortDescription);
    }
    if (longDescription) chunks.push(longDescription);

    const features = Array.isArray(result.features) ? result.features : [];
    const featureLines = features
      .map((entry) => {
        const title = String(entry?.title || '').trim();
        const text = String(entry?.text || '').trim();
        if (!title && !text) return '';
        return `• ${title && text ? `${title}: ${text}` : (title || text)}`;
      })
      .filter(Boolean)
      .slice(0, 8);
    if (featureLines.length) chunks.push(`Vorteile:\n${featureLines.join('\n')}`);

    const packageContents = String(result.packageContents || '').trim();
    if (packageContents) chunks.push(`Lieferumfang:\n${packageContents}`);

    const importantNotes = String(result.importantNotes || '').trim();
    if (importantNotes) chunks.push(`Hinweise:\n${importantNotes}`);

    return chunks.join('\n\n').trim().slice(0, 16000);
  }

  function invalidateCurrentDraftTask() {
    const asin = value('asin');
    const key = asin ? `amazon:${asin}` : '';
    if (key) {
      try {
        const tasks = JSON.parse(localStorage.getItem(DRAFT_TASKS_STORAGE_KEY) || '{}');
        if (tasks && typeof tasks === 'object' && key in tasks) {
          delete tasks[key];
          localStorage.setItem(DRAFT_TASKS_STORAGE_KEY, JSON.stringify(tasks));
        }
      } catch {}
    }
    try {
      if (typeof state !== 'undefined') state.ebayDraft = null;
    } catch {}
  }

  function setAiNote(text, kind = 'neutral') {
    const note = document.getElementById('deepseekAiNote');
    if (!note) return;
    note.textContent = text;
    note.className = kind === 'ok' ? 'note blueNote' : kind === 'err' ? 'note goldNote' : 'small';
  }

  function applyAiResult(result = {}, body = {}) {
    const nextTitle = String(result.title || '').trim().slice(0, 80);
    const nextDescription = composeDescription(result);
    if (nextTitle) document.getElementById('title').value = nextTitle;
    if (nextDescription) document.getElementById('description').value = nextDescription;

    const rights = document.getElementById('contentRightsConfirmed');
    if (rights) rights.checked = false;
    invalidateCurrentDraftTask();

    const warnings = Array.isArray(result.warnings) ? result.warnings.filter(Boolean).slice(0, 3) : [];
    const model = String(body.model || 'deepseek-chat');
    setAiNote(
      warnings.length
        ? `DeepSeek (${model}) fertig. Bitte prüfen: ${warnings.join(' · ')}`
        : `DeepSeek (${model}) hat Titel und Beschreibung optimiert. Vor dem eBay-Entwurf bitte Inhalt erneut prüfen.`,
      'ok'
    );

    try {
      if (typeof setDesignerStep === 'function') setDesignerStep('copy', 'ok', 'DeepSeek: Titel & Beschreibung optimiert');
      const chip = document.getElementById('designerChip');
      if (chip) {
        chip.className = 'chip green';
        chip.textContent = 'KI ✓';
      }
    } catch {}
  }

  async function runDeepSeekListingAi(options = {}) {
    const automatic = options.automatic === true;
    if (aiRunning) return false;
    if (!productForAi().asin && !(typeof state !== 'undefined' && state?.product)) {
      if (!automatic && typeof setStatus === 'function') setStatus('Erst ein Amazon-Produkt importieren.', 'err');
      return false;
    }
    if (typeof sellerLifecycleAction !== 'function') {
      setAiNote('DeepSeek konnte nicht gestartet werden: Seller-Brücke ist nicht bereit.', 'err');
      return false;
    }

    aiRunning = true;
    const button = document.getElementById('deepseekOptimize');
    if (button) {
      button.disabled = true;
      button.textContent = '✨ DeepSeek arbeitet …';
    }
    setAiNote('DeepSeek optimiert den Listing-Text faktengebunden …');

    try {
      const response = await sellerLifecycleAction('listing-ai', {
        product: productForAi(),
        draft: draftForAi(),
        strength: aiStrength(),
      });
      const body = response?.body || {};
      if (!response?.ok || body.ok === false || !body.result) {
        throw new Error(body.message || body.error || `DeepSeek-Anfrage fehlgeschlagen${response?.status ? ` (HTTP ${response.status})` : ''}.`);
      }
      applyAiResult(body.result, body);
      if (typeof setStatus === 'function') {
        setStatus('DeepSeek hat Titel und Beschreibung optimiert. Bitte vor dem eBay-Entwurf prüfen.', 'ok');
      }
      return true;
    } catch (error) {
      const message = String(error?.message || 'DeepSeek-Optimierung fehlgeschlagen.').trim();
      setAiNote(`DeepSeek nicht angewendet: ${message}`, 'err');
      if (!automatic && typeof setStatus === 'function') setStatus(`DeepSeek-Optimierung fehlgeschlagen. ${message}`, 'err');
      return false;
    } finally {
      aiRunning = false;
      if (button) {
        button.disabled = false;
        button.textContent = '✨ Mit DeepSeek optimieren';
      }
    }
  }

  function installAiControls() {
    if (document.getElementById('deepseekListingAiField')) return;
    const description = document.getElementById('description');
    const descriptionField = description?.closest('.field');
    if (!descriptionField) return;
    const designField = document.getElementById('ebayDescriptionTheme')?.closest('.field');
    const anchor = designField || descriptionField;

    const field = document.createElement('div');
    field.className = 'field';
    field.id = 'deepseekListingAiField';

    const label = document.createElement('label');
    label.textContent = 'DeepSeek Listing-KI';

    const controls = document.createElement('div');
    controls.className = 'grid2';

    const button = document.createElement('button');
    button.id = 'deepseekOptimize';
    button.type = 'button';
    button.className = 'btn violet';
    button.textContent = '✨ Mit DeepSeek optimieren';
    button.addEventListener('click', () => runDeepSeekListingAi({ automatic: false }));

    const strength = document.createElement('select');
    strength.id = 'deepseekStrength';
    [
      ['30', 'Konservativ'],
      ['55', 'Ausgewogen'],
      ['75', 'Verkaufsstärker'],
    ].forEach(([optionValue, text]) => {
      const option = document.createElement('option');
      option.value = optionValue;
      option.textContent = text;
      strength.appendChild(option);
    });
    const storedStrength = String(localStorage.getItem(STRENGTH_KEY) || '55');
    strength.value = ['30', '55', '75'].includes(storedStrength) ? storedStrength : '55';
    strength.addEventListener('change', () => localStorage.setItem(STRENGTH_KEY, strength.value));

    controls.append(button, strength);

    const autoLabel = document.createElement('label');
    autoLabel.className = 'confirmRow';
    const auto = document.createElement('input');
    auto.id = 'deepseekAuto';
    auto.type = 'checkbox';
    auto.checked = autoAiEnabled();
    auto.addEventListener('change', () => localStorage.setItem(AUTO_KEY, auto.checked ? '1' : '0'));
    const autoText = document.createElement('span');
    autoText.textContent = 'Nach dem automatischen Listing Designer auch DeepSeek für Titel und Beschreibung ausführen.';
    autoLabel.append(auto, autoText);

    const note = document.createElement('p');
    note.id = 'deepseekAiNote';
    note.className = 'small';
    note.textContent = 'Verwendet denselben serverseitigen DeepSeek-Generator wie der Seller Tool Listing Designer. Fehlende Fakten werden nicht erfunden.';

    field.append(label, controls, autoLabel, note);
    anchor.insertAdjacentElement('afterend', field);
  }

  const originalDesigner = typeof runAutomaticListingDesigner === 'function' ? runAutomaticListingDesigner : null;
  if (originalDesigner) {
    const wrappedDesigner = async function deepSeekAwareListingDesigner(options = {}) {
      const result = await originalDesigner(options);
      if (autoAiEnabled() && typeof state !== 'undefined' && state?.product) {
        await runDeepSeekListingAi({ automatic: true });
      }
      return result;
    };
    try { runAutomaticListingDesigner = wrappedDesigner; } catch {}
    try { globalThis.runAutomaticListingDesigner = wrappedDesigner; } catch {}
  }

  try { globalThis.runDeepSeekListingAi = runDeepSeekListingAi; } catch {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installAiControls, { once: true });
  } else {
    installAiControls();
  }
})();
