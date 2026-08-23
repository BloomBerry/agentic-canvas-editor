const COLORS = {
  GRAY: "\x1b[90m",
  SERVER: "\x1b[36m",
  RESET: "\x1b[0m",
  ITALIC: "\x1b[3m",
  ERROR: "\x1b[31m",
};

const SERVER_TAG = `${COLORS.SERVER}[MCP-SERVER]${COLORS.RESET}`;
const INFO_TAG = `[${COLORS.ITALIC}info${COLORS.RESET}]`;
const DEBUG_TAG = `[${COLORS.ITALIC}debug${COLORS.RESET}]`;
const WARN_TAG = `[${COLORS.ITALIC}warn${COLORS.RESET}]`;
const ERROR_TAG = `[${COLORS.ERROR}error${COLORS.RESET}]`;
const LOG_TAG = `[${COLORS.ITALIC}log${COLORS.RESET}]`;

type LogEntry = { header: string; body?: string };

const writeLog =
  (tag: string) =>
  ({ header, body }: LogEntry) =>
    process.stderr.write(
      `${SERVER_TAG}${tag} ${header}${
        body ? `\n${COLORS.GRAY}${body}${COLORS.RESET}` : ""
      }\n`
    );

export const logger = {
  info: writeLog(INFO_TAG),
  debug: writeLog(DEBUG_TAG),
  warn: writeLog(WARN_TAG),
  error: writeLog(ERROR_TAG),
  log: writeLog(LOG_TAG),
};

// Parse command-line arguments
const args = process.argv.slice(2);
const serverArg = args.find((arg) => arg.startsWith("--server="));
export const serverUrl = serverArg
  ? serverArg.split("=")[1]
  : process.env.SERVER_URL || process.env.VITE_SERVER_URL || "localhost";

export const WS_URL =
  serverUrl === "localhost" ? `ws://${serverUrl}` : `wss://${serverUrl}`;

export const SERVER_CONFIG = {
  name: "FigmaSlidesMCP",
  version: "1.0.0",
  defaultWebSocketPort: 3055,
  reconnectDelay: 2000,
  requestTimeout: 300000,
  extendedTimeout: 600000,
  importTimeout: 1800000,
};