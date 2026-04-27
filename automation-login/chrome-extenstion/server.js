const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '3010', 10);

// server.js lives at: hiring-amazon-uk/automation-login/chrome-extenstion/server.js
// db file lives at:   hiring-amazon-uk/db/aws-waf-token.json
const DB_PATH = path.resolve(__dirname, '..', '..', 'db', 'aws-waf-token.json');

function ensureDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, '[]\n', 'utf8');
}

function readTokens() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr;
  } catch (err) {
    console.warn('[server] could not parse db, resetting:', err.message);
  }
  return [];
}

function writeTokens(arr) {
  const tmp = DB_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(arr, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

function addToken(token, capturedAt, source) {
  const tokens = readTokens();
  if (tokens.some((t) => t && t.token === token)) {
    return { added: false, total: tokens.length };
  }
  tokens.push({ token, capturedAt, source });
  writeTokens(tokens);
  return { added: true, total: tokens.length };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // CORS — extension fetches don't strictly need this, but it's harmless
  // and makes manual curl/browser testing easier.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    const tokens = readTokens();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, count: tokens.length, dbPath: DB_PATH }));
    return;
  }

  if (req.method === 'GET' && req.url === '/tokens') {
    const tokens = readTokens();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tokens, null, 2));
    return;
  }

  if (req.method === 'POST' && req.url === '/token') {
    try {
      const body = await readBody(req);
      const parsed = JSON.parse(body || '{}');
      const token = parsed.token;
      const source = parsed.source || 'unknown';
      const capturedAt = parsed.capturedAt || new Date().toISOString();

      if (!token || typeof token !== 'string') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'missing token' }));
        return;
      }

      const result = addToken(token, capturedAt, source);
      const tag = result.added ? 'NEW' : 'DUP';
      const preview = token.length > 32 ? token.slice(0, 32) + '...' : token;
      console.log(
        `[${new Date().toISOString()}] ${tag} src=${source} total=${result.total} token=${preview}`
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, ...result }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

ensureDb();
server.listen(PORT, () => {
  console.log(`[server] aws-waf-token sink listening on http://localhost:${PORT}`);
  console.log(`[server] writing to: ${DB_PATH}`);
  console.log(`[server] endpoints: POST /token  GET /tokens  GET /health`);
});
