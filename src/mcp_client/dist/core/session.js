"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.globalSession = exports.Session = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const path_1 = __importDefault(require("path"));
const types_1 = require("../types");
const tools_1 = require("./tools");
const helpers_1 = require("../utils/helpers");
const SERVER_PATH = path_1.default.join(__dirname, "..", "..", "..", "mcp_server", "dist", "server.js");
class Session {
    constructor() {
        this.state = {
            client: null,
            transport: null,
            tools: null,
            status: types_1.ServerStatus.CLOSED,
        };
    }
    async initialize() {
        if (this.state.status === types_1.ServerStatus.READY) {
            helpers_1.logger.debug({ header: "Agent already loaded" });
            return;
        }
        try {
            // (1) Initialize MCP Client
            // Bump V8 heap to 8 GB so the spawned mcp_server can hold large
            // import_json payloads (49 MB JSON × multiple copies during JSON-RPC
            // serialization + LLM tool-call buffering) without OOM-crashing.
            this.state.transport = new stdio_js_1.StdioClientTransport({
                command: "node",
                args: ["--max-old-space-size=8192", SERVER_PATH],
                stderr: "inherit", // forward mcp_server stderr so OOM/crash is visible
            });
            this.state.client = new index_js_1.Client({ name: "mcp-client", version: "1.0.0" }, { capabilities: {} });
            this.state.client.connect(this.state.transport);
            // (2) Tool Loading
            this.state.tools = new tools_1.Tools(this.state.client);
            await this.state.tools.loadTools();
            helpers_1.logger.info({
                header: "Tools loaded",
                body: `Loaded ${this.state.tools.catalogue.size} tools`,
            });
        }
        catch (error) {
            helpers_1.logger.error({
                header: "Failed to initialize agent",
                body: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }
    }
    async shutdown() {
        if (this.state.status !== types_1.ServerStatus.READY &&
            this.state.status !== types_1.ServerStatus.ERROR)
            return;
        try {
            if (this.state.client) {
                await this.state.client.close();
            }
            this.state.client = null;
            this.state.transport = null;
            this.state.tools?.catalogue.clear();
            this.state.tools = null;
            this.state.status = types_1.ServerStatus.CLOSED;
            helpers_1.logger.info({ header: "Agent shutdown complete" });
        }
        catch (error) {
            helpers_1.logger.error({
                header: "Error during shutdown",
                body: error instanceof Error ? error.message : String(error),
            });
        }
    }
}
exports.Session = Session;
exports.globalSession = new Session();
//# sourceMappingURL=session.js.map