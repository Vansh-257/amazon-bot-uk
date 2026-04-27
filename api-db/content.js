// ─────────────────────────────────────────────────────────────────
// api-db / content.js
//
// Lightweight HTTP server exposing one endpoint:
//   POST /api/fetch-schedule-uk
//     body: { "scheduleId": "33120", "type": "schedule" }
//        or { "jobId":      "500",   "type": "job" }
//
// Picks a random user from db/user.json that has a non-null token,
// calls Amazon's get-schedule-details API for SCH-UK-<padded-id>
// (type=schedule) or job API for JOB-UK-<padded-id> (type=job),
// retries with another random user on 401 (token expired). On any
// non-200 final outcome, the upstream Amazon status code and error
// body are passed through to the caller so they can see exactly
// what went wrong.
// ─────────────────────────────────────────────────────────────────

const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const path    = require('path');
const https   = require('https');

const app  = express();
const PORT = process.env.API_DB_PORT || 3011;

app.use(cors());
app.use(express.json());

const USER_JSON_PATH = path.join(__dirname, '..', 'db', 'user.json');

// Helper: HTTPS GET to Amazon UK schedule-details / job endpoint.
// Resolves with { status, data?, error?, body? } — never rejects.
function makeAmazonRequest(urlPath, token) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'www.jobsatamazon.co.uk',
            port: 443,
            path: urlPath,
            method: 'GET',
            headers: {
                'accept':           'application/json, text/plain, */*',
                'accept-language':  'en-GB,en;q=0.9',
                'authorization':    token,
                'cookie':           'adobe-session-id=8ed79696-fad1-426b-8e3c-1ccfaf4a9230; hvh-locale=en-GB; hvh-default-locale=en-GB; hvh-country-code=UK; hvh-stage=prod;',
                'bb-ui-version':    'bb-ui-v2',
                'user-agent':       'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode === 200) {
                    try {
                        const parsed = JSON.parse(data);
                        resolve({ status: 200, data: parsed?.data || null });
                    } catch (e) {
                        resolve({ status: 500, error: 'Invalid JSON response from Amazon', body: data });
                    }
                    return;
                }
                // Non-200: extract a useful error message from the body.
                let errorMsg;
                let parsedBody = null;
                try {
                    parsedBody = JSON.parse(data);
                    errorMsg = parsedBody.errorMessage || parsedBody.message || JSON.stringify(parsedBody);
                } catch {
                    errorMsg = data || `Amazon responded with status: ${res.statusCode}`;
                }
                resolve({ status: res.statusCode, error: errorMsg, body: parsedBody ?? data });
            });
        });
        req.on('error', (e) => resolve({ status: 500, error: e.message }));
        req.end();
    });
}

// POST /api/fetch-schedule-uk — body: { scheduleId | jobId, type }
app.post('/api/fetch-schedule-uk', async (req, res) => {
    try {
        const { scheduleId, jobId, type } = req.body || {};

        // Resolve type + raw id. Default to "schedule" when type omitted but
        // scheduleId is present (back-compat).
        let resolvedType = type;
        let rawId;
        if (resolvedType === 'job') {
            rawId = jobId;
        } else if (resolvedType === 'schedule') {
            rawId = scheduleId;
        } else if (jobId) {
            resolvedType = 'job';
            rawId = jobId;
        } else if (scheduleId) {
            resolvedType = 'schedule';
            rawId = scheduleId;
        }

        if (!rawId) {
            return res.status(400).json({
                success: false,
                error: 'scheduleId or jobId is required (with type="schedule" or "job")'
            });
        }

        const formattedId = String(rawId).padStart(10, '0');
        const prefix      = resolvedType === 'job' ? 'JOB-UK' : 'SCH-UK';
        const urlPath     = resolvedType === 'job'
            ? `/application/api/job/${prefix}-${formattedId}?locale=en-GB`
            : `/application/api/job/get-schedule-details/${prefix}-${formattedId}?locale=en-GB`;

        if (!fs.existsSync(USER_JSON_PATH)) {
            return res.status(500).json({ success: false, error: 'user.json not found' });
        }

        const users = JSON.parse(fs.readFileSync(USER_JSON_PATH, 'utf8'));
        const usersWithTokens = users.filter((u) => u.token && u.id > 0);

        if (usersWithTokens.length === 0) {
            return res.status(500).json({ success: false, error: 'No valid users with tokens found' });
        }

        // Random pick + retry on 401 (or any non-200) until pool is empty.
        let lastResponse = null;
        const remaining = [...usersWithTokens];
        while (remaining.length > 0) {
            const idx  = Math.floor(Math.random() * remaining.length);
            const user = remaining.splice(idx, 1)[0];

            console.log(`Fetching ${prefix}-${formattedId} with user ID ${user.id}...`);
            const response = await makeAmazonRequest(urlPath, user.token);
            lastResponse = response;

            if (response.status === 200) {
                const result = response.data;
                if (!result) {
                    return res.status(404).json({
                        success: false,
                        error: `${resolvedType === 'job' ? 'Job' : 'Schedule'} data not found or null`
                    });
                }
                if (resolvedType === 'schedule') {
                    delete result.jobPreviewVideo;
                    delete result.jobDescription;
                }
                return res.json({ success: true, type: resolvedType, data: result });
            }

            if (response.status === 401) {
                console.log(`Token expired for user ID ${user.id}, picking another...`);
                continue;
            }

            console.log(`Amazon returned ${response.status} for user ID ${user.id}: ${response.error}`);
            // Other non-200 responses still let us try another user — the failure
            // might be token-specific. Keep going.
        }

        // All users exhausted — pass through the last upstream status & error
        // so the caller can see exactly what Amazon said.
        const status = lastResponse?.status || 500;
        return res.status(status).json({
            success: false,
            status,
            error: lastResponse?.error || 'All available user tokens are expired or unauthorized',
            body: lastResponse?.body
        });
    } catch (error) {
        console.error('Error in /api/fetch-schedule-uk:', error);
        return res.status(500).json({ success: false, error: `Internal server error: ${error.message}` });
    }
});

app.listen(PORT, () => {
    console.log(`api-db server listening on port ${PORT}`);
});

module.exports = app;
