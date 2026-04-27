const fs = require('fs');
const path = require('path');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

/**
 * Get the current date in YYYY-MM-DD format (using UTC to avoid timezone issues)
 * @returns {string} Date string
 */
function getCurrentDate() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Get the current timestamp in ISO format
 * @returns {string} Timestamp string
 */
function getTimestamp() {
    return new Date().toISOString();
}

/**
 * Log a message to both console and date-wise log file
 * @param {string} message - The message to log
 * @param {string} level - Log level (INFO, ERROR, WARN, DEBUG)
 */
function log(message, level = 'INFO') {
    const timestamp = getTimestamp();
    const logMessage = `[${timestamp}] [${level}] ${message}`;

    // Output to console
    console.log(logMessage);

    // Write to date-wise log file
    try {
        const dateStr = getCurrentDate();
        const logFilePath = path.join(logsDir, `${dateStr}.txt`);

        // Append to log file
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
