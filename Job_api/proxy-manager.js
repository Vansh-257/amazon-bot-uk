const { HttpsProxyAgent } = require('https-proxy-agent');
const logger = require('./logger.js');
const { SETTINGS } = require('../config/configuration.js');

// Proxy lists in format: ip:port:username:password
const PROXY_LIST_1 = [
    '31.57.41.85:5661:rgoovxce:47pdi1mmiwtq',
    '92.112.137.3:5946:rgoovxce:47pdi1mmiwtq',
    '46.203.154.152:5595:rgoovxce:47pdi1mmiwtq',
];
const PROXY_LIST_2 = [
    '31.56.137.189:6265:rgoovxce:47pdi1mmiwtq',
    '92.112.137.76:6019:rgoovxce:47pdi1mmiwtq',
    '46.203.157.61:7004:rgoovxce:47pdi1mmiwtq',
];
const PROXY_LIST_3 = [
    '31.57.41.253:5829:rgoovxce:47pdi1mmiwtq',
    '31.57.82.162:6743:rgoovxce:47pdi1mmiwtq',
    '46.203.157.80:7023:rgoovxce:47pdi1mmiwtq',
];
const PROXY_LIST_4 = [
    '31.56.137.189:6265:rgoovxce:47pdi1mmiwtq',
    '31.57.42.177:6447:rgoovxce:47pdi1mmiwtq',
    '46.203.157.219:7162:rgoovxce:47pdi1mmiwtq',
];
const PROXY_LIST_5 = [
    '46.203.154.225:5668:rgoovxce:47pdi1mmiwtq',
    '31.56.137.238:6314:rgoovxce:47pdi1mmiwtq',
    '46.203.157.107:7050:rgoovxce:47pdi1mmiwtq',
];

const PROXY_LISTS = [
    PROXY_LIST_1,
    PROXY_LIST_2,
    PROXY_LIST_3,
    PROXY_LIST_4,
    PROXY_LIST_5,
];

class ProxyManager {
    constructor() {
        this.currentListIndex = 0;
        this.proxyList = PROXY_LISTS[this.currentListIndex];
        this.currentIndex = 0;
        this.proxyCache = new Map(); // Cache proxy agents
        this.failedRequestsCount = 0;
        logger.info(`🔧 ProxyManager initialized with List ${this.currentListIndex + 1} (${this.proxyList.length} proxies)`);
    }

    /**
     * Parse proxy string (ip:port:username:password) to HTTP proxy URL
     * @param {string} proxyString - Proxy in format ip:port:username:password
     * @returns {string} - HTTP proxy URL
     */
    parseProxy(proxyString) {
        try {
            const parts = proxyString.split(':');
            if (parts.length !== 4) {
                throw new Error(`Invalid proxy format: ${proxyString}. Expected format: ip:port:username:password`);
            }
            const [ip, port, username, password] = parts;
            return `http://${username}:${password}@${ip}:${port}`;
        } catch (error) {
            logger.error(`❌ Error parsing proxy ${proxyString}: ${error.message}`);
            return null;
        }
    }

    /**
     * Get next proxy in sequential order (round-robin)
     * @param {boolean} silent - If true, skip logging (for batch operations)
     * @returns {string|null} - Proxy URL or null if no proxies available
     */
    getNextProxy(silent = false) {
        if (this.proxyList.length === 0) {
            logger.error('❌ No proxies available in proxy list');
            return null;
        }

        const proxyString = this.proxyList[this.currentIndex];
        const proxyUrl = this.parseProxy(proxyString);

        // Move to next proxy (round-robin)
        this.currentIndex = (this.currentIndex + 1) % this.proxyList.length;

        if (proxyUrl && !silent) {
            logger.info(`🔄 Using proxy: ${proxyString.split(':')[0]}:${proxyString.split(':')[1]} (Index: ${this.currentIndex === 0 ? this.proxyList.length - 1 : this.currentIndex - 1})`);
        }

        return proxyUrl;
    }

    /**
     * Get proxy agent for fetch requests
     * @param {string} proxyUrl - Proxy URL
     * @returns {HttpsProxyAgent|null} - Proxy agent or null
     */
    getProxyAgent(proxyUrl) {
        if (!proxyUrl) {
            return null;
        }

        // Use cache to avoid creating multiple agents for same proxy
        if (this.proxyCache.has(proxyUrl)) {
            return this.proxyCache.get(proxyUrl);
        }

        try {
            const agent = new HttpsProxyAgent(proxyUrl);
            this.proxyCache.set(proxyUrl, agent);
            return agent;
        } catch (error) {
            logger.error(`❌ Error creating proxy agent for ${proxyUrl}: ${error.message}`);
            return null;
        }
    }

    /**
     * Get proxy URL string (for WebSocket)
     * @param {string} proxyString - Proxy in format ip:port:username:password
     * @returns {string|null} - Proxy URL or null
     */
    getProxyUrl(proxyString) {
        return this.parseProxy(proxyString);
    }

    /**
     * Get current proxy index (for tracking)
     * @returns {number} - Current proxy index
     */
    getCurrentIndex() {
        return this.currentIndex === 0 ? this.proxyList.length - 1 : this.currentIndex - 1;
    }

    /**
     * Get proxy count
     * @returns {number} - Number of available proxies
     */
    getProxyCount() {
        return this.proxyList.length;
    }

    /**
     * Report a failed request to the proxy manager and switch list if the threshold consecutive failures hit
     */
    reportFailure() {
        const threshold = SETTINGS.PROXY_RETRY_COUNT || 10;
        this.failedRequestsCount++;
        logger.warn(`⚠️ ProxyManager tracking failure ${this.failedRequestsCount}/${threshold}`);
        if (this.failedRequestsCount >= threshold) {
            this.switchList();
        }
    }

    /**
     * Report a successful request - resets failure count
     */
    reportSuccess() {
        if (this.failedRequestsCount > 0) {
            this.failedRequestsCount = 0;
        }
    }

    /**
     * Switch to the next available proxy list
     */
    switchList() {
        const threshold = SETTINGS.PROXY_RETRY_COUNT || 10;
        this.currentListIndex = (this.currentListIndex + 1) % PROXY_LISTS.length;
        this.proxyList = PROXY_LISTS[this.currentListIndex];
        this.currentIndex = 0; // Reset index to beginning of new list
        this.failedRequestsCount = 0; // Reset consecutive failures
        this.proxyCache.clear(); // Clear cache for new list
        logger.info(`🔄 Switched to Proxy List ${this.currentListIndex + 1} (${this.proxyList.length} proxies) after ${threshold} failures`);
    }

    /**
     * Reset proxy rotation to start
     */
    reset() {
        this.currentIndex = 0;
        logger.info('🔄 Proxy rotation reset to start');
    }
}

// Create singleton instance
const proxyManager = new ProxyManager();

module.exports = {
    proxyManager,
    ProxyManager,
};
