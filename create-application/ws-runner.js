const WebSocket = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { proxyManager } = require('./proxy-manager.js');
const logger = require('./logger.js');

const WS_URL_BASE     = 'wss://ws.eu-west-1.prod.application-workflow.hvh.a2z.com/';
const WS_TIMEOUT_MS   = 20000;
const WS_MAX_RETRIES  = 3;
const WS_RETRY_DELAY_MS = 2000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildStartWorkflowPayload({ applicationId, candidateId, jobId }) {
    return {
        action: 'startWorkflow',
        applicationId,
        candidateId,
        domainType: 'CS',
        filteringRegular: false,
        filteringSeasonal: false,
        jobId,
        partitionAttributes: { countryCodes: ['UK'], ownerOrgs: ['AMZN_WFS'] }
    };
}

function attemptWebSocket({ applicationId, candidateId, accessToken, jobId, agent }) {
    const wsUrl =
        `${WS_URL_BASE}` +
        `?applicationId=${encodeURIComponent(applicationId)}` +
        `&candidateId=${encodeURIComponent(candidateId)}` +
        `&authToken=${encodeURIComponent(accessToken)}`;

    return new Promise((resolve) => {
        let settled = false;
        let stepCounter = 0;
        let ws;

        const finish = (r) => {
            if (settled) return;
            settled = true;
            try { if (ws) ws.terminate(); } catch (_) {}
            resolve(r);
        };

        const timer = setTimeout(() => {
            logger.warn(`[ws] timeout (${WS_TIMEOUT_MS}ms) appId=${applicationId}`);
            finish({ ok: false, error: 'timeout' });
        }, WS_TIMEOUT_MS);

        function safeSend(payload) {
            if (!ws || ws.readyState !== WebSocket.OPEN) return false;
            try { ws.send(JSON.stringify(payload)); return true; }
            catch (e) { logger.warn(`[ws] send error: ${e.message}`); return false; }
        }

        const wsOptions = agent ? { agent } : {};
        ws = new WebSocket(wsUrl, wsOptions);

        ws.on('open', () => {
            logger.info(`[ws] open appId=${applicationId} candidateId=${candidateId}`);
            safeSend(buildStartWorkflowPayload({ applicationId, candidateId, jobId }));
        });

        ws.on('message', (raw) => {
            const text = raw.toString();
            logger.info(`[ws] msg: ${text.slice(0, 200)}`);

            if (text.includes('Internal server error')) {
                clearTimeout(timer);
                finish({ ok: false, error: 'internal_server_error' });
                return;
            }

            let parsed;
            try { parsed = JSON.parse(text); } catch { return; }

            if (parsed && parsed.error) {
                clearTimeout(timer);
                logger.warn(`[ws] error response: ${parsed.error}`);
                finish({ ok: false, error: String(parsed.error) });
                return;
            }

            const stepName = parsed?.stepName;
            if (!stepName) return;
            logger.info(`[ws] stepName=${stepName}`);

            // On reaching assessment-consent, send startWorkflow once more then finish.
            if (stepName === 'assessment-consent' && stepCounter === 0) {
                stepCounter = 1;
                safeSend(buildStartWorkflowPayload({ applicationId, candidateId, jobId }));
                clearTimeout(timer);
                logger.info(`[ws] reached assessment-consent — closing`);
                finish({ ok: true, finalStep: 'assessment-consent' });
            }
        });

        ws.on('error', (err) => {
            logger.warn(`[ws] error: ${err.message}`);
        });

        ws.on('close', (code) => {
            logger.info(`[ws] closed code=${code} appId=${applicationId}`);
            if (!settled) {
                clearTimeout(timer);
                finish({ ok: false, error: `closed code ${code}` });
            }
        });
    });
}

async function runWebSocket(details) {
    let last;
    for (let attempt = 1; attempt <= WS_MAX_RETRIES; attempt++) {
        const proxyUrl = proxyManager.getNextProxy(true);
        const agent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : null;
        logger.info(`[ws] attempt ${attempt}/${WS_MAX_RETRIES} appId=${details.applicationId}`);
        last = await attemptWebSocket({ ...details, agent });
        if (last.ok) return last;
        if (attempt < WS_MAX_RETRIES) {
            logger.warn(`[ws] retrying in ${WS_RETRY_DELAY_MS}ms — ${last.error}`);
            await sleep(WS_RETRY_DELAY_MS);
        }
    }
    return last || { ok: false, error: 'all attempts failed' };
}

module.exports = { runWebSocket };
