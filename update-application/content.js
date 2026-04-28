// ─────────────────────────────────────────────────────────────────
// update-application / content.js
//
// Reads update-application/user.json, picks users where
//   is_booked=false AND status="draft", then for each (in parallel):
//
//   1. Mark status=processing, is_booked=true
//   2. Read access token from db/user.json by email
//   3. create-application  → save applicationId + candidateId
//   4. update-application  → poll every 200ms, round-robin proxies,
//                            stop on first HTTP 200
//   5. WebSocket           → close on assessment-consent
//   6. On success → status=confirmed, is_booked=true
//      On any failure → reset to status=draft, is_booked=false
//
// Logs: update-application/logs/YYYY-MM-DD/<email>.log
// ─────────────────────────────────────────────────────────────────

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch').default || require('node-fetch');

const { createApplication }  = require('../create-application/create-application.js');
const { runWebSocket }       = require('../create-application/ws-runner.js');
const { proxyManager }       = require('./proxy-manager.js');
const { sendTelegramMessage, CHANNEL_ID_UK_JOB_CONFIRMED } = require('../telegram/sendMessage.js');

const USER_DB_PATH  = path.join(__dirname, 'user.json');
const MAIN_DB_PATH  = path.join(__dirname, '..', 'db', 'user.json');
const LOGS_BASE_DIR = path.join(__dirname, 'logs');

const UPDATE_INTERVAL_MS = 200;

const UPDATE_URL = 'https://www.jobsatamazon.co.uk/application/api/candidate-application/update-application';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Logger ───────────────────────────────────────────────────────────
function pad(n, len = 2) { return String(n).padStart(len, '0'); }

function getDateStr(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getTimestamp(d = new Date()) {
    return `${getDateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function log(email, level, msg) {
    const line = `[${getTimestamp()}] [${level.padEnd(5)}] [${email}] ${msg}`;
    console.log(line);
    try {
        const dir = path.join(LOGS_BASE_DIR, getDateStr());
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.appendFileSync(path.join(dir, `${email}.log`), line + '\n', 'utf8');
    } catch (_) {}
}

// ── DB helpers ───────────────────────────────────────────────────────
function loadLocalUsers() {
    return JSON.parse(fs.readFileSync(USER_DB_PATH, 'utf8'));
}

function saveLocalUsers(users) {
    fs.writeFileSync(USER_DB_PATH, JSON.stringify(users, null, 2) + '\n', 'utf8');
}

function patchUser(email, patch) {
    const users = loadLocalUsers();
    const idx   = users.findIndex((u) => u.email === email);
    if (idx === -1) return;
    Object.assign(users[idx], patch);
    saveLocalUsers(users);
}

function getAccessToken(email) {
    const users = JSON.parse(fs.readFileSync(MAIN_DB_PATH, 'utf8'));
    return users.find((u) => u.email === email)?.token || null;
}

// ── Update-application headers ───────────────────────────────────────
function buildUpdateHeaders(accessToken, jobId, scheduleId) {
    return {
        'accept':              'application/json, text/plain, */*',
        'accept-language':     'en-GB,en;q=0.9',
        'authorization':       accessToken,
        'bb-ui-version':       'bb-ui-v2',
        'content-type':        'application/json;charset=UTF-8',
        'origin':              'https://www.jobsatamazon.co.uk',
        'priority':            'u=1, i',
        'referer':             `https://www.jobsatamazon.co.uk/application/uk/?country=uk&jobId=${jobId}&locale=en-GB&scheduleId=${scheduleId}`,
        'sec-ch-ua':           '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        'sec-ch-ua-mobile':    '?0',
        'sec-ch-ua-platform':  '"Windows"',
        'sec-fetch-dest':      'empty',
        'sec-fetch-mode':      'cors',
        'sec-fetch-site':      'same-origin',
        'user-agent':          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
        'cookie':              'hvh-locale=en-GB; hvh-default-locale=en-GB; hvh-country-code=UK; hvh-stage=prod;'
    };
}

// ── Update-application poll (200ms, round-robin proxies) ─────────────
async function pollUntilSuccess(email, accessToken, applicationId, jobId, scheduleId) {
    let attempt = 0;
    while (true) {
        attempt++;
        const proxyUrl  = proxyManager.getNextProxy(true);
        const agent     = proxyManager.getProxyAgent(proxyUrl);
        const proxyInfo = proxyUrl ? (proxyUrl.split('@')[1] || proxyUrl) : 'No Proxy';

        try {
            const res  = await fetch(UPDATE_URL, {
                method:  'PUT',
                agent,
                headers: buildUpdateHeaders(accessToken, jobId, scheduleId),
                body:    JSON.stringify({
                    applicationId,
                    payload:    { jobId, scheduleId },
                    type:       'job-confirm',
                    dspEnabled: true
                })
            });
            const text = await res.text();
            log(email, 'INFO', `[update-app] attempt ${attempt} status=${res.status} proxy=${proxyInfo} | ${text}`);

            if (res.status === 200) {
                let parsed;
                try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
                if (parsed?.data?.applicationId) return { ok: true, raw: text };
                console.log(`[${getTimestamp()}] [WARN ] [${email}] [update-app] attempt ${attempt} status=200 but no data.applicationId — continuing`);
            }
        } catch (e) {
            log(email, 'WARN', `[update-app] attempt ${attempt} network error: ${e.message} proxy=${proxyInfo}`);
        }

        await sleep(UPDATE_INTERVAL_MS);
    }
}

// ── Per-user pipeline ────────────────────────────────────────────────
async function processUser(user) {
    const { email, jobId, scheduleId, city } = user;
    const tag = `${email}/${jobId}/${scheduleId}`;

    // Mark processing so parallel runs don't double-pick (is_booked stays false until update-application succeeds)
    patchUser(email, { status: 'processing' });
    log(email, 'INFO', `[${tag}] started — marked processing`);

    // Read access token from db/user.json
    const accessToken = getAccessToken(email);
    if (!accessToken) {
        log(email, 'ERROR', `[${tag}] no token found in db/user.json — resetting to draft`);
        patchUser(email, { status: 'draft', is_booked: false });
        return;
    }

    // 1. create-application
    log(email, 'INFO', `[${tag}] create-application starting`);
    const created = await createApplication(accessToken, jobId, scheduleId);
    if (!created.ok) {
        log(email, 'ERROR', `[${tag}] create-application failed: status=${created.status} ${created.error}`);
        patchUser(email, { status: 'draft', is_booked: false });
        return;
    }
    const { applicationId, candidateId } = created;
    log(email, 'INFO', `[${tag}] create-application ok appId=${applicationId} candidateId=${candidateId}`);
    patchUser(email, { applicationId, candidateId });

    // 2. update-application — poll every 200ms, round-robin proxies
    log(email, 'INFO', `[${tag}] update-application polling every ${UPDATE_INTERVAL_MS}ms (infinite — stop manually)`);
    const updated = await pollUntilSuccess(email, accessToken, applicationId, jobId, scheduleId);
    if (!updated.ok) {
        log(email, 'ERROR', `[${tag}] update-application failed: ${updated.error}`);
        patchUser(email, { status: 'draft', is_booked: false });
        return;
    }
    log(email, 'INFO', `[${tag}] update-application SUCCESS`);
    patchUser(email, { is_booked: true });

    try {
        sendTelegramMessage(
            `🔄 <b>Update-Application Successfully(Direct)</b>\n\n` +
            `📧 <b>Email:</b> ${email}\n` +
            `🆔 <b>Job:</b> ${jobId}\n` +
            `📅 <b>Schedule:</b> ${scheduleId}\n` +
            `🏙 <b>City:</b> ${city ?? 'N/A'}\n` +
            `🪪 <b>appId:</b> ${applicationId}\n` +
            `🕐 <b>Time:</b> ${new Date().toISOString()}`,
            CHANNEL_ID_UK_JOB_CONFIRMED
        );
    } catch (e) {
        log(email, 'WARN', `[${tag}] telegram error (update-application): ${e.message}`);
    }

    // 3. WebSocket
    log(email, 'INFO', `[${tag}] websocket starting`);
    const wsResult = await runWebSocket({ applicationId, candidateId, accessToken, jobId });
    if (!wsResult.ok) {
        log(email, 'ERROR', `[${tag}] websocket failed: ${wsResult.error}`);
        patchUser(email, { status: 'draft', is_booked: false });
        return;
    }

    // 4. Confirmed
    const confirmedAt = new Date().toISOString();
    patchUser(email, { status: 'confirmed', is_booked: true, confirmed_at: confirmedAt });
    log(email, 'INFO', `[${tag}] JOB CONFIRMED at ${confirmedAt}`);

    try {
        sendTelegramMessage(
            `✅ <b>Job Confirmed</b>(Direct)\n\n` +
            `📧 <b>Email:</b> ${email}\n` +
            `🆔 <b>Job:</b> ${jobId}\n` +
            `📅 <b>Schedule:</b> ${scheduleId}\n` +
            `🏙 <b>City:</b> ${city ?? 'N/A'}\n` +
            `🪪 <b>appId:</b> ${applicationId}\n` +
            `🕐 <b>Time:</b> ${confirmedAt}`,
            CHANNEL_ID_UK_JOB_CONFIRMED
        );
    } catch (e) {
        log(email, 'WARN', `[${tag}] telegram error: ${e.message}`);
    }
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
    const users    = loadLocalUsers();
    const eligible = users.filter((u) => u.is_booked === false && u.status === 'draft');

    if (eligible.length === 0) {
        console.log(`[${getTimestamp()}] [INFO ] no eligible users (is_booked=false AND status=draft)`);
        return;
    }

    console.log(`[${getTimestamp()}] [INFO ] processing ${eligible.length} eligible user(s) in parallel`);
    await Promise.allSettled(eligible.map((u) => processUser(u)));
    console.log(`[${getTimestamp()}] [INFO ] all done`);
}

main().catch(console.error);
