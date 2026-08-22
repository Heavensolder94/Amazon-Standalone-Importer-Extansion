(() => {
  'use strict';

  const defaults = {
    elyon_amazon_importer_auto_pricing_enabled: '1',
    elyon_amazon_importer_target_margin_percent: '20',
    elyon_amazon_importer_min_profit_eur: '5',
    elyon_amazon_importer_ebay_fee_percent: '12',
    elyon_amazon_importer_ebay_fixed_fee_eur: '0.35',
    elyon_amazon_importer_price_rounding: '99'
  };

  for (const [key, value] of Object.entries(defaults)) {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
  }

  const updatePriceCardCopy = () => {
    const note = [...document.querySelectorAll('#priceCard p.small')]
      .find((element) => /Faustschätzung:/i.test(element.textContent || ''));
    if (note) {
      note.textContent = 'Gebühren, Gewinn und Marge werden mit deinen Preisautomatik-Einstellungen berechnet. Tatsächliche eBay-Gebühren können je Kategorie, Konto und Angebot abweichen.';
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updatePriceCardCopy, { once: true });
  else updatePriceCardCopy();
})();
