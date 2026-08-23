"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Tools = void 0;
const types_1 = require("../types");
// Tools whose Figma-side execution can run far longer than the default 5 min
// (e.g. importing 100+ slide JSON_REST_V1 documents). The MCP server applies
// SERVER_CONFIG.importTimeout (30 min) on its end; the client must not time
// out earlier.
const LONG_RUNNING_TOOL_TIMEOUTS_MS = {
    import_json: 1800000,
};
class Tools {
    constructor(client) {
        this.client = client;
        this.catalogue = new Map();
    }
    async loadTools() {
        if (!this.client) {
            throw new Error("Client or model not initialized");
        }
        const toolsResult = await this.client.listTools();
        if (!toolsResult.tools?.length) {
            throw new Error("No valid tools found in MCP server");
        }
        for (const tool of toolsResult.tools) {
            this.catalogue.set(tool.name, tool);
        }
    }
    async callTool(toolCall, timeoutMs) {
        try {
            if (!this.catalogue.has(toolCall.name)) {
                return this.createErrorResult(toolCall, `Tool '${toolCall.name}' not found`);
            }
            const effectiveTimeout = timeoutMs ??
                LONG_RUNNING_TOOL_TIMEOUTS_MS[toolCall.name] ??
                300000;
            const result = (await this.client.callTool({
                name: toolCall.name,
                arguments: toolCall.arguments,
            }, undefined, { timeout: effectiveTimeout }));
            return {
                id: toolCall.id,
                call_id: toolCall.call_id,
                name: toolCall.name,
                content: result.content,
                isError: result.isError || false,
                ...(result.structuredContent && {
                    structuredContent: result.structuredContent,
                }),
            };
        }
        catch (error) {
            return this.createErrorResult(toolCall, String(error));
        }
    }
    createToolCall(toolName, id, args, callId) {
        return {
            id,
            call_id: callId ?? "",
            name: toolName,
            arguments: args ?? {},
        };
    }
    createErrorResult(toolCall, message) {
        return {
            id: toolCall.id,
            call_id: toolCall.call_id,
            content: [
                {
                    type: types_1.ToolResponseFormat.TEXT,
                    text: message,
                },
            ],
            isError: true,
        };
    }
}
exports.Tools = Tools;
//# sourceMappingURL=tools.js.map