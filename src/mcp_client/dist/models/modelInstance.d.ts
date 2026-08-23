import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig, ModelProvider, CallToolRequestParams, GenericMessage, MessageType } from "../types";
export declare abstract class ModelInstance {
    modelName: string;
    modelProvider: ModelProvider;
    inputCost: number;
    outputCost: number;
    temperature: number;
    maxTokens: number;
    constructor(config: ModelConfig);
    abstract generateResponse(messages: any[], options?: any): Promise<any>;
    abstract generateResponseWithTool(messages: any[], tools: any[], options?: any): Promise<any>;
    abstract formatRequest(messages: GenericMessage[]): any[];
    abstract formatCallToolRequest(response: any): CallToolRequestParams[];
    abstract formatToolList(tools: Awaited<ReturnType<Client["listTools"]>>["tools"]): any[];
    abstract formatToolResponse(response: CallToolResult): any;
    /**
     * Format multiple tool responses. Override in subclasses that require
     * all function responses in a single message (e.g. Gemini).
     * Default implementation delegates to formatToolResponse per result.
     */
    formatToolResponses(results: CallToolResult[]): any[];
    abstract formatImageData(imageData: string, mimeType?: string): string;
    abstract formatResponseToIntermediateRequestMessage(response: any): GenericMessage;
    abstract createMessageContext(): any[];
    abstract addToApiMessageContext(response: any, context: any[]): void;
    abstract addToFormattedMessageContext(response: any, type: MessageType, context: any[]): void;
    abstract getCostFromResponse(response: any): number;
}
//# sourceMappingURL=modelInstance.d.ts.map