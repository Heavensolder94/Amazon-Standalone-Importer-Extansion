(() => {
  'use strict';

  const currentSetStatus = typeof globalThis.setStatus === 'function'
    ? globalThis.setStatus
    : (typeof setStatus === 'function' ? setStatus : null);
  if (!currentSetStatus) return;

  const batchAwareSetStatus = function batchAwareSetStatus(text, cls = '') {
    const statusClass = String(cls || '').toLowerCase();
    const isBatchSummary = /massenimport|sammelmodus/i.test(String(text || ''));
    if (globalThis.__elyonBatchPreparing === true && statusClass.includes('ok') && !isBatchSummary) {
      // Toast-System reagiert nur auf ok/error. Während eines Batchlaufs bleiben
      // einzelne DeepSeek-Erfolge deshalb im Status sichtbar, ohne 20 Toasts zu stapeln.
      return currentSetStatus(text, 'warn');
    }
    return currentSetStatus(text, cls);
  };

  try { globalThis.setStatus = batchAwareSetStatus; } catch {}
  try { setStatus = batchAwareSetStatus; } catch {}
})();
