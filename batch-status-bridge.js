(() => {
  'use strict';

  const currentSetStatus = typeof globalThis.setStatus === 'function'
    ? globalThis.setStatus
    : (typeof setStatus === 'function' ? setStatus : null);
  if (!currentSetStatus) return;

  const batchAwareSetStatus = function batchAwareSetStatus(text, cls = '') {
    const statusClass = String(cls || '').toLowerCase();
    if (globalThis.__elyonBatchPreparing === true && statusClass.includes('ok')) {
      // Toast-System reagiert auf ok/error. Während eines Batchlaufs bleiben
      // einzelne DeepSeek- und Designer-Erfolge im Status sichtbar, ohne Toast-Spam.
      // Der Batch selbst zeigt am Ende genau eine eigene Zusammenfassung an.
      return currentSetStatus(text, 'warn');
    }
    return currentSetStatus(text, cls);
  };

  try { globalThis.setStatus = batchAwareSetStatus; } catch {}
  try { setStatus = batchAwareSetStatus; } catch {}
})();
