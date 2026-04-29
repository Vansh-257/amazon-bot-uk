const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fetch = require('node-fetch').default;

const { API_CONFIG } = require('../config/api-config.js');
const { SETTINGS } = require('../config/configuration.js');
const { proxyManager } = require('./proxy-manager.js');
const logger = require('./logger.js');
const { sendTelegramMessage } = require('../telegram/sendMessage.js');
const { processJobIds } = require('../Schedule_api/content.js');

const API_ENDPOINTS = API_CONFIG.API_ENDPOINTS_UK;
const HEADERS_CONFIG = API_CONFIG.HEADERS_CONFIG_UK;

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// In-memory set of jobIds we've already sent to Telegram. Job_api polls
// continuously and the same jobs reappear in every response — without this
// the user would receive the same job dump on every poll. Lives for the
// process lifetime; a restart resets it.
const notifiedJobIds = new Set();

// Save one API response to its own file in data/, named with a unique id.
function saveResponseFile(apiResponse) {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const id = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
    const filePath = path.join(dataDir, `${id}.json`);
    fs.writeFile(filePath, JSON.stringify(apiResponse, null, 2), 'utf8', (err) => {
        if (err) {
            logger.error(`❌ Error saving ${filePath}: ${err.message}`);
        } else {
            logger.info(`✅ Saved response to ${filePath}`);
        }
    });
}

// Function to call the Job Card API
async function callJobCardAPI() {
    let proxyUrl = null;
    let proxyInfo = 'No Proxy';

    try {
        proxyUrl = proxyManager.getNextProxy();
        const proxyAgent = proxyManager.getProxyAgent(proxyUrl);
        proxyInfo = proxyUrl ? proxyUrl.split('@')[1] || proxyUrl : 'No Proxy';

        const jobApi = API_ENDPOINTS.JOBCARDAPI;
        const jobHeaders = HEADERS_CONFIG.JOBCARDAPI_HEADERS;
        const jobBody = HEADERS_CONFIG.JOBCARDAPI_BODY;

        const startTime = Date.now();
        const response = await fetch(jobApi, {
            method: 'POST',
            headers: jobHeaders,
            body: jobBody,
            agent: proxyAgent,
        });
        const latency = Date.now() - startTime;

        logger.info(`📡 API Status Code: ${response.status} | Latency: ${latency}ms (Proxy: ${proxyInfo})`);

        if (!response.ok) {
            proxyManager.reportFailure();
            logger.error(`❌ HTTP error! status: ${response.status} (Proxy: ${proxyInfo})`);
            sendTelegramMessage(
                `🚨 <b>UK Job API Error</b>\n<b>Status:</b> ${response.status}\n<b>Latency:</b> ${latency}ms\n<b>Proxy:</b> ${proxyInfo}\n<b>URL:</b> ${jobApi}`
            );
            return {
                success: false,
                response: null,
                statusCode: response.status,
                error: `HTTP error! status: ${response.status}`,
            };
        }

        proxyManager.reportSuccess();
        const jobFromCardAPI = await response.json();
        return {
            success: true,
            response: jobFromCardAPI,
            statusCode: response.status,
        };
    } catch (error) {
        proxyManager.reportFailure();
        logger.error(`❌ Error calling Job Card API: ${error.message} (Proxy: ${proxyInfo})`);
        sendTelegramMessage(
            `🚨 <b>UK Job API Exception</b>\n<b>Error:</b> ${error.message}\n<b>Proxy:</b> ${proxyInfo}\n<b>URL:</b> ${API_ENDPOINTS.JOBCARDAPI}`
        );
        return {
            success: false,
            response: null,
            statusCode: null,
            error: error.message,
        };
    }
}

// Main function to process API response and save to file when jobCards is non-empty.
async function processAndSaveJobCards() {
    const apiResult = await callJobCardAPI();

    if (apiResult.success && apiResult.response) {
        const newJobCards = apiResult.response?.data?.searchJobCardsByLocation?.jobCards || [];

        // Only process jobs whose jobId starts with the expected UK prefix.
        const validJobCards = newJobCards.filter((j) => j.jobId && j.jobId.startsWith('JOB-UK-'));
        const skippedCount = newJobCards.length - validJobCards.length;
        if (skippedCount > 0) {
            logger.info(`⏭️  Skipped ${skippedCount} job(s) without 'JOB-UK-' prefix`);
        }

        if (validJobCards.length > 0) {
            // Filter to jobs we haven't notified about yet — Telegram should
            // only see unique jobIds even though Job_api polls in a loop.
            const unseen = validJobCards.filter((j) => !notifiedJobIds.has(j.jobId));
            const dupeCount = newJobCards.length - unseen.length;

            logger.info(`➕ Got ${validJobCards.length} valid jobCards — ${unseen.length} new, ${dupeCount} already notified`);

            if (unseen.length > 0) {
                // Mark as notified up-front so the next poll's filter sees them
                // even if Telegram is slow.
                unseen.forEach((j) => notifiedJobIds.add(j.jobId));

                // Build a response copy whose jobCards array is just the unseen
                // valid ones — same shape as the upstream payload, fewer entries.
                const filteredResponse = JSON.parse(JSON.stringify(apiResult.response));
                if (filteredResponse?.data?.searchJobCardsByLocation) {
                    filteredResponse.data.searchJobCardsByLocation.jobCards = unseen;
                }

                saveResponseFile(filteredResponse);

                const apiText = JSON.stringify(filteredResponse, null, 2);
                const chunkSize = 3500;
                const totalParts = Math.ceil(apiText.length / chunkSize);
                for (let i = 0; i < apiText.length; i += chunkSize) {
                    const chunk = apiText.slice(i, i + chunkSize);
                    const partNum = Math.floor(i / chunkSize) + 1;
                    sendTelegramMessage(
                        `<b>📦 UK Job API Result (Part ${partNum}/${totalParts}) — ${unseen.length} new jobs</b>\n<pre>${chunk}</pre>`
                    );
                }
            } else {
                logger.info('ℹ️  All jobs already notified — skipping Telegram');
            }

            // Fire-and-forget: dispatch each jobId to the Schedule API.
            // Schedule_api dedupes 2 minutes per jobId so re-polls don't re-fire.
            const jobIds = validJobCards.map((j) => j.jobId);
            processJobIds(jobIds).catch((err) => {
                logger.error(`Schedule_api processJobIds failed: ${err.message}`);
            });
        } else if (newJobCards.length > 0) {
            logger.info('ℹ️  No valid job cards with JOB-UK- prefix in response');
        } else {
            logger.info('ℹ️  No job cards in response');
        }
    } else if (!apiResult.success) {
        logger.error(`❌ API call failed: ${apiResult.error}`);
    }
}

// Main loop - call API at interval from settings
async function startPolling() {
    const intervalMs = SETTINGS.INTERVAL * 1000;
    logger.info(`🚀 Starting Job Card API polling (every ${SETTINGS.INTERVAL}s / ${intervalMs}ms)...`);
    logger.info(`📁 Data will be saved to: ${dataDir}`);
    logger.info(`🌐 API Endpoint: ${API_ENDPOINTS.JOBCARDAPI}`);
    logger.info(`🔄 Proxy Manager: ${proxyManager.getProxyCount()} proxies available`);
    logger.info('---');

    while (true) {
        await processAndSaveJobCards();
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
}

process.on('SIGINT', () => {
    logger.info('\n🛑 Stopping Job Card API polling...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('\n🛑 Stopping Job Card API polling...');
    process.exit(0);
});

startPolling().catch((error) => {
    logger.error(`❌ Fatal error: ${error.message}`);
    process.exit(1);
});
