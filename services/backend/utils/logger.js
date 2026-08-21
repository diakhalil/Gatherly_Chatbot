const fs = require("fs");
const path = require("path");

const logDir = path.join(__dirname, "..", "..", "..", "logs");
const logFile = path.join(logDir, "gatherly.log");

fs.mkdirSync(logDir, { recursive: true });

function write(level, message, extra) {
  const suffix = extra ? ` | ${extra}` : "";
  const line = `${new Date().toISOString()} | ${level} | backend | ${message}${suffix}\n`;
  fs.appendFileSync(logFile, line, "utf8");
}

module.exports = {
  info: (msg, extra) => write("INFO", msg, extra),
  warn: (msg, extra) => write("WARN", msg, extra),
  error: (msg, extra) => write("ERROR", msg, extra),
};
