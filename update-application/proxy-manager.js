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
        this.proxyCache = new Map();
        this.failedRequestsCount = 0;
        logger.info(`🔧 ProxyManager initialized with List ${this.currentListIndex + 1} (${this.proxyList.length} proxies)`);
    }

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

    getNextProxy(silent = false) {
        if (this.proxyList.length === 0) {
            logger.error('❌ No proxies available in proxy list');
            return null;
        }

        const proxyString = this.proxyList[this.currentIndex];
        const proxyUrl = this.parseProxy(proxyString);

        this.currentIndex = (this.currentIndex + 1) % this.proxyList.length;

        if (proxyUrl && !silent) {
            logger.info(`🔄 Using proxy: ${proxyString.split(':')[0]}:${proxyString.split(':')[1]} (Index: ${this.currentIndex === 0 ? this.proxyList.length - 1 : this.currentIndex - 1})`);
        }

        return proxyUrl;
    }

    getProxyAgent(proxyUrl) {
        if (!proxyUrl) return null;

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

    getProxyUrl(proxyString) {
        return this.parseProxy(proxyString);
    }

    getCurrentIndex() {
        return this.currentIndex === 0 ? this.proxyList.length - 1 : this.currentIndex - 1;
    }

    getProxyCount() {
        return this.proxyList.length;
    }

    reportFailure() {
        const threshold = SETTINGS.PROXY_RETRY_COUNT || 10;
        this.failedRequestsCount++;
        logger.warn(`⚠️ ProxyManager tracking failure ${this.failedRequestsCount}/${threshold}`);
        if (this.failedRequestsCount >= threshold) {
            this.switchList();
        }
    }

    reportSuccess() {
        if (this.failedRequestsCount > 0) {
            this.failedRequestsCount = 0;
        }
    }

    switchList() {
        const threshold = SETTINGS.PROXY_RETRY_COUNT || 10;
        this.currentListIndex = (this.currentListIndex + 1) % PROXY_LISTS.length;
        this.proxyList = PROXY_LISTS[this.currentListIndex];
        this.currentIndex = 0;
        this.failedRequestsCount = 0;
        this.proxyCache.clear();
        logger.info(`🔄 Switched to Proxy List ${this.currentListIndex + 1} (${this.proxyList.length} proxies) after ${threshold} failures`);
    }

    reset() {
        this.currentIndex = 0;
        logger.info('🔄 Proxy rotation reset to start');
    }
}

const proxyManager = new ProxyManager();

module.exports = { proxyManager, ProxyManager };
