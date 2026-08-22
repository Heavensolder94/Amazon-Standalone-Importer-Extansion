(() => {
  'use strict';

  const SELLER_HUB_DRAFTS_URL = 'https://www.ebay.de/sh/lst/drafts';
  let lastToastKey = '';
  let lastToastAt = 0;

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
    let actionLabel = '';
    let actionUrl = '';

    if (/eBay-Entwurf erstellt|Verkäufer-Cockpit.*Entwürfe|Angebote\s*→\s*Entwürfe/i.test(raw)) {
      title = 'eBay-Entwurf erstellt';
      message = message || 'Der Entwurf ist im Seller Hub unter Angebote → Entwürfe verfügbar.';
      actionLabel = 'Entwürfe öffnen';
      actionUrl = SELLER_HUB_DRAFTS_URL;
    } else if (/deepseek/i.test(raw) && kind !== 'error') {
      title = 'DeepSeek fertig';
      message = message || 'Titel und Beschreibung wurden optimiert. Bitte den Inhalt vor dem eBay-Entwurf prüfen.';
    } else if (/produkt importiert/i.test(raw)) {
      title = 'Amazon-Produkt importiert';
      message = message || 'Die Produktdaten wurden in den Arbeitsentwurf übernommen.';
    }

    return { title, message, actionLabel, actionUrl };
  }

  function tabToastRenderer(payload) {
    const HOST_ID = 'elyonImporterTabToastHost';
    const MAX_TOASTS = 3;
    const doc = document;
    let host = doc.getElementById(HOST_ID);
    let root;

    if (!host) {
      host = doc.createElement('div');
      host.id = HOST_ID;
      host.style.position = 'fixed';
      host.style.top = '16px';
      host.style.right = '16px';
      host.style.zIndex = '2147483647';
      host.style.width = 'min(360px, calc(100vw - 32px))';
      host.style.pointerEvents = 'none';
      host.style.contain = 'layout style';
      (doc.documentElement || doc.body).appendChild(host);
      root = host.attachShadow({ mode: 'open' });

      const style = doc.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .stack {
          display: grid;
          gap: 10px;
          width: 100%;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          pointer-events: none;
        }
        .toast {
          position: relative;
          box-sizing: border-box;
          display: grid;
          grid-template-columns: 38px minmax(0, 1fr) auto;
          gap: 10px;
          align-items: start;
          width: 100%;
          padding: 13px 12px;
          border: 1px solid rgba(15, 23, 42, .14);
          border-left-width: 4px;
          border-radius: 13px;
          background: rgba(255,255,255,.98);
          box-shadow: 0 16px 44px rgba(15,23,42,.24);
          color: #111827;
          transform: translateX(calc(100% + 34px));
          opacity: 0;
          transition: transform .28s cubic-bezier(.2,.8,.2,1), opacity .2s ease;
          pointer-events: auto;
          overflow: hidden;
        }
        .toast.show { transform: translateX(0); opacity: 1; }
        .toast.hide { transform: translateX(calc(100% + 34px)); opacity: 0; }
        .toast.success { border-left-color: #16a34a; }
        .toast.ai { border-left-color: #7c3aed; }
        .toast.error { border-left-color: #dc2626; }
        .icon {
          box-sizing: border-box;
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
        .success .icon { background:#dcfce7; color:#15803d; }
        .ai .icon { background:#ede9fe; color:#6d28d9; }
        .error .icon { background:#fee2e2; color:#b91c1c; }
        .body { min-width: 0; color: #111827; }
        .title {
          margin: 0;
          font-size: 13px;
          font-weight: 800;
          line-height: 1.3;
          color: #111827;
        }
        .message {
          margin: 4px 0 0;
          font-size: 12px;
          line-height: 1.45;
          color: #4b5563;
          white-space: pre-line;
          overflow-wrap: anywhere;
        }
        .actions { display:flex; flex-wrap:wrap; gap:7px; margin-top:9px; }
        .action {
          appearance:none;
          border:0;
          border-radius:8px;
          padding:7px 9px;
          font:inherit;
          font-size:11px;
          font-weight:750;
          cursor:pointer;
          background:#111827;
          color:#fff;
        }
        .close {
          appearance:none;
          box-sizing:border-box;
          width:27px;
          height:27px;
          border:0;
          border-radius:8px;
          cursor:pointer;
          background:transparent;
          color:#6b7280;
          font-size:19px;
          line-height:1;
          padding:0;
        }
        .close:hover { background:#f3f4f6; color:#111827; }
        .progress {
          position:absolute;
          left:0;
          bottom:0;
          height:3px;
          width:100%;
          transform-origin:left center;
          opacity:.16;
        }
        .success .progress { background:#15803d; }
        .ai .progress { background:#6d28d9; }
        .error .progress { background:#b91c1c; }
        @media (prefers-reduced-motion: reduce) {
          .toast { transition: opacity .12s ease; transform:none; }
          .toast.show, .toast.hide { transform:none; }
        }
      `;
      const stack = doc.createElement('div');
      stack.className = 'stack';
      stack.setAttribute('aria-live', 'polite');
      root.append(style, stack);
    } else {
      root = host.shadowRoot;
    }

    if (!root) return;
    const stack = root.querySelector('.stack');
    if (!stack) return;
    while (stack.children.length >= MAX_TOASTS) stack.firstElementChild?.remove();

    const kind = ['success', 'ai', 'error'].includes(payload?.kind) ? payload.kind : 'success';
    const duration = Math.max(2500, Number(payload?.duration || (kind === 'error' ? 12000 : 7000)));
    const toast = doc.createElement('article');
    toast.className = `toast ${kind}`;
    toast.setAttribute('role', kind === 'error' ? 'alert' : 'status');

    const icon = doc.createElement('div');
    icon.className = 'icon';
    icon.textContent = kind === 'error' ? '!' : kind === 'ai' ? '✨' : '✓';

    const body = doc.createElement('div');
    body.className = 'body';
    const heading = doc.createElement('p');
    heading.className = 'title';
    heading.textContent = String(payload?.title || (kind === 'error' ? 'Aktion fehlgeschlagen' : 'Erfolgreich'));
    body.appendChild(heading);

    const message = String(payload?.message || '').trim();
    if (message) {
      const detail = doc.createElement('p');
      detail.className = 'message';
      detail.textContent = message;
      body.appendChild(detail);
    }

    const actionUrl = String(payload?.actionUrl || '').trim();
    const actionLabel = String(payload?.actionLabel || '').trim();
    if (/^https:\/\//i.test(actionUrl) && actionLabel) {
      const actions = doc.createElement('div');
      actions.className = 'actions';
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'action';
      button.textContent = actionLabel;
      button.addEventListener('click', () => {
        try { window.open(actionUrl, '_blank', 'noopener'); } catch {}
        closeToast();
      });
      actions.appendChild(button);
      body.appendChild(actions);
    }

    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.setAttribute('aria-label', 'Benachrichtigung schließen');
    close.textContent = '×';

    const progress = doc.createElement('div');
    progress.className = 'progress';
    progress.style.transition = `transform ${duration}ms linear`;

    let timer = 0;
    function closeToast() {
      if (toast.dataset.closing === '1') return;
      toast.dataset.closing = '1';
      window.clearTimeout(timer);
      toast.classList.remove('show');
      toast.classList.add('hide');
      window.setTimeout(() => {
        toast.remove();
        if (!stack.children.length) host?.remove();
      }, 320);
    }

    close.addEventListener('click', closeToast);
    toast.append(icon, body, close, progress);
    stack.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('show');
      requestAnimationFrame(() => { progress.style.transform = 'scaleX(0)'; });
    });

    timer = window.setTimeout(closeToast, duration);
    toast.addEventListener('mouseenter', () => {
      window.clearTimeout(timer);
      progress.style.transition = 'none';
    });
    toast.addEventListener('mouseleave', () => {
      timer = window.setTimeout(closeToast, 2200);
    });
  }

  async function showToast(options = {}) {
    const kind = ['success', 'ai', 'error'].includes(options.kind) ? options.kind : 'success';
    const title = String(options.title || '').trim() || (kind === 'error' ? 'Aktion fehlgeschlagen' : 'Erfolgreich');
    const message = String(options.message || '').trim();
    const duration = Math.max(2500, Number(options.duration || (kind === 'error' ? 12000 : 7000)));
    const actionLabel = String(options.actionLabel || options.action?.label || '').trim();
    const actionUrl = String(options.actionUrl || options.action?.url || '').trim();
    const key = `${kind}|${title}|${message}`;
    const now = Date.now();
    if (key === lastToastKey && now - lastToastAt < 1500) return null;
    lastToastKey = key;
    lastToastAt = now;

    if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return null;

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = String(tab?.url || '');
      if (!tab?.id || !/^https?:\/\//i.test(url)) return null;
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: tabToastRenderer,
        args: [{ kind, title, message, duration, actionLabel, actionUrl }]
      });
      return true;
    } catch {
      // Auf Chrome-internen/restriktiven Seiten kann nichts injiziert werden.
      // Der normale Status in der Extension bleibt trotzdem erhalten.
      return null;
    }
  }

  function notifyStatus(text, cls) {
    const kind = classify(text, cls);
    if (!kind) return;
    const content = toastContent(text, kind);
    void showToast({ kind, ...content });
  }

  const originalSetStatus = typeof globalThis.setStatus === 'function'
    ? globalThis.setStatus
    : (typeof setStatus === 'function' ? setStatus : null);

  if (originalSetStatus) {
    const wrappedSetStatus = function elyonTabToastAwareSetStatus(text, cls = '') {
      const result = originalSetStatus(text, cls);
      notifyStatus(text, cls);
      return result;
    };
    try { globalThis.setStatus = wrappedSetStatus; } catch {}
    try { setStatus = wrappedSetStatus; } catch {}
  }

  globalThis.showElyonToast = showToast;
})();
