import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestParams, ToolItem } from "../types";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
export declare class Tools {
    catalogue: Map<string, ToolItem>;
    client: Client;
    constructor(client: Client);
    loadTools(): Promise<void>;
    callTool(toolCall: CallToolRequestParams, timeoutMs?: number): Promise<CallToolResult>;
    createToolCall(toolName: string, id: string, args?: Record<string, unknown>, callId?: string): CallToolRequestParams;
    private createErrorResult;
}
//# sourceMappingURL=tools.d.ts.map