#!/usr/bin/env node

// Must be the very first import — populates process.env from config.env before
// any other module's top-level code runs (e.g. batch_toggle reading env).
import "./env_loader.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { logger, SERVER_CONFIG } from "./config.js";
import { connectToFigma } from "./common/websocket.js";

import { registerConnectionTools } from "./tools/connectionTools.js";
import { registerSlideTools } from "./tools/slideTools.js";
import { registerContentTools } from "./tools/contentTools.js";
import { registerChartTools } from "./tools/chartTools.js";
import { registerDataChartTools } from "./tools/dataChartTools.js";
import { registerTableTools } from "./tools/tableTools.js";
import { registerMathTools } from "./tools/mathTools.js";
import { registerImportExportTools } from "./tools/importExportTools.js";
import { registerBatchTools } from "./tools/batchTools.js";
import { registerSmartArtTools } from "./tools/smartArtTools.js";
import { registerUnsplashTools } from "./tools/unsplashTools.js";

const server = new McpServer({
  name: SERVER_CONFIG.name,
  version: SERVER_CONFIG.version,
});

// Register all tools
registerConnectionTools(server);
registerSlideTools(server);
registerContentTools(server);
registerChartTools(server);
registerDataChartTools(server);
registerTableTools(server);
registerMathTools(server);
registerImportExportTools(server);
// Ablation toggle — three modes, controlled by env vars (see batch_toggle.ts
// in mcp_client/ for the matching prompt-side switch):
//   default                    → register batch_execute (batch mode)
//   DISABLE_BATCH_EXECUTE=1    → omit batch_execute (parallel-FC mode)
//   SEQUENTIAL_MODE=1          → omit batch_execute (stop-and-wait mode)
const batchDisabled =
  process.env.SEQUENTIAL_MODE === "1" ||
  process.env.DISABLE_BATCH_EXECUTE === "1";
if (!batchDisabled) {
  registerBatchTools(server);
} else {
  const reason = process.env.SEQUENTIAL_MODE === "1"
    ? "SEQUENTIAL_MODE=1"
    : "DISABLE_BATCH_EXECUTE=1";
  logger.info({ header: `batch_execute disabled by ${reason}` });
}
registerSmartArtTools(server);
registerUnsplashTools(server);

async function main() {
  try {
    connectToFigma();
  } catch (error) {
    logger.warn({
      header: "Could not connect to Figma initially",
      body: `${error instanceof Error ? error.message : String(error)}`,
    });
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info({
    header: `MCP server running on stdio`,
  });
}

main().catch((error) => {
  logger.error({
    header: "Error starting MCP server",
    body: `${error instanceof Error ? error.message : String(error)}`,
  });
  process.exit(1);
});
