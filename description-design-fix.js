(() => {
  'use strict';

  const STORAGE_KEY = 'elyon_amazon_importer_ebay_description_theme';
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

  function selectedTheme() {
    const value = document.getElementById('ebayDescriptionTheme')?.value || localStorage.getItem(STORAGE_KEY) || 'auto';
    return THEMES.some(([key]) => key === value) ? value : 'auto';
  }

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
    });

    const note = document.createElement('p');
    note.className = 'small';
    note.textContent = 'Das gewählte Elyon-Design wird beim echten Seller-Hub-Entwurf als HTML-Beschreibung verwendet. „Automatisch passend“ wählt das Design anhand von Titel und Kategorie.';

    field.append(label, select, note);
    descriptionField.insertAdjacentElement('afterend', field);
  }

  const originalDraftPayload = typeof globalThis.draftPayload === 'function'
    ? globalThis.draftPayload
    : (typeof draftPayload === 'function' ? draftPayload : null);

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
