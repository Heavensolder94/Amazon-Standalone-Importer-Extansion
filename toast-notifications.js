(() => {
  'use strict';

  const STACK_ID = 'elyonToastStack';
  const STYLE_ID = 'elyonToastStyles';
  const SELLER_HUB_DRAFTS_URL = 'https://www.ebay.de/sh/lst/drafts';
  const MAX_TOASTS = 3;
  let lastToastKey = '';
  let lastToastAt = 0;

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${STACK_ID} {
        position: fixed;
        top: 16px;
        right: 14px;
        z-index: 2147483647;
        width: min(360px, calc(100vw - 28px));
        display: grid;
        gap: 10px;
        pointer-events: none;
      }
      .elyonToast {
        position: relative;
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr) auto;
        gap: 10px;
        align-items: start;
        padding: 13px 12px;
        border: 1px solid rgba(15, 23, 42, .12);
        border-left-width: 4px;
        border-radius: 13px;
        background: rgba(255, 255, 255, .98);
        box-shadow: 0 14px 38px rgba(15, 23, 42, .22);
        color: #111827;
        transform: translateX(calc(100% + 34px));
        opacity: 0;
        transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s ease;
        pointer-events: auto;
        overflow: hidden;
      }
      .elyonToast.show { transform: translateX(0); opacity: 1; }
      .elyonToast.hide { transform: translateX(calc(100% + 34px)); opacity: 0; }
      .elyonToast.success { border-left-color: #16a34a; }
      .elyonToast.ai { border-left-color: #7c3aed; }
      .elyonToast.error { border-left-color: #dc2626; }
      .elyonToastIcon {
        width: 36px;
        height: 36px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        font-size: 19px;
        font-weight: 800;
        line-height: 1;
        background: #f3f4f6;
      }
      .elyonToast.success .elyonToastIcon { background: #dcfce7; color: #15803d; }
      .elyonToast.ai .elyonToastIcon { background: #ede9fe; color: #6d28d9; }
      .elyonToast.error .elyonToastIcon { background: #fee2e2; color: #b91c1c; }
      .elyonToastBody { min-width: 0; color: #111827; }
      .elyonToastTitle {
        margin: 0;
        font-size: 13px;
        font-weight: 800;
        line-height: 1.3;
      }
      .elyonToastMessage {
        margin: 4px 0 0;
        font-size: 12px;
        line-height: 1.45;
        color: #4b5563;
        white-space: pre-line;
        overflow-wrap: anywhere;
      }
      .elyonToastActions {
        display: flex;
        flex-wrap: wrap;
        gap: 7px;
        margin-top: 9px;
      }
      .elyonToastAction {
        appearance: none;
        border: 0;
        border-radius: 8px;
        padding: 7px 9px;
        font: inherit;
        font-size: 11px;
        font-weight: 750;
        cursor: pointer;
        background: #111827;
        color: #fff;
      }
      .elyonToastClose {
        appearance: none;
        width: 27px;
        height: 27px;
        border: 0;
        border-radius: 8px;
        cursor: pointer;
        background: transparent;
        color: #6b7280;
        font-size: 19px;
        line-height: 1;
      }
      .elyonToastClose:hover { background: #f3f4f6; color: #111827; }
      .elyonToastProgress {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 3px;
        width: 100%;
        transform-origin: left center;
        background: currentColor;
        opacity: .16;
      }
      .elyonToast.success { color: #15803d; }
      .elyonToast.ai { color: #6d28d9; }
      .elyonToast.error { color: #b91c1c; }
      @media (prefers-reduced-motion: reduce) {
        .elyonToast { transition: opacity .12s ease; transform: none; }
        .elyonToast.show, .elyonToast.hide { transform: none; }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureStack() {
    installStyles();
    let stack = document.getElementById(STACK_ID);
    if (stack) return stack;
    stack = document.createElement('div');
    stack.id = STACK_ID;
    stack.setAttribute('aria-live', 'polite');
    stack.setAttribute('aria-atomic', 'false');
    (document.body || document.documentElement).appendChild(stack);
    return stack;
  }

  function openUrl(url) {
    try {
      if (typeof globalThis.openTab === 'function') {
        globalThis.openTab(url);
        return;
      }
    } catch {}
    try { window.open(url, '_blank', 'noopener'); } catch {}
  }

  function scrollToDescription() {
    const description = document.getElementById('description');
    if (!description) return;
    description.scrollIntoView({ behavior: 'smooth', block: 'center' });
    try { description.focus({ preventScroll: true }); } catch {}
  }

  function classify(text, cls) {
    const raw = String(text || '');
    const statusClass = String(cls || '').toLowerCase();
    if (statusClass.includes('err') || statusClass.includes('error')) return 'error';
    if (statusClass.includes('ok')) return /deepseek/i.test(raw) ? 'ai' : 'success';
    return '';
  }

  function toastContent(text, kind) {
    const raw = String(text || '').trim();
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    let title = lines[0] || (kind === 'error' ? 'Aktion fehlgeschlagen' : 'Erfolgreich');
    let message = lines.slice(1).join('\n');
    let action = null;

    if (/eBay-Entwurf erstellt|Verkäufer-Cockpit.*Entwürfe|Angebote\s*→\s*Entwürfe/i.test(raw)) {
      title = 'eBay-Entwurf erstellt';
      message = message || 'Der Entwurf ist im Seller Hub unter Angebote → Entwürfe verfügbar.';
      action = { label: 'Entwürfe öffnen', run: () => openUrl(SELLER_HUB_DRAFTS_URL) };
    } else if (/deepseek/i.test(raw) && kind !== 'error') {
      title = 'DeepSeek fertig';
      message = message || 'Titel und Beschreibung wurden optimiert. Bitte den Inhalt vor dem eBay-Entwurf prüfen.';
      action = { label: 'Ergebnis ansehen', run: scrollToDescription };
    } else if (/produkt importiert/i.test(raw)) {
      title = 'Amazon-Produkt importiert';
      message = message || 'Die Produktdaten wurden in den Arbeitsentwurf übernommen.';
    }

    return { title, message, action };
  }

  function removeToast(toast) {
    if (!toast || toast.dataset.closing === '1') return;
    toast.dataset.closing = '1';
    toast.classList.remove('show');
    toast.classList.add('hide');
    window.setTimeout(() => toast.remove(), 300);
  }

  function showToast(options = {}) {
    const kind = ['success', 'ai', 'error'].includes(options.kind) ? options.kind : 'success';
    const title = String(options.title || '').trim() || (kind === 'error' ? 'Aktion fehlgeschlagen' : 'Erfolgreich');
    const message = String(options.message || '').trim();
    const action = options.action && typeof options.action.run === 'function' ? options.action : null;
    const duration = Math.max(2500, Number(options.duration || (kind === 'error' ? 12000 : 7000)));
    const key = `${kind}|${title}|${message}`;
    const now = Date.now();
    if (key === lastToastKey && now - lastToastAt < 1500) return null;
    lastToastKey = key;
    lastToastAt = now;

    const stack = ensureStack();
    while (stack.children.length >= MAX_TOASTS) stack.firstElementChild?.remove();

    const toast = document.createElement('article');
    toast.className = `elyonToast ${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const icon = document.createElement('div');
    icon.className = 'elyonToastIcon';
    icon.textContent = kind === 'error' ? '!' : kind === 'ai' ? '✨' : '✓';

    const body = document.createElement('div');
    body.className = 'elyonToastBody';
    const heading = document.createElement('p');
    heading.className = 'elyonToastTitle';
    heading.textContent = title;
    body.appendChild(heading);

    if (message) {
      const detail = document.createElement('p');
      detail.className = 'elyonToastMessage';
      detail.textContent = message;
      body.appendChild(detail);
    }

    if (action) {
      const actions = document.createElement('div');
      actions.className = 'elyonToastActions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'elyonToastAction';
      button.textContent = String(action.label || 'Öffnen');
      button.addEventListener('click', () => {
        try { action.run(); } finally { removeToast(toast); }
      });
      actions.appendChild(button);
      body.appendChild(actions);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'elyonToastClose';
    close.setAttribute('aria-label', 'Benachrichtigung schließen');
    close.textContent = '×';
    close.addEventListener('click', () => removeToast(toast));

    const progress = document.createElement('div');
    progress.className = 'elyonToastProgress';
    progress.style.transition = `transform ${duration}ms linear`;

    toast.append(icon, body, close, progress);
    stack.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
      requestAnimationFrame(() => { progress.style.transform = 'scaleX(0)'; });
    });

    let timer = window.setTimeout(() => removeToast(toast), duration);
    toast.addEventListener('mouseenter', () => {
      window.clearTimeout(timer);
      progress.style.transition = 'none';
    });
    toast.addEventListener('mouseleave', () => {
      timer = window.setTimeout(() => removeToast(toast), 2200);
    });
    return toast;
  }

  function notifyStatus(text, cls) {
    const kind = classify(text, cls);
    if (!kind) return;
    const content = toastContent(text, kind);
    showToast({ kind, ...content });
  }

  const originalSetStatus = typeof globalThis.setStatus === 'function'
    ? globalThis.setStatus
    : (typeof setStatus === 'function' ? setStatus : null);

  if (originalSetStatus) {
    const wrappedSetStatus = function elyonToastAwareSetStatus(text, cls = '') {
      const result = originalSetStatus(text, cls);
      notifyStatus(text, cls);
      return result;
    };
    try { globalThis.setStatus = wrappedSetStatus; } catch {}
    try { setStatus = wrappedSetStatus; } catch {}
  }

  globalThis.showElyonToast = showToast;
})();
