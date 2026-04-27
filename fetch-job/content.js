// ============================================================
// CONFIG — edit these, then run: node fetch-job/content.js
// ============================================================
const START_NUM = 411;          // first numeric id; e.g. 1 → JOB-UK-0000000001
const DELAY_MS  = 200;        // delay between requests in milliseconds
// ============================================================

// Stops the moment the API returns this exact error response:
//   { "errorMessage": "Unable to fetch job.", "error": null, "errorCode": "FETCH_JOB_ERROR" }
// That's the API's signal that the id doesn't exist (i.e. we've walked off the end of the
// allocated id space), so there's nothing more to fetch.

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch').default;
const { proxyManager } = require('./proxy-manager.js');
const logger = require('./logger.js');

// ---------- Output file ----------
// All fetched job objects go into ONE JSON array file.
// Loaded into memory at start (so reruns append to existing data),
// then rewritten after each successful fetch — safe under Ctrl+C.
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
const outFile = path.join(dataDir, 'jobs.json');

let allJobs = [];
if (fs.existsSync(outFile)) {
    try {
        const raw = fs.readFileSync(outFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allJobs = parsed;
    } catch {
        // Corrupt or non-array — start fresh, but back up the old file just in case.
        fs.renameSync(outFile, `${outFile}.corrupt-${Date.now()}.bak`);
    }
}
const seenJobIds = new Set(allJobs.map((j) => j?.jobId).filter(Boolean));

// ---------- Request config (from your curl) ----------
const AUTH_TOKEN = "AQICAHgRVX6yB5HaOXG/6jWEErD4AnJUVlc3se+5PoiAFFV3IgH9FbCa8kJK4H1eS0nwP5QlAAAEmDCCBJQGCSqGSIb3DQEHBqCCBIUwggSBAgEAMIIEegYJKoZIhvcNAQcBMB4GCWCGSAFlAwQBLjARBAzlWcFjHWYGi7X/pXMCARCAggRLOwUinIcyd9IsCKlBPfnUEA4s60UP3EbZWUaaeevwc9tH5wsqaMyDkq73UXsOoOhK9JJ1a/qbFF04zhST9SvPX0ilVdNwOzYqrjPyttL9pPPzMR33M9mC8UYvwuA/lhdmwciRB3RMHLgCEQkb1gQU/ThJ50VhKiTM02O1EjeTdkxJpfXgN4BX9EQjv1aZxUVcvViTjR9rXMKq8oOdkmbofBmta4vvby9/fOIzZx5gCHj55gy22edPYcZzE0wIPWodQnTfrNxhoBsuEIyAhi4zg6GCaijgxq1PsjSb+v/VNLEe8SQVkNIwgqHBfzATiKrS/kf7+cm4h8dHjdGLunXOp1tX2q0ZhGUauVEatQyklNCz2p/vqU3zEwkz/2wDTXhO96lM7LGPRYZY08w/CdoYL0+R+gIvD2MqprlDe9zLraBjpkuHD/kSGZ+bsGSYQH1R93iqS/Q8SGeoKr0IGehH+l5waQZWhI9LdtU+Fu8PpkVE5wTklqUeD2CYUDEcHIQ1jpDahur5ezD+UWtWdSkdg3wZjJ+QrygBZBMsaX6mBByE7Ry8nCl6WsstLkW/CgAFqnTzdYnK+r+jLe0RuiGylp23nTOfDuiLLFigvvGx0Q4jbhqbZc+hqakqNL8ON2QfN9i2i1abeD1Sj9NnkUrxzVd7626YRf79RFqsoWImsGkXxj7lsmhLyWr0L9w/rdPlT7mDCEn7+GRx+DZD/oObSQMuamF9zg9YxWtdK5fBTpIm/MtHtO6aFZsCakb2sCBBFHvWF9VxVJ4TdWQcsPUWJWNjdlnf8hBNePvq7KlxnGg0G40KsxujSXrZbC9eZZilVtd59Q/OYO78VWIRTpRCrJWs6xM62k/wyAES88UuOYIAu7dvapEqE4t9hDHflqL4kaVK+hVxWVQ9McRaMfJdNwJ7szb0DANfT72Fa1qxNn18FUlP23KZG6Bd2IxSuzbllXkLJd710jPAAbLV0j/EOgcg6gJlOtLamygwn+cqAjgGhMkts0n3UXdkT+h5qNjGt/n99Om6a1Fb+mU4ua+RUgwmFIgIuZS26K3sh+ijnKkbKa702G7VjPoGrIL1Kgck472ptT+yhcLjDlvYi+Ad3jNOIljfSSionvBEr74pXM9x1/5RoQIoIWwQ4Arsg5F7QImImSJ5ANPQq8ig8cN+6+v833FpgN0bPYmCQjKm1srzsMjVVy1BiS0X0mUQvUgxWHo7Vw6z/b5eaAqSuNjCkct3gZ274el1AY1GKi44dxld4So9yEMl/GO8V4kCWWePQa4P7JVE7dTvCV6VJIUmnGNt9z11HjQlBiAnwWhCAYecVXjEGjeC3OnLuRymtF/k7QE3eNuS6/zFDf4p5/WujC3NAAX/Lsm/WzJuLkY7I395yeIFzAB54s7biKCw1tRgV2pFXhLyB2eg1Hvcr1UNugqaDfnnskoxVrFSZHclnkGZ0xBXJ5BK7dahjw==";

const COOKIE = [
    "hvh-locale=en-GB",
    "hvh-default-locale=en-GB",
    "hvh-country-code=UK",
    "hvh-stage=prod",
    "adobe-session-id=5db8d7c5-5af6-4127-ad4b-7e37506eccf3",
    'hvh_cs_wlbsid=""',
    "hvh-analytics-cookies-enable=true",
    "hvh-advertising-cookies-enable=true",
    "cookieConsent=true",
    "JSESSIONID=59F1E36A44BCB939CFD9A123031BEB36",
    "hvhcid=e1b3f380-41bc-11f1-9ee5-efe588b6931d",
    "aws-waf-token=8ad5e0c5-4198-4b22-925d-97bbb05363be:BQoAdyOaRdcLAAAA:DXhjZ1W4Uf6fRPZqu4Bnip1wYM5vpUl6QHfVitD3is7ZWUPjMMCfDSCrXN2ZL/z0B4BdXBDlB9S4McbBHCVOIWRaosepg9c4XneWUwgyzQHPatGS6XIArTGykCG02fITLaMAhXtaYPOLkI7M+tkL6T/49XAuZ5t+cX+rvkAyOGW56JeDRX18YV/GUrkTEbiXdpKi+DmQA2ZviZhguItq6lhyQHmul+CrEqcFjQWtfUGHVzfOtllzafsl3rGsSrc=",
].join("; ");

const HEADERS = {
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-GB,en;q=0.9",
    "authorization": AUTH_TOKEN,
    "bb-ui-version": "bb-ui-v2",
    "cache-control": "no-cache",
    "priority": "u=1, i",
    "referer": "https://www.jobsatamazon.co.uk/application/uk/?locale=en-GB",
    "sec-ch-ua": "\"Google Chrome\";v=\"147\", \"Not.A/Brand\";v=\"8\", \"Chromium\";v=\"147\"",
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": "\"Windows\"",
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "cookie": COOKIE,
};

// Sentinel: when the response body matches this, stop the loop.
const STOP_ERROR_CODE = "FETCH_JOB_ERROR";
const STOP_ERROR_MESSAGE = "Unable to fetch job.";

// ---------- Helpers ----------
function jobIdFor(n) {
    return `JOB-UK-${String(n).padStart(10, '0')}`;
}

async function fetchJob(n) {
    const jobId = jobIdFor(n);
    const url = `https://www.jobsatamazon.co.uk/application/api/job/${jobId}?locale=en-GB`;

    const proxyUrl = proxyManager.getNextProxy(true);
    const proxyAgent = proxyManager.getProxyAgent(proxyUrl);
    const proxyInfo = proxyUrl ? proxyUrl.split('@')[1] || proxyUrl : 'No Proxy';

    const startTime = Date.now();
    const res = await fetch(url, { method: 'GET', headers: HEADERS, agent: proxyAgent });
    const latency = Date.now() - startTime;

    let json = null;
    try {
        json = await res.json();
    } catch {
        // Non-JSON body — treat as transient error, not the stop sentinel.
        proxyManager.reportFailure();
        return { jobId, latency, status: res.status, proxyInfo, ok: false, stop: false, error: `non-JSON body (HTTP ${res.status})` };
    }

    // Stop sentinel: the API explicitly says this id does not exist.
    if (json?.errorCode === STOP_ERROR_CODE || json?.errorMessage === STOP_ERROR_MESSAGE) {
        // Sentinel is a valid API response (not a proxy/network failure), so credit success.
        proxyManager.reportSuccess();
        return { jobId, latency, status: res.status, proxyInfo, ok: false, stop: true, error: json.errorMessage || json.errorCode };
    }

    if (!res.ok || !json?.data) {
        proxyManager.reportFailure();
        return { jobId, latency, status: res.status, proxyInfo, ok: false, stop: false, error: json?.errorMessage || `HTTP ${res.status}` };
    }

    proxyManager.reportSuccess();
    return { jobId, latency, status: res.status, proxyInfo, ok: true, stop: false, data: json };
}

// Bulky/HTML fields stripped from every entry before writing to jobs.json.
const EXCLUDED_FIELDS = ['image', 'jobPreviewVideo', 'jobDescription', 'detailedJobDescription'];

function saveJob(jobId, data) {
    if (seenJobIds.has(jobId)) return false; // skip duplicates on rerun
    const stripped = { ...data };
    for (const field of EXCLUDED_FIELDS) delete stripped[field];
    allJobs.push(stripped);
    seenJobIds.add(jobId);
    fs.writeFileSync(outFile, JSON.stringify(allJobs, null, 2), 'utf8');
    return true;
}

// ---------- Main loop ----------
async function main() {
    logger.info(`🚀 Starting fetch from ${jobIdFor(START_NUM)}`);
    logger.info(`📁 Saving to: ${outFile}  (${allJobs.length} existing entries)`);
    logger.info(`⏹️  Stops on response: { errorCode: "${STOP_ERROR_CODE}", errorMessage: "${STOP_ERROR_MESSAGE}" }`);
    logger.info(`⏱️  ${DELAY_MS}ms delay between requests`);
    logger.info(`🔄 Proxy Manager: ${proxyManager.getProxyCount()} proxies in current list`);
    logger.info('---');

    let n = START_NUM;
    let totalSaved = 0;
    let totalAttempts = 0;

    while (true) {
        totalAttempts++;
        let result;
        try {
            result = await fetchJob(n);
        } catch (err) {
            proxyManager.reportFailure();
            logger.warn(`⚠️  ${jobIdFor(n)}  network/parse error — ${err.message}  (retrying after delay)`);
            await new Promise((r) => setTimeout(r, DELAY_MS));
            continue;
        }

        if (result.stop) {
            logger.info(`🛑 ${result.jobId}  (${result.latency}ms, Proxy: ${result.proxyInfo})  stop sentinel — ${result.error}`);
            break;
        }

        if (result.ok) {
            // Unwrap: store the inner data object directly, not the {data, error, errorMessage} wrapper.
            const wrote = saveJob(result.jobId, result.data.data);
            if (wrote) {
                totalSaved++;
                logger.info(`✅ ${result.jobId}  (${result.latency}ms, Proxy: ${result.proxyInfo})  saved  (total: ${allJobs.length})`);
            } else {
                logger.info(`↷ ${result.jobId}  (${result.latency}ms, Proxy: ${result.proxyInfo})  already in file, skipped`);
            }
        } else {
            logger.error(`❌ ${result.jobId}  (${result.latency}ms, Proxy: ${result.proxyInfo})  ${result.error}`);
        }

        n++;
        await new Promise((r) => setTimeout(r, DELAY_MS));
    }

    logger.info('---');
    logger.info(`📊 Attempts: ${totalAttempts}  |  Saved: ${totalSaved}  |  Last id reached: ${jobIdFor(n)}`);
}

process.on('SIGINT', () => {
    logger.info('\n🛑 Interrupted by user.');
    process.exit(0);
});

main().catch((err) => {
    logger.error(`Fatal: ${err.message}`);
    process.exit(1);
});
