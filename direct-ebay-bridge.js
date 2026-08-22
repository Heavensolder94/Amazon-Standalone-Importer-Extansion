(() => {
  'use strict';

  const SELLER_SESSION_COOKIE = 'elyon_seller_session';
  const SELLER_SESSION_HEADER = 'X-Elyon-Seller-Session';
  const SELLER_EXTENSION_ACTION_URL = 'https://elyonsellertool.vercel.app/api/ebay/extension-action';
  const SELLER_SESSION_ORIGINS = [
    'https://elyonsellertool.vercel.app/',
    'https://elyon-seller-tool.vercel.app/'
  ];

  async function readSellerSession() {
    if (!globalThis.chrome?.cookies) {
      throw new Error('Chrome-Cookie-Zugriff fehlt. Erweiterung bitte in chrome://extensions neu laden.');
    }

    for (const url of SELLER_SESSION_ORIGINS) {
      const cookie = await chrome.cookies.get({ url, name: SELLER_SESSION_COOKIE }).catch(() => null);
      if (cookie?.value) return cookie.value;
    }

    throw new Error(
      'Keine gültige Seller-Tool-Sitzung gefunden. Öffne das Seller Tool einmal, melde dich an und versuche den eBay-Entwurf danach erneut. Der Importer öffnet das Seller Tool nicht mehr automatisch.'
    );
  }

  async function directSellerLifecycleAction(action, requestData) {
    const session = await readSellerSession();
    const response = await fetch(SELLER_EXTENSION_ACTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [SELLER_SESSION_HEADER]: session
      },
      cache: 'no-store',
      body: JSON.stringify({ action, payload: requestData || {} })
    });

    const body = await response.json().catch(() => ({}));
    if (response.status === 403 && (body?.error === 'seller_access_denied' || body?.error === 'seller_extension_session_missing')) {
      body.message = body.message || 'Seller-Tool-Sitzung ist abgelaufen. Bitte einmal im Seller Tool neu anmelden.';
    }
    return { ok: response.ok, status: response.status, body };
  }

  sellerLifecycleAction = directSellerLifecycleAction;
})();
