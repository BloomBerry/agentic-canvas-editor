import { FunctionCallingConfigMode, FunctionDeclaration, ContentListUnion, GenerateContentResponse } from "@google/genai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig, CallToolRequestParams, GenericMessage, MessageType } from "../types";
import { ModelInstance } from "./modelInstance";
export declare class GoogleModel extends ModelInstance {
    private client;
    private thinkingLevel?;
    constructor(config: ModelConfig);
    generateResponse(input: ContentListUnion, options?: Partial<{
        systemInstruction: any;
    }>): Promise<GenerateContentResponse>;
    generateResponseWithTool(input: ContentListUnion, tools: FunctionDeclaration[], options?: Partial<{
        functionCallingMode: FunctionCallingConfigMode;
        allowedFunctionNames: string[];
        systemInstruction: any;
    }>): Promise<GenerateContentResponse>;
    formatRequest(messages: GenericMessage[]): ContentListUnion[];
    formatCallToolRequest(response: GenerateContentResponse): CallToolRequestParams[];
    formatToolResponse(result: CallToolResult): ContentListUnion;
    /**
     * Gemini requires ALL function responses in a single message whose part
     * count matches the number of function calls in the model's turn.
     */
    formatToolResponses(results: CallToolResult[]): ContentListUnion[];
    formatToolList(tools: Awaited<ReturnType<Client["listTools"]>>["tools"]): FunctionDeclaration[];
    formatResponseToIntermediateRequestMessage(response: GenerateContentResponse): GenericMessage;
    createMessageContext(): ContentListUnion[];
    addToApiMessageContext(response: GenerateContentResponse, context: ContentListUnion[]): void;
    addToFormattedMessageContext(response: GenerateContentResponse, type: MessageType, context: GenericMessage[]): void;
    getCostFromResponse(response: GenerateContentResponse): number;
    formatImageData(imageData: string, mimeType: string): string;
    private stripDataUrl;
}
//# sourceMappingURL=googleModel.d.ts.map