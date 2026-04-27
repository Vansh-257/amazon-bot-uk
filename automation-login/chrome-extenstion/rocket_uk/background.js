const SERVER_URL = 'http://localhost:3010/token';
const COOKIE_NAME = 'aws-waf-token';
const COOKIE_URL = 'https://auth.hiring.amazon.com';

async function postToken(token, source) {
  if (!token || typeof token !== 'string') return;
  try {
    const res = await fetch(SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        source: source,
        capturedAt: new Date().toISOString()
      })
    });
    const body = await res.json().catch(() => ({}));
    console.log('[rocket_uk:bg] POST', source, '->', res.status, body);
  } catch (err) {
    console.warn('[rocket_uk:bg] failed to POST token:', err && err.message);
  }
}

async function readAndPostCookie() {
  try {
    const cookie = await chrome.cookies.get({
      url: COOKIE_URL,
      name: COOKIE_NAME
    });
    if (cookie && cookie.value) {
      await postToken(cookie.value, 'cookie');
    }
  } catch (err) {
    console.warn('[rocket_uk] cookie read failed:', err && err.message);
  }
}

chrome.runtime.onMessage.addListener(function (msg) {
  if (!msg || !msg.type) return;
  if (msg.type === 'TOKEN_FROM_NETWORK') {
    postToken(msg.token, msg.source || 'network');
    // The mp_verify response often comes with a Set-Cookie that updates
    // aws-waf-token; re-read so we capture both forms.
    readAndPostCookie();
  } else if (msg.type === 'READ_COOKIE') {
    readAndPostCookie();
  }
});

// React to cookie changes for aws-waf-token on the auth domain.
chrome.cookies.onChanged.addListener(function (info) {
  if (!info || !info.cookie) return;
  if (info.cookie.name !== COOKIE_NAME) return;
  if (info.removed) return;

  const domain = (info.cookie.domain || '').toLowerCase();
  // Match the exact host or any parent that would include auth.hiring.amazon.com.
  const hostMatches =
    domain === 'auth.hiring.amazon.com' ||
    domain === '.auth.hiring.amazon.com' ||
    domain === '.hiring.amazon.com' ||
    domain === '.amazon.com';
  if (!hostMatches) return;

  if (info.cookie.value) {
    postToken(info.cookie.value, 'cookie');
  }
});

console.log('[rocket_uk] background service worker ready');
