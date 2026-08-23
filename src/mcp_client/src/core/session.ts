import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { ServerStatus } from "../types";
import { Tools } from "./tools";
import { logger } from "../utils/helpers";

const SERVER_PATH = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "mcp_server",
  "dist",
  "server.js"
);

export interface SessionState {
  client: Client | null;
  transport: StdioClientTransport | null;
  tools: Tools | null;
  status: ServerStatus;
}

export class Session {
  state: SessionState;

  constructor() {
    this.state = {
      client: null,
      transport: null,
      tools: null,
      status: ServerStatus.CLOSED,
    };
  }

  async initialize(): Promise<void> {
    if (this.state.status === ServerStatus.READY) {
      logger.debug({ header: "Agent already loaded" });
      return;
    }

    try {
      // (1) Initialize MCP Client
      // Bump V8 heap to 8 GB so the spawned mcp_server can hold large
      // import_json payloads (49 MB JSON × multiple copies during JSON-RPC
      // serialization + LLM tool-call buffering) without OOM-crashing.
      this.state.transport = new StdioClientTransport({
        command: "node",
        args: ["--max-old-space-size=8192", SERVER_PATH],
        stderr: "inherit", // forward mcp_server stderr so OOM/crash is visible
      } as any);
      this.state.client = new Client(
        { name: "mcp-client", version: "1.0.0" },
        { capabilities: {} }
      );
      this.state.client.connect(this.state.transport);

      // (2) Tool Loading
      this.state.tools = new Tools(this.state.client);
      await this.state.tools.loadTools();
      logger.info({
        header: "Tools loaded",
        body: `Loaded ${this.state.tools.catalogue.size} tools`,
      });
    } catch (error) {
      logger.error({
        header: "Failed to initialize agent",
        body: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (
      this.state.status !== ServerStatus.READY &&
      this.state.status !== ServerStatus.ERROR
    )
      return;

    try {
      if (this.state.client) {
        await this.state.client.close();
      }

      this.state.client = null;
      this.state.transport = null;
      this.state.tools?.catalogue.clear();
      this.state.tools = null;
      this.state.status = ServerStatus.CLOSED;

      logger.info({ header: "Agent shutdown complete" });
    } catch (error) {
      logger.error({
        header: "Error during shutdown",
        body: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export const globalSession = new Session();
