(() => {
  'use strict';

  const STORAGE_KEY = 'elyon_amazon_importer_ebay_description_theme';
  const DRAFT_TASKS_STORAGE_KEY = 'elyon_amazon_importer_seller_hub_draft_tasks_v1';
  const MIGRATION_KEY = 'elyon_amazon_importer_description_design_migration_v1210';
  const THEMES = [
    ['auto', 'Automatisch passend'],
    ['signature', 'Elyon Signature'],
    ['nordic', 'Nordic Light'],
    ['carbon', 'Carbon Pro'],
    ['compact', 'Mobile Compact'],
    ['clean', 'Clean'],
    ['tech', 'Tech Blue'],
    ['home', 'Home Natural'],
    ['fashion', 'Fashion'],
    ['outdoor', 'Outdoor'],
    ['plain', 'Ohne Design · nur Text']
  ];

  const originalDraftPayload = typeof globalThis.draftPayload === 'function'
    ? globalThis.draftPayload
    : (typeof draftPayload === 'function' ? draftPayload : null);

  function selectedTheme() {
    const value = document.getElementById('ebayDescriptionTheme')?.value || localStorage.getItem(STORAGE_KEY) || 'auto';
    return THEMES.some(([key]) => key === value) ? value : 'auto';
  }

  function currentDraftTaskKey() {
    try {
      const payload = originalDraftPayload?.();
      return String(payload?.sourceProductId || payload?.sku || payload?.title || '').trim();
    } catch {
      return '';
    }
  }

  function forgetCurrentDraftTask() {
    const key = currentDraftTaskKey();
    if (!key) return;
    try {
      const tasks = JSON.parse(localStorage.getItem(DRAFT_TASKS_STORAGE_KEY) || '{}');
      if (!tasks || typeof tasks !== 'object' || Array.isArray(tasks) || !(key in tasks)) return;
      delete tasks[key];
      localStorage.setItem(DRAFT_TASKS_STORAGE_KEY, JSON.stringify(tasks));
    } catch {}
  }

  // v1.2.10: one-time reset so products drafted before visual descriptions can be
  // submitted once more with the new HTML design instead of reusing the old task.
  try {
    if (localStorage.getItem(MIGRATION_KEY) !== '1') {
      localStorage.removeItem(DRAFT_TASKS_STORAGE_KEY);
      localStorage.setItem(MIGRATION_KEY, '1');
    }
  } catch {}

  function installPicker() {
    if (document.getElementById('ebayDescriptionTheme')) return;
    const description = document.getElementById('description');
    const descriptionField = description?.closest('.field');
    if (!descriptionField) return;

    const field = document.createElement('div');
    field.className = 'field';

    const label = document.createElement('label');
    label.htmlFor = 'ebayDescriptionTheme';
    label.textContent = 'eBay Beschreibungsdesign';

    const select = document.createElement('select');
    select.id = 'ebayDescriptionTheme';
    for (const [value, text] of THEMES) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    select.value = selectedTheme();
    select.addEventListener('change', () => {
      localStorage.setItem(STORAGE_KEY, select.value);
      forgetCurrentDraftTask();
    });

    const note = document.createElement('p');
    note.className = 'small';
    note.textContent = 'Das gewählte Elyon-Design wird beim echten Seller-Hub-Entwurf als HTML-Beschreibung verwendet. „Automatisch passend“ wählt das Design anhand von Titel und Kategorie.';

    field.append(label, select, note);
    descriptionField.insertAdjacentElement('afterend', field);
  }

  if (originalDraftPayload) {
    const themedDraftPayload = function themedDraftPayload() {
      const payload = originalDraftPayload();
      const theme = selectedTheme();
      return {
        ...payload,
        useDescriptionDesign: theme !== 'plain',
        descriptionTheme: theme === 'plain' ? '' : theme
      };
    };
    try { globalThis.draftPayload = themedDraftPayload; } catch {}
    try { draftPayload = themedDraftPayload; } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installPicker, { once: true });
  } else {
    installPicker();
  }
})();
