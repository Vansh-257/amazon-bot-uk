const fs = require('fs');
const path = require('path');

const POOL_PATH = path.join(__dirname, '..', '..', 'db', 'aws-waf-token.json');

function readPool() {
    try {
        const raw = fs.readFileSync(POOL_PATH, 'utf8');
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

function writePool(arr) {
    fs.writeFileSync(POOL_PATH, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}

// Returns the oldest token in the pool, or null if pool is empty.
// Does NOT remove — call removeToken on 403 to evict.
function peekToken() {
    const pool = readPool();
    if (pool.length === 0) return null;
    return pool[0]?.token || null;
}

function removeToken(tokenStr) {
    if (!tokenStr) return;
    const pool = readPool();
    const next = pool.filter((t) => t.token !== tokenStr);
    if (next.length !== pool.length) writePool(next);
}

function poolSize() {
    return readPool().length;
}

module.exports = { peekToken, removeToken, poolSize };
