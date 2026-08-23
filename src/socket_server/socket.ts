import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";

const COLORS = {
  GRAY: "\x1b[90m",
  RESET: "\x1b[0m",
};

type LogEntry = { header: string; body?: string };

const writeLog =
  (level: string) =>
  ({ header, body }: LogEntry) =>
    process.stderr.write(
      `[${level}][socket-server] ${header} ${
        body ? `\n${COLORS.GRAY}${body}${COLORS.RESET}` : ""
      }\n`
    );

export const logger = {
  info: writeLog("INFO"),
  debug: writeLog("DEBUG"),
  warn: writeLog("WARN"),
  error: writeLog("ERROR"),
  log: writeLog("LOG"),
};

interface ClientInfo {
  ws: WebSocket;
  channel: string | null;
  clientType: string;
}

enum MessageSource {
  SOCKET_SERVER = "socket_server",
  MCP_SERVER = "mcp_server",
  FIGMA_CLIENT = "figma_client",
  UNKNOWN = "unknown",
}

enum MessageType {
  GET_CHANNELS = "get_channels",
  SELECT_CHANNEL = "select_channel",
  CHECK_CONNECTION_STATUS = "check_connection_status",
  JOIN = "join",
  MESSAGE = "message",
  NOTIFY = "notify",
  TRANSMIT = "transmit",
  JOIN_RESULT = "join_result",
  ERROR = "error",
  CONNECTION = "connection",
}

interface Message {
  source: MessageSource;
  type: MessageType;
  payload?: any;
}

const clients = new Map<WebSocket, ClientInfo>();
const availableChannels = [
  "channel_1",
  "channel_2",
  "channel_3",
  "channel_4",
  "channel_5",
];

function handleGetChannels(ws: WebSocket, message: Message): void {
  const clientInfo = clients.get(ws);
  logger.info({
    header: `WebSocket client requested channel list`,
    body: `Client type: ${clientInfo?.clientType || MessageSource.UNKNOWN}`,
  });

  ws.send(
    JSON.stringify({
      source: MessageSource.SOCKET_SERVER,
      type: MessageType.GET_CHANNELS,
      payload: {
        id: message.payload?.id,
        channels: availableChannels,
      },
    })
  );
}

function handleJoinChannel(ws: WebSocket, message: Message): void {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const { channel, clientType = MessageSource.UNKNOWN } = message.payload || {};

  if (!availableChannels.includes(channel)) {
    ws.send(
      JSON.stringify({
        source: MessageSource.SOCKET_SERVER,
        type: MessageType.JOIN_RESULT,
        payload: {
          success: false,
          error: "Invalid channel",
          channel,
        },
      })
    );
    return;
  }

  const oldChannel = clientInfo.channel;
  clientInfo.channel = channel;
  clientInfo.clientType = clientType;

  logger.info({
    header: `WebSocket client joined channel`,
    body: `Channel: ${channel}, Client type: ${clientType}`,
  });

  if (oldChannel && oldChannel !== channel) {
    broadcastToChannel(
      oldChannel,
      {
        source: MessageSource.SOCKET_SERVER,
        type: MessageType.NOTIFY,
        payload: {
          channel: oldChannel,
          message: `A ${clientType} has left the channel`,
        },
      },
      ws
    );
  }

  broadcastToChannel(
    channel,
    {
      source: MessageSource.SOCKET_SERVER,
      type: MessageType.NOTIFY,
      payload: {
        channel,
        message: `A ${clientType} has joined the channel`,
      },
    },
    ws
  );

  ws.send(
    JSON.stringify({
      source: MessageSource.SOCKET_SERVER,
      type: MessageType.JOIN_RESULT,
      payload: {
        success: true,
        channel,
      },
    })
  );
}

function handleMessage(ws: WebSocket, message: Message): void {
  const clientInfo = clients.get(ws);
  const channel = message.payload?.channel || clientInfo?.channel;

  if (!channel) {
    ws.send(
      JSON.stringify({
        source: MessageSource.SOCKET_SERVER,
        type: MessageType.ERROR,
        payload: {
          message: "No channel specified",
        },
      })
    );
    return;
  }

  logger.info({
    header: `Broadcasting message to channel`,
    body: `Channel: ${channel}, Sender: ${clientInfo?.clientType || "unknown"}`,
  });

  const messageData = message.payload?.message;
  if (messageData && !messageData.channel) {
    messageData.channel = channel;
  }

  broadcastToChannel(channel, {
    source: MessageSource.SOCKET_SERVER,
    type: MessageType.TRANSMIT,
    payload: {
      channel,
      message: messageData,
      sender: clientInfo?.clientType || MessageSource.UNKNOWN,
    },
  });
}

function handleClientDisconnect(ws: WebSocket): void {
  const clientInfo = clients.get(ws);
  logger.info({
    header: `WebSocket client disconnected`,
    body: `Client type: ${clientInfo?.clientType || MessageSource.UNKNOWN}`,
  });

  const channel = clientInfo?.channel;
  clients.delete(ws);

  if (channel && clientInfo) {
    broadcastToChannel(
      channel,
      {
        source: MessageSource.SOCKET_SERVER,
        type: MessageType.NOTIFY,
        payload: {
          channel,
          message: `A ${
            clientInfo.clientType || MessageSource.UNKNOWN
          } has left the channel`,
        },
      },
      ws
    );
  }
}

function broadcastToChannel(
  channel: string,
  message: Message,
  excludeClient?: WebSocket
): void {
  for (const clientInfo of clients.values()) {
    if (
      clientInfo.channel === channel &&
      clientInfo.ws !== excludeClient &&
      clientInfo.ws.readyState === WebSocket.OPEN
    ) {
      clientInfo.ws.send(JSON.stringify(message));
    }
  }
}

/** Truncate long string values (e.g. base64 imageData) for readable logs. */
function truncateForLog(raw: string, maxLen = 200): string {
  try {
    const obj = JSON.parse(raw);
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === "string" && value.length > maxLen) {
        return value.slice(0, maxLen) + `...[${value.length} chars]`;
      }
      return value;
    });
  } catch {
    return raw.length > maxLen ? raw.slice(0, maxLen) + `...[${raw.length} chars]` : raw;
  }
}

// --- Heartbeat: ping all clients periodically to keep connections alive ---
// Long-running imports (e.g. 100+ slide JSON_REST_V1) keep the Figma plugin's
// JS thread busy and prevent it from emitting pongs. To avoid killing healthy
// but busy clients, terminate only after MAX_MISSED_PONGS consecutive misses.
const HEARTBEAT_INTERVAL = 30_000;
const MAX_MISSED_PONGS = 60; // 60 * 30s = 30 min grace before termination
const missedPongs = new WeakMap<WebSocket, number>();

function handleConnection(ws: WebSocket) {
  clients.set(ws, {
    ws,
    channel: null,
    clientType: MessageSource.UNKNOWN,
  });
  missedPongs.set(ws, 0);

  ws.on("pong", () => missedPongs.set(ws, 0));

  ws.send(
    JSON.stringify({
      source: MessageSource.SOCKET_SERVER,
      type: MessageType.CONNECTION,
      payload: {
        message: "Connected to WebSocket",
      },
    })
  );

  ws.on("close", () => handleClientDisconnect(ws));

  ws.on("error", (error: Error) => {
    logger.error({
      header: `WebSocket client error`,
      body: error.message,
    });
  });

  ws.on("message", (messageBuffer: Buffer) => {
    try {
      logger.debug({
        header: `Received message from websocket client`,
        body: truncateForLog(messageBuffer.toString()),
      });
      const message: Message = JSON.parse(messageBuffer.toString());

      switch (message.type) {
        case MessageType.GET_CHANNELS:
          handleGetChannels(ws, message);
          break;
        case MessageType.JOIN:
          handleJoinChannel(ws, message);
          break;
        case MessageType.MESSAGE:
          handleMessage(ws, message);
          break;
        default:
          ws.send(
            JSON.stringify({
              source: MessageSource.SOCKET_SERVER,
              type: MessageType.ERROR,
              payload: {
                message: "Unknown message type",
              },
            })
          );
      }
    } catch (err) {
      logger.error({
        header: `Error handling message`,
        body: err instanceof Error ? err.message : String(err),
      });
      ws.send(
        JSON.stringify({
          source: MessageSource.SOCKET_SERVER,
          type: MessageType.ERROR,
          payload: {
            message: "Error processing message",
          },
        })
      );
    }
  });
}

const server = createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    res.end();
    return;
  }

  res.writeHead(200, {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "text/plain",
  });
  res.end("WebSocket server running");
});

// Disable Node's HTTP request/socket timeouts so they cannot kill long-lived
// upgraded WebSocket connections. Long Figma plugin operations (import_json
// for 100+ slide decks) must not be cut off by Node 18+'s default
// requestTimeout of 5 minutes or the legacy idle socket timeout.
server.timeout = 0;
server.keepAliveTimeout = 0;
server.headersTimeout = 0;
(server as any).requestTimeout = 0;

const wss = new WebSocketServer({
  server,
  verifyClient: () => true,
  maxPayload: 200 * 1024 * 1024, // 200 MB – allow large Figma document payloads
});

wss.on("connection", handleConnection);

// Heartbeat loop: ping every HEARTBEAT_INTERVAL, terminate only after the
// client has missed MAX_MISSED_PONGS consecutive pongs. This tolerates long
// blocking operations on the plugin side (e.g. importing 100+ slide JSON
// where the JS thread cannot service incoming WebSocket frames in time).
setInterval(() => {
  for (const client of wss.clients) {
    const missed = (missedPongs.get(client) ?? 0) + 1;
    if (missed >= MAX_MISSED_PONGS) {
      logger.warn({
        header: `Terminating unresponsive WebSocket client (${missed} consecutive missed pongs)`,
      });
      client.terminate();
      missedPongs.delete(client);
      continue;
    }
    missedPongs.set(client, missed);
    client.ping();
  }
}, HEARTBEAT_INTERVAL);

const PORT = 3055;
server.listen(PORT, () => {
  logger.info({
    header: `WebSocket server running (heartbeat every ${HEARTBEAT_INTERVAL / 1000}s)`,
    body: `Port: ${PORT}, Available channels: ${availableChannels.join(", ")}`,
  });
});