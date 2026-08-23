// Must be the very first import — populates process.env from .env / config.env
// before any other module's top-level code runs. See env_loader.ts.
import "./env_loader";

import express from "express";
import { createRoutes } from "./routes";
import { globalSession } from "./core/session";
import { ServerStatus } from "./types";
import { logger } from "./utils/helpers";

const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = portArg ? parseInt(portArg.split("=")[1], 10) : 3001;

const initializeServer = async () => {
  try {
    await globalSession.initialize();
    globalSession.state.status = ServerStatus.READY;
    logger.info({ header: "MCP Client initialization complete" });
  } catch (error) {
    logger.error({
      header: "Failed to initialize MCP client",
      body: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
};

const shutdownServer = async () => {
  if (globalSession.state.status === ServerStatus.CLOSING) {
    logger.info({ header: "Server is already shutting down..." });
    return;
  }
  globalSession.state.status = ServerStatus.CLOSING;
  logger.info({ header: "Shutting down gracefully..." });
  try {
    await globalSession.shutdown();
    logger.info({ header: "MCP Client shutdown complete" });
    globalSession.state.status = ServerStatus.CLOSED;
    process.exit(0);
  } catch (error) {
    logger.error({
      header: "Error during shutdown",
      body: error instanceof Error ? error.message : String(error),
    });
    globalSession.state.status = ServerStatus.ERROR;
    process.exit(1);
  }
};

process.on("SIGINT", shutdownServer);
process.on("SIGTERM", shutdownServer);

// (1) Initialize the Express application
const app = express();
app.use(express.json({ limit: "200mb" }));
app.use(express.urlencoded({ limit: "200mb", extended: true }));

// (2) Routing setup
app.use("/", createRoutes());

// (3) Server initialization
const httpServer = app.listen(PORT, () => {
  try {
    initializeServer();
  } catch (error) {
    logger.error({
      header: "Error during server initialization",
      body: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
  logger.info({
    header: `Start MCP client initialization`,
    body: `Server is running on port ${PORT}`,
  });
});

// Disable Node's HTTP request/socket timeouts so a long-running
// /modification request (LLM agent + multi-minute import_json tool calls)
// cannot be cut off by the default 5-minute requestTimeout introduced in
// Node 18+, nor by the idle socket timeout.
httpServer.timeout = 0;
httpServer.keepAliveTimeout = 0;
httpServer.headersTimeout = 0;
(httpServer as any).requestTimeout = 0;
