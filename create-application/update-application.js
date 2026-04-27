const fetch = require('node-fetch').default || require('node-fetch');
const { proxyManager } = require('./proxy-manager.js');
const logger = require('./logger.js');

const URL = 'https://www.jobsatamazon.co.uk/application/api/candidate-application/update-application';

const MAX_RETRIES = 20;

function buildHeaders(accessToken, jobId, scheduleId) {
    return {
        'accept':           'application/json, text/plain, */*',
        'accept-language':  'en-GB,en;q=0.9',
        'authorization':    accessToken,
        'bb-ui-version':    'bb-ui-v2',
        'content-type':     'application/json;charset=UTF-8',
        'origin':           'https://www.jobsatamazon.co.uk',
        'priority':         'u=1, i',
        'referer':          `https://www.jobsatamazon.co.uk/application/uk/?country=uk&jobId=${jobId}&locale=en-GB&scheduleId=${scheduleId}`,
        'sec-ch-ua':        '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform':'"Windows"',
        'sec-fetch-dest':   'empty',
        'sec-fetch-mode':   'cors',
        'sec-fetch-site':   'same-origin',
        'user-agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'cookie':           'hvh-locale=en-GB; hvh-default-locale=en-GB; hvh-country-code=UK; hvh-stage=prod;'
    };
}

async function updateApplicationOnce(accessToken, applicationId, jobId, scheduleId, agent) {
    try {
        const res = await fetch(URL, {
            method: 'PUT',
            agent,
            headers: buildHeaders(accessToken, jobId, scheduleId),
            body: JSON.stringify({
                applicationId,
                payload: { jobId, scheduleId },
                type: 'job-confirm',
                dspEnabled: true
            })
        });
        const text = await res.text();
        return { status: res.status, text };
    } catch (e) {
        return { status: 0, text: `network: ${e.message}` };
    }
}

// Retries on ANY non-200 up to MAX_RETRIES times, picking a different proxy each attempt.
async function updateApplication(accessToken, applicationId, jobId, scheduleId) {
    let last = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        const proxyUrl = proxyManager.getNextProxy(true);
        const agent = proxyManager.getProxyAgent(proxyUrl);
        const proxyInfo = proxyUrl ? (proxyUrl.split('@')[1] || proxyUrl) : 'No Proxy';

        const r = await updateApplicationOnce(accessToken, applicationId, jobId, scheduleId, agent);
        if (r.status === 200) {
            logger.info(`[update-app] ${applicationId} OK on attempt ${attempt}/${MAX_RETRIES} (proxy: ${proxyInfo})`);
            return { ok: true, raw: r.text };
        }
        logger.warn(`[update-app] ${applicationId} attempt ${attempt}/${MAX_RETRIES} status=${r.status} (proxy: ${proxyInfo}) ${r.text.slice(0, 150)}`);
        last = r;
    }
    return { ok: false, status: last?.status, error: (last?.text || '').slice(0, 300) };
}

module.exports = { updateApplication };
