const utc = () => new Date().toISOString();

function info(message)  { console.log(`[${utc()}] [INFO] ${message}`); }
function warn(message)  { console.warn(`[${utc()}] [WARN] ${message}`); }
function error(message) { console.error(`[${utc()}] [ERROR] ${message}`); }
function debug(message) { console.log(`[${utc()}] [DEBUG] ${message}`); }

function forUser(email) {
    const full = (v) => {
        if (v == null) return "";
        return typeof v === "string" ? v : JSON.stringify(v);
    };
    const short = (v) => {
        const s = full(v);
        return s.length <= 7 ? s : s.slice(0, 7) + "...";
    };
    return {
        step:     (name)        => console.log(`[${utc()}] [${email}] [${name}]`),
        response: (name, body)  => console.log(`[${utc()}] [${email}] [${name}] response: ${short(body)}`),
        warn:     (name, body)  => console.warn(`[${utc()}] [${email}] [${name}] warn: ${full(body)}`),
        error:    (name, err)   => console.error(`[${utc()}] [${email}] [${name}] error: ${full(err?.message || err)}`)
    };
}

module.exports = { info, warn, error, debug, forUser };
