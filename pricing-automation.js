(() => {
  'use strict';

  const KEYS = {
    enabled: 'elyon_amazon_importer_auto_pricing_enabled',
    targetMargin: 'elyon_amazon_importer_target_margin_percent',
    minProfit: 'elyon_amazon_importer_min_profit_eur',
    feePercent: 'elyon_amazon_importer_ebay_fee_percent',
    fixedFee: 'elyon_amazon_importer_ebay_fixed_fee_eur',
    rounding: 'elyon_amazon_importer_price_rounding'
  };

  const DEFAULTS = {
    enabled: true,
    targetMargin: 20,
    minProfit: 5,
    feePercent: 12,
    fixedFee: 0.35,
    rounding: '99'
  };

  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };

  function readSettings() {
    const storedRounding = String(localStorage.getItem(KEYS.rounding) || DEFAULTS.rounding);
    return {
      enabled: localStorage.getItem(KEYS.enabled) !== '0',
      targetMargin: clamp(localStorage.getItem(KEYS.targetMargin), 0, 70, DEFAULTS.targetMargin),
      minProfit: clamp(localStorage.getItem(KEYS.minProfit), 0, 500, DEFAULTS.minProfit),
      feePercent: clamp(localStorage.getItem(KEYS.feePercent), 0, 40, DEFAULTS.feePercent),
      fixedFee: clamp(localStorage.getItem(KEYS.fixedFee), 0, 50, DEFAULTS.fixedFee),
      rounding: ['99', '49', 'cent'].includes(storedRounding) ? storedRounding : DEFAULTS.rounding
    };
  }

  function roundSalePrice(value, mode = '99') {
    const price = Math.max(0, Number(value) || 0);
    if (mode === 'cent') return Math.ceil((price - 1e-9) * 100) / 100;
    const ending = mode === '49' ? 0.49 : 0.99;
    let candidate = Math.floor(price) + ending;
    if (candidate + 1e-9 < price) candidate += 1;
    return Math.round(candidate * 100) / 100;
  }

  function calculateSalePrice(buyPrice, settings = readSettings()) {
    const buy = Math.max(0, Number(buyPrice) || 0);
    if (!(buy > 0)) return { price: 0, rawPrice: 0, reason: 'no_buy_price' };

    const feeRate = settings.feePercent / 100;
    const marginRate = settings.targetMargin / 100;
    const feeBase = 1 - feeRate;
    const marginBase = 1 - feeRate - marginRate;
    if (feeBase <= 0 || marginBase <= 0) return { price: 0, rawPrice: 0, reason: 'invalid_rules' };

    const byMargin = (buy + settings.fixedFee) / marginBase;
    const byProfit = (buy + settings.fixedFee + settings.minProfit) / feeBase;
    const rawPrice = Math.max(byMargin, byProfit);
    const price = roundSalePrice(rawPrice, settings.rounding);
    return {
      price,
      rawPrice,
      byMargin,
      byProfit,
      reason: byProfit >= byMargin ? 'min_profit' : 'target_margin'
    };
  }

  function formatMoney(value) {
    return Number(value || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
  }

  function currentElements() {
    return {
      buy: document.getElementById('buyPrice'),
      sell: document.getElementById('sellPrice'),
      fees: document.getElementById('fees'),
      profit: document.getElementById('profit'),
      profitBox: document.getElementById('profitBox'),
      marginChip: document.getElementById('marginChip')
    };
  }

  function renderPriceMetrics() {
    const elements = currentElements();
    if (!elements.buy || !elements.sell) return;
    const settings = readSettings();
    const buy = Number(elements.buy.value) || 0;
    const sell = Number(elements.sell.value) || 0;
    const fees = sell * (settings.feePercent / 100) + settings.fixedFee;
    const profit = sell - buy - fees;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;
    if (elements.fees) elements.fees.textContent = formatMoney(fees);
    if (elements.profit) elements.profit.textContent = formatMoney(profit);
    if (elements.profitBox) elements.profitBox.className = `price ${profit >= 0 ? 'profit' : 'loss'}`;
    if (elements.marginChip) elements.marginChip.textContent = sell ? `${margin.toFixed(1)} %` : 'Berechnen';

    const hint = document.getElementById('autoPricingHint');
    if (hint) {
      hint.textContent = settings.enabled
        ? `Preisautomatik aktiv · Ziel ${settings.targetMargin.toFixed(0)} % Marge · mindestens ${formatMoney(settings.minProfit)} Gewinn · Gebühren ${settings.feePercent.toFixed(1).replace('.0', '')} % + ${formatMoney(settings.fixedFee)}.`
        : `Preisautomatik aus · Gebührenrechnung ${settings.feePercent.toFixed(1).replace('.0', '')} % + ${formatMoney(settings.fixedFee)}.`;
    }
  }

  function applyAutoPrice(options = {}) {
    const settings = readSettings();
    const elements = currentElements();
    if (!elements.buy || !elements.sell) return null;
    if (!settings.enabled && !options.force) {
      renderPriceMetrics();
      return null;
    }
    const calculation = calculateSalePrice(Number(elements.buy.value) || 0, settings);
    if (!(calculation.price > 0)) {
      renderPriceMetrics();
      return calculation;
    }
    elements.sell.value = calculation.price.toFixed(2);
    elements.sell.dataset.autoPrice = '1';
    renderPriceMetrics();
    return calculation;
  }

  function persistFromUi() {
    const enabled = document.getElementById('enableAutoPricing');
    const targetMargin = document.getElementById('targetMarginPercent');
    const minProfit = document.getElementById('minimumProfitEur');
    const feePercent = document.getElementById('pricingFeePercent');
    const fixedFee = document.getElementById('pricingFixedFee');
    const rounding = document.getElementById('pricingRounding');
    if (!enabled) return;

    localStorage.setItem(KEYS.enabled, enabled.checked ? '1' : '0');
    localStorage.setItem(KEYS.targetMargin, String(clamp(targetMargin?.value, 0, 70, DEFAULTS.targetMargin)));
    localStorage.setItem(KEYS.minProfit, String(clamp(minProfit?.value, 0, 500, DEFAULTS.minProfit)));
    localStorage.setItem(KEYS.feePercent, String(clamp(feePercent?.value, 0, 40, DEFAULTS.feePercent)));
    localStorage.setItem(KEYS.fixedFee, String(clamp(fixedFee?.value, 0, 50, DEFAULTS.fixedFee)));
    localStorage.setItem(KEYS.rounding, ['99', '49', 'cent'].includes(rounding?.value) ? rounding.value : DEFAULTS.rounding);

    applyAutoPrice();
    updateSettingsSummary();
  }

  function updateSettingsSummary() {
    const summary = document.getElementById('pricingSettingsSummary');
    if (!summary) return;
    const settings = readSettings();
    const rounding = settings.rounding === '99' ? 'auf .99' : settings.rounding === '49' ? 'auf .49' : 'auf Cent';
    summary.textContent = settings.enabled
      ? `Aktiv: ${settings.targetMargin.toFixed(0)} % Zielmarge oder mindestens ${formatMoney(settings.minProfit)} Gewinn – es gilt der höhere nötige Verkaufspreis. Rundung ${rounding}.`
      : 'Deaktiviert: Verkaufspreise werden nicht automatisch überschrieben.';
  }

  function field(labelText, input) {
    const wrapper = document.createElement('div');
    wrapper.className = 'field';
    const label = document.createElement('label');
    label.textContent = labelText;
    wrapper.append(label, input);
    return wrapper;
  }

  function numberInput(id, value, min, max, step) {
    const input = document.createElement('input');
    input.id = id;
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    return input;
  }

  function createSettingsUi() {
    if (document.getElementById('pricingSettingsBlock')) return;
    const designerBlock = document.getElementById('designerSettingsBlock');
    const settingsSheet = document.querySelector('#settings .sheet');
    if (!settingsSheet) return;
    const settings = readSettings();

    const block = document.createElement('div');
    block.id = 'pricingSettingsBlock';
    block.className = 'settingBlock integrationSetting';

    const head = document.createElement('div');
    head.className = 'integrationSettingHead';
    const copy = document.createElement('div');
    const heading = document.createElement('h3');
    heading.textContent = 'Preisautomatik';
    const intro = document.createElement('p');
    intro.textContent = 'Verkaufspreis automatisch aus Einkaufspreis, Marge und Mindestgewinn berechnen';
    copy.append(heading, intro);
    const chip = document.createElement('span');
    chip.className = 'chip green';
    chip.textContent = 'AUTO';
    head.append(copy, chip);

    const toggle = document.createElement('label');
    toggle.className = 'confirmRow';
    const checkbox = document.createElement('input');
    checkbox.id = 'enableAutoPricing';
    checkbox.type = 'checkbox';
    checkbox.checked = settings.enabled;
    const toggleText = document.createElement('span');
    toggleText.textContent = 'Nach jedem Amazon-Import den eBay-Verkaufspreis automatisch einsetzen.';
    toggle.append(checkbox, toggleText);

    const row1 = document.createElement('div');
    row1.className = 'grid2';
    row1.append(
      field('Zielmarge %', numberInput('targetMarginPercent', settings.targetMargin, 0, 70, 1)),
      field('Mindestgewinn €', numberInput('minimumProfitEur', settings.minProfit, 0, 500, 0.5))
    );

    const row2 = document.createElement('div');
    row2.className = 'grid2';
    row2.append(
      field('eBay-Gebühr %', numberInput('pricingFeePercent', settings.feePercent, 0, 40, 0.1)),
      field('Feste Gebühr €', numberInput('pricingFixedFee', settings.fixedFee, 0, 50, 0.01))
    );

    const rounding = document.createElement('select');
    rounding.id = 'pricingRounding';
    [['99', 'Auf .99 aufrunden'], ['49', 'Auf .49 aufrunden'], ['cent', 'Auf nächsten Cent aufrunden']].forEach(([value, label]) => {
      const option = new Option(label, value);
      rounding.appendChild(option);
    });
    rounding.value = settings.rounding;

    const summary = document.createElement('div');
    summary.id = 'pricingSettingsSummary';
    summary.className = 'note blueNote';

    block.append(head, toggle, row1, row2, field('Preisrundung', rounding), summary);
    if (designerBlock?.parentElement === settingsSheet) settingsSheet.insertBefore(block, designerBlock);
    else settingsSheet.appendChild(block);

    ['enableAutoPricing', 'targetMarginPercent', 'minimumProfitEur', 'pricingFeePercent', 'pricingFixedFee', 'pricingRounding'].forEach((id) => {
      const element = document.getElementById(id);
      element?.addEventListener(element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input', persistFromUi);
    });
    updateSettingsSummary();
  }

  function createPriceHint() {
    if (document.getElementById('autoPricingHint')) return;
    const card = document.getElementById('priceCard');
    if (!card) return;
    const existingNote = [...card.querySelectorAll('p.small')].pop();
    const note = document.createElement('p');
    note.id = 'autoPricingHint';
    note.className = 'small strong';
    if (existingNote) card.insertBefore(note, existingNote);
    else card.appendChild(note);
    renderPriceMetrics();
  }

  function installHooks() {
    try {
      if (typeof calc === 'function') {
        calc = function pricingAwareCalc() {
          renderPriceMetrics();
        };
      }
    } catch {}

    try {
      if (typeof fill === 'function' && !fill.__elyonPricingWrapped) {
        const originalFill = fill;
        const wrappedFill = function pricingAwareFill(product) {
          const result = originalFill(product);
          applyAutoPrice();
          return result;
        };
        wrappedFill.__elyonPricingWrapped = true;
        fill = wrappedFill;
      }
    } catch {}

    const buy = document.getElementById('buyPrice');
    const sell = document.getElementById('sellPrice');
    buy?.addEventListener('input', () => applyAutoPrice());
    sell?.addEventListener('input', () => {
      sell.dataset.autoPrice = '0';
      renderPriceMetrics();
    });
  }

  function init() {
    createSettingsUi();
    createPriceHint();
    installHooks();
    renderPriceMetrics();
  }

  globalThis.calculateElyonSalePrice = calculateSalePrice;
  globalThis.getElyonPricingSettings = readSettings;
  globalThis.applyElyonAutoPrice = applyAutoPrice;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
