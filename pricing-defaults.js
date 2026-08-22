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
})();
