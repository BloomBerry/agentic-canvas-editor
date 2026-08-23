import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import {
  FigmaCommand,
  PendingRequest,
  ProgressMessage,
  CommandProgressUpdate,
} from "../types.js";
import { logger, serverUrl, WS_URL, SERVER_CONFIG } from "../config.js";

enum MessageSource {
  SOCKET_SERVER = "socket_server",
  MCP_SERVER = "mcp_server",
  FIGMA_CLIENT = "figma_client",
  UNKNOWN = "unknown",
}

enum MessageType {
  GET_CHANNELS = "get_channels",
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

/** Truncate long string values (e.g. base64 imageData) for readable logs. */
function truncateForLog(obj: unknown, maxLen = 200, maxTotal = 1000): string {
  const full = JSON.stringify(obj, (_key, value) => {
    if (typeof value === "string" && value.length > maxLen) {
      return value.slice(0, maxLen) + `...[${value.length} chars]`;
    }
    return value;
  });
  if (full.length > maxTotal) {
    return full.slice(0, maxTotal) + `...[${full.length} chars total]`;
  }
  return full;
}

let ws: WebSocket | null = null;
let currentChannel: string | null = null;
const pendingRequests = new Map<string, PendingRequest>();

export function getWebSocket(): WebSocket | null {
  return ws;
}

export function getCurrentChannel(): string | null {
  return currentChannel;
}

export function connectToFigma(
  port: number = SERVER_CONFIG.defaultWebSocketPort
) {
  if (
    ws &&
    (ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING)
  ) {
    logger.info({ header: "Already connected/connecting to Figma" });
    return;
  }

  const wsUrl = serverUrl === "localhost" ? `${WS_URL}:${port}` : WS_URL;
  logger.info({
    header: `Connecting to Figma socket server`,
    body: `URL: ${wsUrl}`,
  });
  ws = new WebSocket(wsUrl);
  const localWs = ws;

  localWs.on("open", () => {
    logger.info({ header: "Connected to Figma socket server" });

    const id = uuidv4();
    const message: Message = {
      source: MessageSource.MCP_SERVER,
      type: MessageType.GET_CHANNELS,
      payload: {
        id,
      },
    };

    localWs.send(JSON.stringify(message));
  });

  localWs.on("message", (data: any) => {
    handleWebSocketMessage(data);
  });

  localWs.on("ping", () => {
    logger.debug({ header: "Received ping from socket server (auto-pong)" });
  });

  localWs.on("error", (error: Error) => {
    logger.error({ header: `Socket error: ${error}` });
  });

  localWs.on("close", () => {
    logger.info({ header: "Disconnected from Figma socket server" });
    ws = null;
    currentChannel = null;

    for (const [id, request] of pendingRequests.entries()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Connection closed"));
      pendingRequests.delete(id);
    }

    logger.info({
      header: `Attempting to reconnect in ${
        SERVER_CONFIG.reconnectDelay / 1000
      } seconds...`,
    });
    setTimeout(() => connectToFigma(port), SERVER_CONFIG.reconnectDelay);
  });
}

function handleWebSocketMessage(data: any) {
  try {
    const message = JSON.parse(data) as Message;
    logger.debug({
      header: `Received message`,
      body: truncateForLog(message),
    });

    switch (message.type) {
      case MessageType.CONNECTION:
        logger.info({ header: "Connection confirmed by socket server" });
        break;

      case MessageType.GET_CHANNELS:
        handleChannelList(message.payload?.channels);
        break;

      case MessageType.JOIN_RESULT:
        handleJoinResult(message.payload);
        break;

      case MessageType.ERROR:
        logger.error({
          header: `Socket server error`,
          body: `${message.payload?.message}`,
        });
        break;

      case MessageType.NOTIFY:
        if (
          currentChannel &&
          message.payload?.channel &&
          message.payload.channel !== currentChannel
        ) {
          return;
        }
        logger.info({ header: `Notification: ${message.payload?.message}` });
        break;

      case MessageType.TRANSMIT:
        if (
          currentChannel &&
          message.payload?.channel &&
          message.payload.channel !== currentChannel
        ) {
          return;
        }
        handleTransmittedMessage(message.payload);
        break;

      default:
        logger.warn({ header: `Unknown message type: ${message.type}` });
    }
  } catch (error) {
    logger.error({
      header: `Error parsing message`,
      body: `${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

function handleChannelList(channels: string[]): void {
  if (!Array.isArray(channels) || channels.length === 0) {
    logger.warn({ header: "No channels available from server" });
    return;
  }

  logger.info({
    header: `Available channels`,
    body: `${channels.join(", ")}`,
  });

  if (!currentChannel && channels.length > 0) {
    const channelToJoin = channels[0];
    logger.info({ header: `Auto-joining channel: ${channelToJoin}` });

    const joinMessage: Message = {
      source: MessageSource.MCP_SERVER,
      type: MessageType.JOIN,
      payload: {
        channel: channelToJoin,
        clientType: MessageSource.MCP_SERVER,
      },
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(joinMessage));
    } else {
      logger.warn({ header: "Cannot join channel: WebSocket not open" });
    }
  }
}

function handleJoinResult(payload: any): void {
  if (payload?.success) {
    currentChannel = payload.channel || null;
    logger.info({ header: `Successfully joined channel: ${currentChannel}` });
  } else {
    logger.error({
      header: `Failed to join channel: ${payload?.error || "Unknown error"}`,
    });
  }
}

function handleTransmittedMessage(payload: any): void {
  const messageData = payload.message;

  if (!messageData) {
    logger.warn({ header: "Received transmit message without message data" });
    return;
  }

  if (messageData.type === "progress_update") {
    handleProgressUpdate(messageData);
    return;
  }

  if (
    messageData.id &&
    pendingRequests.has(messageData.id) &&
    (messageData.result !== undefined || messageData.error !== undefined)
  ) {
    const request = pendingRequests.get(messageData.id)!;
    clearTimeout(request.timeout);

    if (messageData.error) {
      logger.error({ header: `Error from Figma: ${messageData.error}` });
      request.reject(new Error(messageData.error));
    } else {
      const result = messageData.result || {};
      request.resolve(result);
    }

    pendingRequests.delete(messageData.id);
  } else {
    logger.info({
      header: `Received broadcast message`,
      body: truncateForLog(messageData),
    });
  }
}

function handleProgressUpdate(messageData: any) {
  const progressData = messageData.data as CommandProgressUpdate;
  const requestId = messageData.id || "";

  if (requestId && pendingRequests.has(requestId)) {
    const request = pendingRequests.get(requestId)!;

    request.lastActivity = Date.now();

    clearTimeout(request.timeout);

    request.timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        logger.error({
          header: `Request ${requestId} timed out after extended period of inactivity`,
        });
        pendingRequests.delete(requestId);
        request.reject(new Error("Request to Figma timed out"));
      }
    }, SERVER_CONFIG.extendedTimeout);

    logger.info({
      header: `Progress update for ${progressData.commandType}`,
      body: `${progressData.progress}% - ${progressData.message}`,
    });

    if (progressData.status === "completed" && progressData.progress === 100) {
      logger.info({
        header: `Operation ${progressData.commandType} completed, waiting for final result`,
      });
    }
  }
}

export function sendCommandToFigma(
  command: FigmaCommand,
  params: unknown = {},
  timeoutMs: number = SERVER_CONFIG.requestTimeout
): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectToFigma();
      reject(new Error("Not connected to Figma. Attempting to connect..."));
      return;
    }

    if (!currentChannel) {
      reject(
        new Error(
          "Not connected to any channel. Please wait for channel connection."
        )
      );
      return;
    }

    const id = uuidv4();
    const message: Message = {
      source: MessageSource.MCP_SERVER,
      type: MessageType.MESSAGE,
      payload: {
        channel: currentChannel,
        message: {
          id,
          command,
          params: {
            ...(params as any),
            commandId: id,
          },
        },
      },
    };

    const timeout = setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        logger.error({
          header: `Request ${id} to Figma timed out after ${
            timeoutMs / 1000
          } seconds`,
        });
        reject(new Error("Request to Figma timed out"));
      }
    }, timeoutMs);

    pendingRequests.set(id, {
      resolve,
      reject,
      timeout,
      lastActivity: Date.now(),
    });

    logger.info({
      header: `Sending command to Figma: ${command} in channel (${currentChannel})`,
    });
    logger.debug({
      header: ``,
      body: truncateForLog(message),
    });
    ws.send(JSON.stringify(message));
  });
}
