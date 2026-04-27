// ─────────────────────────────────────────────────────────────────
// create-application / content.js
//
// Entry point: processSchedules(jobId, scheduleCards)
//
// Called by Schedule_api/content.js every time a schedule fetch
// returns scheduleCards for a jobId. Sorts by laborDemandAvailableCount
// DESC, pairs the top schedules with eligible users 1:1, and runs
// the full apply flow per pair in parallel:
//
//    create-application → save IDs to user.json
//      → update-application (20 retries on any non-200, different proxy each)
//      → WebSocket (close on stepName=assessment-consent)
//      → telegram on success
//
// Dedup:
//   - global Set of consumed scheduleIds, rebuilt on startup from
//     each user's `schedules` array in user.json
//   - in-memory inflight Set of users to prevent the same user being
//     paired with two schedules from parallel batches
// ─────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const logger = require('./logger.js');
const { createApplication } = require('./create-application.js');
const { updateApplication } = require('./update-application.js');
const { runWebSocket }      = require('./ws-runner.js');
const { sendTelegramMessage, CHANNEL_ID_UK_JOB_CONFIRMED } = require('../telegram/sendMessage.js');

const USER_DB_PATH = path.join(__dirname, '..', 'db', 'user.json');

// ── Consumed scheduleIds (global, rebuilt from user.json on startup) ──
const consumedScheduleIds = new Set();

function loadUsers() {
    try {
        const raw = fs.readFileSync(USER_DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        logger.error(`failed to read user.json: ${e.message}`);
        return [];
    }
}

function saveUsers(users) {
    try {
        fs.writeFileSync(USER_DB_PATH, JSON.stringify(users, null, 2) + '\n', 'utf8');
    } catch (e) {
        logger.error(`failed to write user.json: ${e.message}`);
    }
}

(function rebuildConsumed() {
    const users = loadUsers();
    let count = 0;
    for (const u of users) {
        if (Array.isArray(u.schedules)) {
            for (const s of u.schedules) {
                if (s) { consumedScheduleIds.add(s); count++; }
            }
        }
    }
    if (count > 0) logger.info(`[create-app] rebuilt consumedScheduleIds from user.json: ${count} entries`);
})();

// ── Inflight users — prevent the same user being paired twice in parallel batches ──
const inflightUsers = new Set();

function eligibleUsers(users) {
    // Allow both negative ids (priority users with preferences) and positive
    // ids (fallback users without preferences). Skip 0 / missing ids.
    return users.filter((u) =>
        u && u.is_active === true && u.token
        && typeof u.id === 'number' && u.id !== 0
        && !inflightUsers.has(u.email)
    );
}

// ── Preference matching ──────────────────────────────────────────
// Map a schedule's raw fields onto the user-preference vocabulary so the two
// sides can be compared directly.

function scheduleJobType(sc) {
    return (sc && sc.hoursPerWeek >= 30) ? 'full_time' : 'part_time';
}

function scheduleShiftType(sc) {
    const code = sc && sc.trainingShiftCode;
    if (!code) return null;
    const first = String(code).charAt(0).toUpperCase();
    if (first === 'D') return 'day';
    if (first === 'N') return 'night';
    return null;
}

// Each preference is treated as an optional filter: if the user has set it,
// the schedule must satisfy it; if the user hasn't set it (missing/empty),
// that dimension is not enforced. Returns { ok: bool, reason?: string }.
function matchPreferences(user, sc) {
    if (Array.isArray(user.location) && user.location.length > 0) {
        if (!sc.city || !user.location.includes(sc.city)) {
            return { ok: false, reason: `location ${sc.city || '∅'} not in ${JSON.stringify(user.location)}` };
        }
    }

    if (Array.isArray(user.job_type) && user.job_type.length > 0) {
        const t = scheduleJobType(sc);
        if (!user.job_type.includes(t)) {
            return { ok: false, reason: `job_type ${t} (hpw=${sc.hoursPerWeek}) not in ${JSON.stringify(user.job_type)}` };
        }
    }

    if (user.shift_type) {
        const s = scheduleShiftType(sc);
        if (s !== user.shift_type) {
            return { ok: false, reason: `shift_type ${s ?? '∅'} (code=${sc.trainingShiftCode}) ≠ ${user.shift_type}` };
        }
    }

    return { ok: true };
}

function applyResultToUser(email, applicationId, candidateId, scheduleId) {
    const users = loadUsers();
    const idx = users.findIndex((u) => u.email === email);
    if (idx === -1) return;
    users[idx].application_id = applicationId;
    users[idx].candidate_id   = candidateId;
    users[idx].applied_at     = new Date().toISOString();
    users[idx].updated_at     = users[idx].applied_at;
    if (!Array.isArray(users[idx].schedules)) users[idx].schedules = [];
    if (!users[idx].schedules.includes(scheduleId)) users[idx].schedules.push(scheduleId);
    saveUsers(users);
}

// ── Per-pair pipeline ────────────────────────────────────────────
async function applyOne(user, jobId, scheduleId) {
    const tag = `${user.email}/${jobId}/${scheduleId}`;
    inflightUsers.add(user.email);

    try {
        // 1. create-application — single shot
        logger.info(`[${tag}] create-application starting`);
        const created = await createApplication(user.token, jobId, scheduleId);
        if (!created.ok) {
            logger.error(`[${tag}] create-application failed: status=${created.status} ${created.error}`);
            return;
        }
        const { applicationId, candidateId: respCandidateId } = created;
        logger.info(`[${tag}] create-application ok appId=${applicationId} candidateId=${respCandidateId}`);

        // Save IDs to user.json before update-application — so we have the trail even if next steps fail.
        applyResultToUser(user.email, applicationId, respCandidateId, scheduleId);

        // 2. update-application — 20 retries, different proxy each
        logger.info(`[${tag}] update-application starting`);
        const updated = await updateApplication(user.token, applicationId, jobId, scheduleId);
        if (!updated.ok) {
            logger.error(`[${tag}] update-application FAILED after retries: status=${updated.status} ${updated.error}`);
            return;
        }
        logger.info(`[${tag}] update-application ok`);

        // 3. WebSocket — close on assessment-consent
        logger.info(`[${tag}] websocket starting`);
        const wsResult = await runWebSocket({
            applicationId,
            candidateId: respCandidateId,
            accessToken: user.token,
            jobId
        });
        if (!wsResult.ok) {
            logger.error(`[${tag}] websocket FAILED: ${wsResult.error}`);
            return;
        }

        // 4. Telegram — only on full success. Goes to the dedicated
        // job-confirmed channel.
        try {
            sendTelegramMessage(
                `✅ <b>Application Submitted</b>\n\n` +
                `📧 <b>Email:</b> ${user.email}\n` +
                `🆔 <b>Job:</b> ${jobId}\n` +
                `📅 <b>Schedule:</b> ${scheduleId}\n` +
                `🪪 <b>appId:</b> ${applicationId}\n` +
                `🕐 <b>Time:</b> ${new Date().toISOString()}`,
                CHANNEL_ID_UK_JOB_CONFIRMED
            );
        } catch (e) {
            logger.warn(`[${tag}] telegram error: ${e.message}`);
        }
        logger.info(`[${tag}] DONE`);
    } finally {
        inflightUsers.delete(user.email);
    }
}

// ── Public: dispatcher called per jobId by Schedule_api ──────────
async function processSchedules(jobId, scheduleCards) {
    if (!Array.isArray(scheduleCards) || scheduleCards.length === 0) return;

    // Sort by laborDemandAvailableCount DESC.
    const sorted = scheduleCards
        .filter((sc) => sc && sc.scheduleId)
        .sort((a, b) => (b.laborDemandAvailableCount || 0) - (a.laborDemandAvailableCount || 0));

    // Drop already-consumed scheduleIds (global dedup).
    const fresh = sorted.filter((sc) => !consumedScheduleIds.has(sc.scheduleId));
    if (fresh.length === 0) {
        logger.info(`[create-app] jobId=${jobId} no fresh schedules (all ${sorted.length} consumed)`);
        return;
    }

    // Pick eligible users (active, with token, id != 0, not currently in flight).
    // Sort ascending by id so negative-id users (operators with preferences) come
    // first; positive-id fallback users come after. The pairing loop below picks
    // the first user whose preferences match this schedule, so id<0 gets first
    // shot and id>0 acts as a wildcard fallback.
    const users = eligibleUsers(loadUsers()).sort((a, b) => a.id - b.id);
    if (users.length === 0) {
        logger.info(`[create-app] jobId=${jobId} no eligible users available`);
        return;
    }

    const priorityCount = users.filter((u) => u.id < 0).length;
    logger.info(
        `[create-app] jobId=${jobId} pairing ` +
        `(eligible-users=${users.length} [${priorityCount} priority + ${users.length - priorityCount} fallback], ` +
        `fresh-schedules=${fresh.length})`
    );

    const pairs = [];
    const availableUsers = [...users];

    for (const sc of fresh) {
        if (availableUsers.length === 0) break;

        let matchedIdx = -1;
        const reasons = [];
        for (let i = 0; i < availableUsers.length; i++) {
            const r = matchPreferences(availableUsers[i], sc);
            if (r.ok) { matchedIdx = i; break; }
            reasons.push(`${availableUsers[i].email}: ${r.reason}`);
        }

        if (matchedIdx === -1) {
            logger.info(
                `[create-app]   skip ${sc.scheduleId} — no preference match ` +
                `(city=${sc.city}, hpw=${sc.hoursPerWeek}, shift=${sc.trainingShiftCode}); ` +
                `tried: ${reasons.join(' | ')}`
            );
            continue;
        }

        const user = availableUsers.splice(matchedIdx, 1)[0];
        consumedScheduleIds.add(sc.scheduleId);   // mark consumed at pair time
        pairs.push({ user, scheduleId: sc.scheduleId });
        logger.info(
            `[create-app]   pair: ${user.email} ↔ ${sc.scheduleId} ` +
            `(city=${sc.city}, hpw=${sc.hoursPerWeek}, shift=${sc.trainingShiftCode}, ` +
            `laborDemandAvailableCount=${sc.laborDemandAvailableCount || 0})`
        );
    }

    if (pairs.length === 0) {
        logger.info(`[create-app] jobId=${jobId} no preference-matching pairs — skipping`);
        return;
    }

    const startedAt = Date.now();
    const results = await Promise.allSettled(pairs.map((p) => applyOne(p.user, jobId, p.scheduleId)));
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected  = results.length - fulfilled;
    logger.info(`[create-app] jobId=${jobId} parallel batch done in ${Date.now() - startedAt}ms — ${fulfilled}/${pairs.length} fulfilled, ${rejected} rejected`);
}

module.exports = { processSchedules };
