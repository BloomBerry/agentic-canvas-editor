"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Must be the very first import — populates process.env from .env / config.env
// before any other module's top-level code runs. See env_loader.ts.
require("./env_loader");
const express_1 = __importDefault(require("express"));
const routes_1 = require("./routes");
const session_1 = require("./core/session");
const types_1 = require("./types");
const helpers_1 = require("./utils/helpers");
const portArg = process.argv.find((arg) => arg.startsWith("--port="));
const PORT = portArg ? parseInt(portArg.split("=")[1], 10) : 3001;
const initializeServer = async () => {
    try {
        await session_1.globalSession.initialize();
        session_1.globalSession.state.status = types_1.ServerStatus.READY;
        helpers_1.logger.info({ header: "MCP Client initialization complete" });
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Failed to initialize MCP client",
            body: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
};
const shutdownServer = async () => {
    if (session_1.globalSession.state.status === types_1.ServerStatus.CLOSING) {
        helpers_1.logger.info({ header: "Server is already shutting down..." });
        return;
    }
    session_1.globalSession.state.status = types_1.ServerStatus.CLOSING;
    helpers_1.logger.info({ header: "Shutting down gracefully..." });
    try {
        await session_1.globalSession.shutdown();
        helpers_1.logger.info({ header: "MCP Client shutdown complete" });
        session_1.globalSession.state.status = types_1.ServerStatus.CLOSED;
        process.exit(0);
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error during shutdown",
            body: error instanceof Error ? error.message : String(error),
        });
        session_1.globalSession.state.status = types_1.ServerStatus.ERROR;
        process.exit(1);
    }
};
process.on("SIGINT", shutdownServer);
process.on("SIGTERM", shutdownServer);
// (1) Initialize the Express application
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: "200mb" }));
app.use(express_1.default.urlencoded({ limit: "200mb", extended: true }));
// (2) Routing setup
app.use("/", (0, routes_1.createRoutes)());
// (3) Server initialization
const httpServer = app.listen(PORT, () => {
    try {
        initializeServer();
    }
    catch (error) {
        helpers_1.logger.error({
            header: "Error during server initialization",
            body: error instanceof Error ? error.message : String(error),
        });
        process.exit(1);
    }
    helpers_1.logger.info({
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
httpServer.requestTimeout = 0;
//# sourceMappingURL=app.js.map