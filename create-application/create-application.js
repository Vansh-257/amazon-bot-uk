const fetch = require('node-fetch').default || require('node-fetch');
const { proxyManager } = require('./proxy-manager.js');

const URL = 'https://www.jobsatamazon.co.uk/application/api/candidate-application/ds/create-application/';

// Per spec: candidateId is sent as empty string in the create-application body.
// The response returns a fresh candidateId which is what we save into user.json.
const REQUEST_CANDIDATE_ID = '';

function buildHeaders(accessToken, jobId) {
    return {
        'accept':           '*/*',
        'accept-language':  'en-GB,en;q=0.9',
        'authorization':    accessToken,
        'bb-ui-version':    'bb-ui-v2',
        'content-type':     'application/json;charset=UTF-8',
        'origin':           'https://www.jobsatamazon.co.uk',
        'priority':         'u=1, i',
        'referer':          `https://www.jobsatamazon.co.uk/application/uk/?CS=true&jobId=${jobId}&locale=en-GB&ssoEnabled=1`,
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

// Single-shot. On any failure (non-200, network) returns { ok:false, status, error }.
// On success returns { ok:true, applicationId, candidateId, raw }.
async function createApplication(accessToken, jobId, scheduleId) {
    const proxyUrl = proxyManager.getNextProxy(true);
    const agent = proxyManager.getProxyAgent(proxyUrl);

    try {
        const res = await fetch(URL, {
            method: 'POST',
            agent,
            headers: buildHeaders(accessToken, jobId),
            body: JSON.stringify({
                dspEnabled: true,
                jobId,
                scheduleId,
                candidateId: REQUEST_CANDIDATE_ID,
                activeApplicationCheckEnabled: true
            })
        });
        const text = await res.text();
        if (!res.ok) {
            return { ok: false, status: res.status, error: text.slice(0, 300) };
        }
        const parsed = JSON.parse(text);
        const data = parsed?.data || {};
        const applicationId = data.applicationId;
        const candidateId   = data.candidateId;
        if (!applicationId || !candidateId) {
            return { ok: false, status: res.status, error: `Missing applicationId/candidateId in response: ${text.slice(0, 300)}` };
        }
        return { ok: true, applicationId, candidateId, raw: parsed };
    } catch (e) {
        return { ok: false, status: 0, error: e.message };
    }
}

module.exports = { createApplication };
