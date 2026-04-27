const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getCurrentDate() {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function getTimestamp() {
    return new Date().toISOString();
}

function log(message, level = 'INFO') {
    const timestamp = getTimestamp();
    const line = `[${timestamp}] [${level}] ${message}`;
    console.log(line);
    try {
        const logFilePath = path.join(logsDir, `${getCurrentDate()}.txt`);
        fs.appendFileSync(logFilePath, line + '\n', 'utf8');
    } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
    }
}

const info  = (m) => log(m, 'INFO');
const warn  = (m) => log(m, 'WARN');
const error = (m) => log(m, 'ERROR');
const debug = (m) => log(m, 'DEBUG');

module.exports = { log, info, warn, error, debug };
