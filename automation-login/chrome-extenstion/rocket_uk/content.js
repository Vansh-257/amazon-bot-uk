// Bridge: page-world -> background service worker.
// injected.js (MAIN world) postMessages tokens; we forward via chrome.runtime.

(function () {
  if (window.__ROCKET_UK_BRIDGE__) return;
  window.__ROCKET_UK_BRIDGE__ = true;

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.__rocketUkToken !== true) return;
    if (!data.token) return;

    console.log('[rocket_uk:content] forwarding token from', data.source, 'url=', data.url);
    try {
      chrome.runtime.sendMessage({
        type: 'TOKEN_FROM_NETWORK',
        token: data.token,
        source: data.source || 'network'
      });
    } catch (e) {
      console.warn('[rocket_uk:content] sendMessage failed:', e && e.message);
    }
  });

  // Ask background to read the cookie once on load (covers the case
  // where the cookie was already set on a previous visit).
  try {
    chrome.runtime.sendMessage({ type: 'READ_COOKIE' });
  } catch (_) {}
})();
