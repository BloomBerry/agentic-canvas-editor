import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
export declare function rgbaToHex(color: any): string;
export declare function createSuccessResponse(params: {
    messages: string[];
    images?: {
        data: string;
        mimeType: string;
    }[];
    dataItem?: {
        [x: string]: unknown;
    };
}): CallToolResult;
export declare function createErrorResponse(params: {
    error: unknown;
    context: string;
    dataItem?: {
        [x: string]: unknown;
    };
}): CallToolResult;
