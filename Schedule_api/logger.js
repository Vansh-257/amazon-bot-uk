const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getCurrentDate() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getTimestamp() {
    return new Date().toISOString();
}

function log(message, level = 'INFO') {
    const timestamp = getTimestamp();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    try {
        const dateStr = getCurrentDate();
        const logFilePath = path.join(logsDir, `${dateStr}.txt`);
        fs.appendFileSync(logFilePath, logMessage + '\n', 'utf8');
    } catch (error) {
        console.error(`Failed to write to log file: ${error.message}`);
    }
}

function info(message) {
    log(message, 'INFO');
}

function error(message) {
    log(message, 'ERROR');
}

function warn(message) {
    log(message, 'WARN');
}

function debug(message) {
    log(message, 'DEBUG');
}

module.exports = {
    log,
    info,
    error,
    warn,
    debug,
};
