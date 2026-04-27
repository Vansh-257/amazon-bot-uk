// Configuration settings for Amazon UK
const SETTINGS = {
    UK: true,
    // Polling interval in seconds. 0.2s = 200ms.
    INTERVAL: 0.2,
    // Consecutive failures before ProxyManager switches to the next proxy list.
    PROXY_RETRY_COUNT: 10,
};

module.exports = { SETTINGS };
