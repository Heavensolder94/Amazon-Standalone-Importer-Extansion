(async () => {
  const response = await fetch(chrome.runtime.getURL('popup.html'), { cache: 'no-store' });
  if (!response.ok) throw new Error(`popup.html konnte nicht geladen werden (HTTP ${response.status}).`);

  const marker = '<script src="popup.js"></script>';
  let html = await response.text();
  if (!html.includes(marker)) throw new Error('popup.js Script-Marker fehlt in popup.html.');

  html = html.replace(marker, `${marker}\n<script src="image-fix.js"></script>\n<script src="category-fix.js"></script>\n<script src="workflow-fix.js"></script>\n<script src="description-design-fix.js"></script>\n<script src="item-specifics-autofill.js"></script>\n<script src="direct-ebay-bridge.js"></script>`);
  document.open();
  document.write(html);
  document.close();
})().catch((error) => {
  document.body.textContent = `Elyon Amazon Importer konnte nicht gestartet werden: ${error.message}`;
});
