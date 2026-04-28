const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch').default;

const { API_CONFIG } = require('../config/api-config.js');
const { proxyManager } = require('./proxy-manager.js');
const logger = require('./logger.js');
const { sendTelegramMessage } = require('../telegram/sendMessage.js');
const { processSchedules } = require('../create-application/content.js');

const API_ENDPOINTS = API_CONFIG.API_ENDPOINTS_UK;
const HEADERS_CONFIG = API_CONFIG.HEADERS_CONFIG_UK;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 2-minute dedup window: skip a jobId if it was already dispatched within this window.
const DEDUP_WINDOW_MS = 2 * 60 * 1000;
const recentDispatches = new Map(); // jobId -> timestamp ms

// In-memory set of scheduleIds we've already sent to Telegram. The 2-min
// jobId dedup above stops us from re-fetching the same job too fast, but the
// same scheduleIds can still come back across windows — this layer keeps
// Telegram messages unique per scheduleId for the process lifetime.
const notifiedScheduleIds = new Set();

function shouldSkip(jobId) {
    const last = recentDispatches.get(jobId);
    if (last && Date.now() - last < DEDUP_WINDOW_MS) {
        return true;
    }
    recentDispatches.set(jobId, Date.now());
    return false;
}

// Periodic cleanup of dedup map so it doesn't grow forever.
setInterval(() => {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [jobId, ts] of recentDispatches) {
        if (ts < cutoff) recentDispatches.delete(jobId);
    }
}, 60 * 1000).unref();

function saveResponseFile(apiResponse, jobId) {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const id = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
    const filePath = path.join(dataDir, `${id}.json`);
    fs.writeFile(filePath, JSON.stringify(apiResponse, null, 2), 'utf8', (err) => {
        if (err) {
            logger.error(`❌ Error saving ${filePath} for ${jobId}: ${err.message}`);
        } else {
            logger.info(`✅ Saved schedule response for ${jobId} to ${filePath}`);
        }
    });
}

async function callScheduleAPI(jobId) {
    let proxyUrl = null;
    let proxyInfo = 'No Proxy';

    try {
        proxyUrl = proxyManager.getNextProxy(true);
        const proxyAgent = proxyManager.getProxyAgent(proxyUrl);
        proxyInfo = proxyUrl ? proxyUrl.split('@')[1] || proxyUrl : 'No Proxy';

        const apiUrl = API_ENDPOINTS.SCHEDULEAPI;
        const headers = HEADERS_CONFIG.SCHEDULEAPI_HEADERS;
        const body = HEADERS_CONFIG.SCHEDULEAPI_BODY(jobId);

        const startTime = Date.now();
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers,
            body,
            agent: proxyAgent,
        });
        const latency = Date.now() - startTime;

        logger.info(`📡 Schedule API [${jobId}] Status: ${response.status} | Latency: ${latency}ms (Proxy: ${proxyInfo})`);

        if (!response.ok) {
            proxyManager.reportFailure();
            logger.error(`❌ Schedule API HTTP error for ${jobId}: ${response.status} (Proxy: ${proxyInfo})`);
            sendTelegramMessage(
                `🚨 <b>UK Schedule API Error</b>\n<b>jobId:</b> ${jobId}\n<b>Status:</b> ${response.status}\n<b>Latency:</b> ${latency}ms\n<b>Proxy:</b> ${proxyInfo}`
            );
            return null;
        }

        proxyManager.reportSuccess();
        const data = await response.json();
        const scheduleCards = data?.data?.searchScheduleCards?.scheduleCards || [];

        if (scheduleCards.length > 0) {
            logger.info(`➕ Schedule API [${jobId}] returned ${scheduleCards.length} scheduleCards`);
            saveResponseFile(data, jobId);

            // Telegram-only dedup: skip schedules we've already notified about.
            const unseenSchedules = scheduleCards.filter(
                (sc) => sc && sc.scheduleId && !notifiedScheduleIds.has(sc.scheduleId)
            );
            const dupeCount = scheduleCards.length - unseenSchedules.length;

            if (unseenSchedules.length > 0) {
                unseenSchedules.forEach((sc) => notifiedScheduleIds.add(sc.scheduleId));

                // Clone & filter the response so the Telegram dump only carries
                // unseen scheduleCards, same shape as upstream.
                const filteredData = JSON.parse(JSON.stringify(data));
                if (filteredData?.data?.searchScheduleCards) {
                    filteredData.data.searchScheduleCards.scheduleCards = unseenSchedules;
                }

                const apiText = JSON.stringify(filteredData, null, 2);
                const chunkSize = 3500;
                const totalParts = Math.ceil(apiText.length / chunkSize);
                for (let i = 0; i < apiText.length; i += chunkSize) {
                    const chunk = apiText.slice(i, i + chunkSize);
                    const partNum = Math.floor(i / chunkSize) + 1;
                    sendTelegramMessage(
                        `<b>📅 UK Schedule for ${jobId} (Part ${partNum}/${totalParts}) — ${unseenSchedules.length} new schedules</b>\n<pre>${chunk}</pre>`
                    );
                }
            } else {
                logger.info(`ℹ️  Schedule API [${jobId}] all ${dupeCount} schedules already notified — skipping Telegram`);
            }

            // Fire-and-forget: pair top schedules with eligible users and apply.
            // Pass the full scheduleCards list — create-application has its own
            // consumed-scheduleIds dedup based on user.json.
            processSchedules(jobId, scheduleCards).catch((err) => {
                logger.error(`processSchedules failed for ${jobId}: ${err.message}`);
            });
        } else {
            logger.info(`ℹ️  Schedule API [${jobId}] returned no scheduleCards`);
        }
        return data;
    } catch (error) {
        proxyManager.reportFailure();
        logger.error(`❌ Schedule API exception for ${jobId}: ${error.message} (Proxy: ${proxyInfo})`);
        sendTelegramMessage(
            `🚨 <b>UK Schedule API Exception</b>\n<b>jobId:</b> ${jobId}\n<b>Error:</b> ${error.message}\n<b>Proxy:</b> ${proxyInfo}`
        );
        return null;
    }
}

// Process a list of jobIds in parallel using Promise.allSettled, so one
// failure doesn't abort the rest. Skips jobIds dispatched within DEDUP_WINDOW_MS.
async function processJobIds(jobIds) {
    if (!Array.isArray(jobIds) || jobIds.length === 0) return;

    const fresh = jobIds.filter((id) => id && !shouldSkip(id));
    const skipped = jobIds.length - fresh.length;
    logger.info(`📋 [Schedule] Received ${jobIds.length} jobIds (${fresh.length} fresh, ${skipped} skipped by 2-min dedup)`);

    if (fresh.length === 0) return;

    const startTime = Date.now();
    const results = await Promise.allSettled(fresh.map((jobId) => callScheduleAPI(jobId)));
    const elapsed = Date.now() - startTime;

    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.length - fulfilled;
    logger.info(`📋 [Schedule] Parallel batch done in ${elapsed}ms — ${fulfilled} fulfilled, ${rejected} rejected`);
}

module.exports = {
    callScheduleAPI,
    processJobIds,
};
