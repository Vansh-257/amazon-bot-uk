(function () {
  if (window.__ROCKET_UK_INJECTED__) return;
  window.__ROCKET_UK_INJECTED__ = true;

  const LOG = '[rocket_uk:injected]';

  // Match any URL we want to scrape a token out of. AWS WAF token flow uses
  // both `inputs?client=browser` and `mp_verify` on *.awswaf.com — both can
  // return a JSON body that contains a `token` field, so we look at every
  // awswaf.com response.
  function isInteresting(url) {
    if (!url) return false;
    const u = String(url);
    return u.indexOf('awswaf.com') !== -1 || u.indexOf('mp_verify') !== -1;
  }

  function emit(token, source, url) {
    if (!token) return;
    try {
      window.postMessage(
        {
          __rocketUkToken: true,
          token: String(token),
          source: source,
          url: url || ''
        },
        '*'
      );
      console.log(LOG, 'emitted token from', source, 'len=' + String(token).length);
    } catch (e) {
      console.warn(LOG, 'postMessage failed:', e && e.message);
    }
  }

  // Walk an arbitrary value and collect every string field named `token`.
  // The mp_verify body is documented as { token, inputs:null } but we handle
  // any shape so we don't miss nested variants.
  function collectTokens(value, out) {
    if (value == null) return;
    if (typeof value === 'string') return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) collectTokens(value[i], out);
      return;
    }
    if (typeof value === 'object') {
      for (const k in value) {
        const v = value[k];
        if (k === 'token' && typeof v === 'string' && v.length > 0) {
          out.push(v);
        } else if (v && typeof v === 'object') {
          collectTokens(v, out);
        }
      }
    }
  }

  function handleResponseText(text, source, url) {
    if (!text) {
      console.log(LOG, 'empty body for', url);
      return;
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.log(
        LOG,
        'non-JSON body (' + text.length + ' chars) for',
        url,
        'preview:',
        text.slice(0, 120)
      );
      return;
    }
    const tokens = [];
    collectTokens(data, tokens);
    if (tokens.length === 0) {
      console.log(
        LOG,
        'JSON had no `token` field for',
        url,
        'keys=',
        data && typeof data === 'object' ? Object.keys(data) : typeof data
      );
      return;
    }
    for (const t of tokens) emit(t, source, url);
  }

  // ---- Patch fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function patchedFetch() {
      const args = arguments;
      let url = '';
      try {
        url =
          typeof args[0] === 'string'
            ? args[0]
            : args[0] && args[0].url
            ? args[0].url
            : '';
      } catch (_) {}

      const promise = origFetch.apply(this, args);

      if (isInteresting(url)) {
        console.log(LOG, 'fetch ->', url);
        promise
          .then(function (response) {
            try {
              response
                .clone()
                .text()
                .then(function (text) {
                  handleResponseText(text, 'fetch', url);
                })
                .catch(function (e) {
                  console.warn(LOG, 'clone().text() failed for', url, e && e.message);
                });
            } catch (e) {
              console.warn(LOG, 'clone failed for', url, e && e.message);
            }
          })
          .catch(function () {
            // network errors — ignore
          });
      }
      return promise;
    };
  }

  // ---- Patch XMLHttpRequest ----
  const OrigXHR = window.XMLHttpRequest;
  if (OrigXHR) {
    const origOpen = OrigXHR.prototype.open;
    const origSend = OrigXHR.prototype.send;

    OrigXHR.prototype.open = function (method, url) {
      try {
        this.__rocketUkUrl = url;
      } catch (_) {}
      return origOpen.apply(this, arguments);
    };

    OrigXHR.prototype.send = function () {
      try {
        const url = this.__rocketUkUrl;
        if (isInteresting(url)) {
          console.log(LOG, 'xhr ->', url);
          this.addEventListener('load', function () {
            try {
              handleResponseText(this.responseText, 'xhr', url);
            } catch (e) {
              console.warn(LOG, 'xhr handler failed for', url, e && e.message);
            }
          });
        }
      } catch (_) {}
      return origSend.apply(this, arguments);
    };
  }

  console.log(LOG, 'patches installed in', location.href);
})();
