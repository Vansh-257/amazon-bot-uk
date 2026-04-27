// ─────────────────────────────────────────────────────────────────
// automation-login / auto-script / daemon.js
//
// 24×7 watcher. Every 30 seconds:
//   1. Read ../../db/user.json.
//   2. For each user with is_active=true, compute (now - last_active_at)
//      in UTC. If it's >= TOKEN_EXPIRY_THRESHOLD_MS (110 min) the
//      token is about to expire → trigger a login refresh.
//   3. Logins run in parallel (each picks its own proxy). A user
//      already in flight or with status='Processing' is skipped.
//
// CLI:
//   node automation-login/auto-script/daemon.js
// ─────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');
const { runLogin } = require('./index.js');

const USER_DB_PATH = path.join(__dirname, '..', '..', 'db', 'user.json');

const TICK_INTERVAL_MS          = 30_000;
const TOKEN_EXPIRY_THRESHOLD_MS = 110 * 60 * 1000;

const inflight = new Set();

const utc  = () => new Date().toISOString();
const dlog = (m) => console.log(`[${utc()}] [daemon] ${m}`);

function readUsers() {
    try {
        const raw = fs.readFileSync(USER_DB_PATH, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error(`[${utc()}] [daemon] error reading user.json: ${e.message}`);
        return [];
    }
}

function ageMs(row, nowMs) {
    if (!row.last_active_at) return Infinity;
    const t = Date.parse(row.last_active_at);
    if (!Number.isFinite(t)) return Infinity;
    return nowMs - t;
}

function tick() {
    const users = readUsers();
    const now   = Date.now();
    let active = 0, processing = 0, expired = 0, triggered = 0;

    for (const u of users) {
        if (!u || !u.email) continue;
        if (u.is_active !== true) continue;
        active++;
        if (u.status === 'Processing') { processing++; continue; }
        if (inflight.has(u.email)) continue;
        if (ageMs(u, now) < TOKEN_EXPIRY_THRESHOLD_MS) continue;
        expired++;

        inflight.add(u.email);
        triggered++;

        runLogin(u.email)
            .catch((err) => {
                console.error(`[${utc()}] [${u.email}] [daemon] giving up: ${err?.message || err}`);
            })
            .finally(() => {
                inflight.delete(u.email);
            });
    }

    dlog(`tick: total=${users.length} active=${active} processing=${processing} expired=${expired} inflight=${inflight.size} triggered=${triggered}`);
}

function start() {
    dlog(`starting — interval=${TICK_INTERVAL_MS / 1000}s, threshold=${TOKEN_EXPIRY_THRESHOLD_MS / 60_000}min, db=${USER_DB_PATH}`);
    tick();
    setInterval(tick, TICK_INTERVAL_MS);
}

if (require.main === module) start();

module.exports = { start, tick };
