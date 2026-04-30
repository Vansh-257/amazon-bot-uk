// ─────────────────────────────────────────────────────────────────
// automation-login / auto-script / index.js
//
// Re-entrant login flow for Amazon Hiring UK. `runLogin(email)` is
// called by daemon.js for each eligible user; many can run in
// parallel — each call gets its own proxy.
//
// Flow:
//   load-user → csrf → sign-in (with WAF token rotation) → wait-7s
//   → otp-fetch (Gmail or Hostinger by domain) → confirm-otp (with
//   WAF token rotation) → save-db → done
//
// WAF tokens come from db/aws-waf-token.json. On 403 the offending
// token is removed from the pool and the next is tried. If the pool
// runs out the run is aborted (no point retrying).
//
// On any failure the WHOLE flow is retried up to LOGIN_MAX_RETRIES.
// ─────────────────────────────────────────────────────────────────

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

const { DynamoDBClient }        = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { SETTINGS }              = require('../../config/configuration.js');

const _dynamoClient = new DynamoDBClient({
    region:      SETTINGS.region,
    credentials: { accessKeyId: SETTINGS.accessKeyId, secretAccessKey: SETTINGS.secretAccessKey },
});
const _dynamo = DynamoDBDocumentClient.from(_dynamoClient);

const { proxyManager }       = require('./proxy-manager.js');
const { peekToken, removeToken, poolSize } = require('./waf-token-pool.js');
const { forUser }            = require('./logger.js');
const { getOtpFromGmail }    = require('../../fetch-otp/GmailOtp.js');
const { getOtpFromHostinger } = require('../../fetch-otp/hostingerOtp.js');
const { sendTelegramMessage, CHANNEL_ID_UK_LOGIN } = require('../../telegram/sendMessage.js');

const USER_DB_PATH = path.join(__dirname, '..', '..', 'db', 'user.json');

const BASE_URL     = 'https://auth.hiring.amazon.com';
const COUNTRY_CODE = 'UK';
const COUNTRY_NAME = 'United Kingdom';
const LOCALE       = 'en-GB';
const LOGIN_TYPE   = 'email';

const LOGIN_MAX_RETRIES = 3;
const OTP_INITIAL_WAIT_MS = 7000;
const OTP_MAX_RETRIES = 3;
const OTP_RETRY_DELAY_MS = 5000;
const RATE_LIMIT_MAX_RETRIES = 5;
const RATE_LIMIT_WAIT_MS = 15000;
const WAF_POOL_POLL_MS = 5000;
const WAF_POOL_HEARTBEAT_MS = 60000;

const COMMON_HEADERS = {
    'Accept':            'application/json, text/plain, */*',
    'Accept-Language':   'en-GB,en;q=0.9',
    'Cache-Control':     'no-cache',
    'Pragma':            'no-cache',
    'Origin':            'https://auth.hiring.amazon.com',
    'Referer':           'https://auth.hiring.amazon.com/',
    'Sec-Fetch-Dest':    'empty',
    'Sec-Fetch-Mode':    'cors',
    'Sec-Fetch-Site':    'same-origin',
    'User-Agent':        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    'sec-ch-ua':         '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    'sec-ch-ua-mobile':  '?0',
    'sec-ch-ua-platform':'"Windows"'
};

// ── Utilities ────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isWafBlock = (status) => status === 403 || status === 405;

// ── user.json read/write ─────────────────────────────────────────
function loadUser(email) {
    const raw = fs.readFileSync(USER_DB_PATH, 'utf8');
    const rows = JSON.parse(raw);
    const needle = email.trim().toLowerCase();
    const row = rows.find((u) => (u.email || '').trim().toLowerCase() === needle);
    if (!row) throw new Error(`User not found in user.json: ${email}`);
    if (!row.pin) throw new Error(`User '${email}' has no pin in user.json`);
    return {
        email:   row.email,
        pin:     String(row.pin),
        passkey: row.passkey || null
    };
}

async function updateUserTokenInDb(email, accessToken) {
    const raw = fs.readFileSync(USER_DB_PATH, 'utf8');
    const rows = JSON.parse(raw);
    const needle = email.trim().toLowerCase();
    const idx = rows.findIndex((u) => (u.email || '').trim().toLowerCase() === needle);
    if (idx === -1) throw new Error(`User vanished from user.json: ${email}`);

    rows[idx].token          = accessToken;
    rows[idx].last_active_at = new Date().toISOString();
    rows[idx].updated_at     = rows[idx].last_active_at;

    fs.writeFileSync(USER_DB_PATH, JSON.stringify(rows, null, 2) + '\n', 'utf8');

    await _dynamo.send(new UpdateCommand({
        TableName: SETTINGS.dynamoTableName,
        Key: { email: needle },
        UpdateExpression: 'SET accessToken = :t, updated_at = :u',
        ExpressionAttributeValues: {
            ':t': accessToken,
            ':u': rows[idx].updated_at,
        },
    }));

    return rows[idx].last_active_at;
}

function setUserStatus(email, status) {
    const raw = fs.readFileSync(USER_DB_PATH, 'utf8');
    const rows = JSON.parse(raw);
    const needle = email.trim().toLowerCase();
    const idx = rows.findIndex((u) => (u.email || '').trim().toLowerCase() === needle);
    if (idx === -1) return;
    rows[idx].status     = status;
    rows[idx].updated_at = new Date().toISOString();
    fs.writeFileSync(USER_DB_PATH, JSON.stringify(rows, null, 2) + '\n', 'utf8');
}

// ── Amazon auth API calls ────────────────────────────────────────
async function getCsrfToken(agent) {
    const url = `${BASE_URL}/api/csrf?countryCode=${COUNTRY_CODE}`;
    const res = await fetch(url, { method: 'GET', headers: COMMON_HEADERS, agent });
    const text = await res.text();
    if (!res.ok) {
        const err = new Error(`CSRF failed: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    const data = JSON.parse(text);
    if (!data.token) throw new Error(`CSRF response missing token: ${text}`);
    return data.token;
}

async function signIn(agent, csrfToken, wafToken, user) {
    const url = `${BASE_URL}/api/authentication/sign-in?countryCode=${COUNTRY_CODE}`;
    const res = await fetch(url, {
        method: 'POST',
        agent,
        headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/json',
            'CSRF-Token':   csrfToken,
            'Cookie':       `aws-waf-token=${wafToken}`
        },
        body: JSON.stringify({
            loginType:   LOGIN_TYPE,
            pin:         user.pin,
            user:        user.email,
            token:       csrfToken,
            locale:      LOCALE,
            countryName: COUNTRY_NAME
        })
    });
    const text = await res.text();
    if (!res.ok) {
        const err = new Error(`sign-in: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    return JSON.parse(text);
}

async function confirmOtp(agent, csrfToken, wafToken, session, otp, user) {
    const url = `${BASE_URL}/api/authentication/confirm-otp?countryCode=${COUNTRY_CODE}`;
    const res = await fetch(url, {
        method: 'POST',
        agent,
        headers: {
            ...COMMON_HEADERS,
            'Content-Type': 'application/json',
            'CSRF-Token':   csrfToken,
            'Cookie':       `aws-waf-token=${wafToken}`
        },
        body: JSON.stringify({
            otp,
            session,
            user:        user.email,
            token:       csrfToken,
            countryName: COUNTRY_NAME,
            countryCode: COUNTRY_CODE
        })
    });
    const text = await res.text();
    if (!res.ok) {
        const err = new Error(`confirm-otp: ${res.status} ${res.statusText}\n${text.slice(0, 300)}`);
        err.status = res.status;
        throw err;
    }
    return JSON.parse(text);
}

// Park the run until the pool has at least one token. Polls every
// WAF_POOL_POLL_MS; emits a heartbeat warn every WAF_POOL_HEARTBEAT_MS
// so the operator can see the run is alive and waiting.
async function waitForWafToken(log, label) {
    log.warn(label, 'aws-waf-token pool empty — waiting for new tokens...');
    let waited = 0;
    while (true) {
        await sleep(WAF_POOL_POLL_MS);
        waited += WAF_POOL_POLL_MS;
        if (peekToken()) {
            log.response(label, `pool replenished after ${waited / 1000}s, resuming`);
            return;
        }
        if (waited % WAF_POOL_HEARTBEAT_MS === 0) {
            log.warn(label, `still waiting for tokens (${waited / 1000}s elapsed, pool=${poolSize()})`);
        }
    }
}

// ── WAF token + rate-limit wrapper ───────────────────────────────
// Pulls the oldest token from the pool. On 403 evicts that token and
// retries with the next one. On 429 (rate limit) waits 15s and rotates
// the proxy, then retries the same call (same WAF token) — up to 5
// tries. After 5 it logs a clear "429 issue" message and aborts the
// run. If the pool is empty, the run parks until tokens are refilled.
async function withWafRotation(agentRef, log, label, fn) {
    let rateLimitTries = 0;
    while (true) {
        let wafToken = peekToken();
        if (!wafToken) {
            await waitForWafToken(log, label);
            wafToken = peekToken();
            if (!wafToken) continue;
        }
        log.step(`${label} waf-token=${wafToken.slice(0, 12)}... pool=${poolSize()}`);
        try {
            return await fn(agentRef.current, wafToken);
        } catch (err) {
            if (err && err.status === 429) {
                rateLimitTries++;
                if (rateLimitTries >= RATE_LIMIT_MAX_RETRIES) {
                    log.error(label, `429 issue — failed after ${RATE_LIMIT_MAX_RETRIES} retries with ${RATE_LIMIT_WAIT_MS / 1000}s wait between, aborting this user`);
                    const e = new Error(`${label}: 429 issue`);
                    e.rateLimited = true;
                    throw e;
                }
                log.warn(label, `429 Too Many Requests — waiting ${RATE_LIMIT_WAIT_MS / 1000}s then retry (${rateLimitTries}/${RATE_LIMIT_MAX_RETRIES})`);
                proxyManager.reportFailure();
                await sleep(RATE_LIMIT_WAIT_MS);
                agentRef.current = proxyManager.nextAgent(true);
                continue;
            }
            if (err && isWafBlock(err.status)) {
                log.warn(label, `WAF blocked (${err.status}) — evicting token, pool=${poolSize() - 1}`);
                removeToken(wafToken);
                continue;
            }
            throw err;
        }
    }
}

// 429-aware retry for endpoints that don't consume WAF tokens (CSRF).
async function with429Retry(agentRef, log, label, fn) {
    let rateLimitTries = 0;
    while (true) {
        try {
            return await fn(agentRef.current);
        } catch (err) {
            if (err && err.status === 429) {
                rateLimitTries++;
                if (rateLimitTries >= RATE_LIMIT_MAX_RETRIES) {
                    log.error(label, `429 issue — failed after ${RATE_LIMIT_MAX_RETRIES} retries with ${RATE_LIMIT_WAIT_MS / 1000}s wait between, aborting this user`);
                    const e = new Error(`${label}: 429 issue`);
                    e.rateLimited = true;
                    throw e;
                }
                log.warn(label, `429 Too Many Requests — waiting ${RATE_LIMIT_WAIT_MS / 1000}s then retry (${rateLimitTries}/${RATE_LIMIT_MAX_RETRIES})`);
                proxyManager.reportFailure();
                await sleep(RATE_LIMIT_WAIT_MS);
                agentRef.current = proxyManager.nextAgent(true);
                continue;
            }
            throw err;
        }
    }
}

// ── OTP fetch (domain-aware) with retries ────────────────────────
async function fetchOtp(email, passkey, log) {
    const domain = (email.split('@')[1] || '').toLowerCase();

    for (let attempt = 1; attempt <= OTP_MAX_RETRIES; attempt++) {
        try {
            let otp = null;
            if (domain === 'gmail.com') {
                if (!passkey) throw new Error(`Gmail user '${email}' has no passkey in user.json`);
                otp = await getOtpFromGmail(email, passkey);
            } else if (domain === 'jgemaill.fun') {
                otp = await getOtpFromHostinger(email);
            } else {
                throw new Error(`Unsupported email domain for OTP: ${domain}`);
            }

            if (otp) return otp;
            log.warn(`otp-fetch ${attempt}/${OTP_MAX_RETRIES}`, 'no OTP found yet');
        } catch (e) {
            log.warn(`otp-fetch ${attempt}/${OTP_MAX_RETRIES}`, e.message);
        }
        if (attempt < OTP_MAX_RETRIES) await sleep(OTP_RETRY_DELAY_MS);
    }
    throw new Error('OTP not received after max retries.');
}

// ── Single attempt ───────────────────────────────────────────────
async function runLoginOnce(email, log) {
    log.step('load-user');
    const user = loadUser(email);
    log.response('load-user', user.email);

    const agentRef = { current: proxyManager.nextAgent(true) };

    log.step('csrf');
    const csrfToken = await with429Retry(agentRef, log, 'csrf', (agent) => getCsrfToken(agent));
    log.response('csrf', csrfToken);

    log.step('sign-in');
    const signInRes = await withWafRotation(agentRef, log, 'sign-in',
        (agent, t) => signIn(agent, csrfToken, t, user));
    log.response('sign-in', signInRes);

    log.step(`otp-wait ${OTP_INITIAL_WAIT_MS}ms`);
    await sleep(OTP_INITIAL_WAIT_MS);

    log.step('otp-fetch');
    const otp = await fetchOtp(user.email, user.passkey, log);
    log.response('otp-fetch', otp);

    log.step('confirm-otp');
    const confirmRes = await withWafRotation(agentRef, log, 'confirm-otp',
        (agent, t) => confirmOtp(agent, csrfToken, t, signInRes.session, otp, user));
    log.response('confirm-otp', confirmRes);

    const accessToken = confirmRes?.signInUserSession?.accessToken;
    if (!accessToken) throw new Error('No accessToken in confirm-otp response');

    log.step('save-db');
    const ts = await updateUserTokenInDb(user.email, accessToken);
    log.response('save-db', ts);

    // Fire-and-forget telegram ping on successful login — login channel.
    try {
        sendTelegramMessage(
            `✅ <b>Login Successfully</b>\n\n` +
            `📧 <b>Email:</b> ${user.email}\n` +
            `🕐 <b>Time:</b> ${ts}`,
            CHANNEL_ID_UK_LOGIN
        );
    } catch (e) {
        log.warn('telegram', e.message);
    }

    log.step('done');
    return { accessToken, last_active_at: ts };
}

// ── Public: run login for one email, retrying up to 3 times ──────
async function runLogin(email) {
    const log = forUser(email);

    try { setUserStatus(email, 'Processing'); log.response('mark-processing', 'Processing'); }
    catch (e) { log.warn('mark-processing', e.message); }

    let lastErr;
    try {
        try {
            for (let attempt = 1; attempt <= LOGIN_MAX_RETRIES; attempt++) {
                try {
                    return await runLoginOnce(email, log);
                } catch (err) {
                    // Pool exhausted or 429 issue — no point retrying.
                    if (err && (err.noWafTokens || err.rateLimited)) {
                        log.error('abort', err.message);
                        throw err;
                    }
                    lastErr = err;
                    log.error(`retry ${attempt}/${LOGIN_MAX_RETRIES}`, err);
                }
            }
            throw lastErr;
        } catch (err) {
            // Final failure — send telegram alert before bubbling up.
            // Login-related, so it goes to the login channel too.
            try {
                sendTelegramMessage(
                    `❌ <b>Login Failed</b>\n\n` +
                    `📧 <b>Email:</b> ${email}\n` +
                    `🕐 <b>Time:</b> ${new Date().toISOString()}\n` +
                    `⚠️ <b>Error:</b> ${(err?.message || 'Unknown error').slice(0, 500)}`,
                    CHANNEL_ID_UK_LOGIN
                );
            } catch (e) {
                log.warn('telegram-fail', e.message);
            }
            throw err;
        }
    } finally {
        try {
            const raw  = fs.readFileSync(USER_DB_PATH, 'utf8');
            const rows = JSON.parse(raw);
            const row  = rows.find((u) => (u.email || '').trim().toLowerCase() === email.trim().toLowerCase());
            if (row && row.status === 'Processing') {
                setUserStatus(email, 'draft');
                log.response('unlock-on-exit', 'draft');
            }
        } catch (_) { /* noop */ }
    }
}

// ── CLI ──────────────────────────────────────────────────────────
async function main() {
    const email = process.argv[2];
    if (!email) {
        console.error('Usage: node automation-login/auto-script/index.js <email>');
        process.exit(1);
    }
    try {
        await runLogin(email);
    } catch {
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = { runLogin };
