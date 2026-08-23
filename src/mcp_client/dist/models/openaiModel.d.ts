import * as OpenAIResponseType from "openai/resources/responses/responses";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig, CallToolRequestParams, GenericMessage, MessageType } from "../types";
import { ModelInstance } from "./modelInstance";
export declare class OpenAIModel extends ModelInstance {
    private client;
    constructor(config: ModelConfig);
    generateResponse(input: OpenAIResponseType.ResponseInput, options?: Partial<Omit<OpenAIResponseType.ResponseCreateParams, "messages" | "model" | "tools">>): Promise<any>;
    generateResponseWithTool(input: OpenAIResponseType.ResponseInput, tools: OpenAIResponseType.Tool[], options?: Partial<Omit<OpenAIResponseType.ResponseCreateParams, "input" | "model" | "tools">>): Promise<OpenAIResponseType.Responses.Response>;
    formatRequest(messages: GenericMessage[]): OpenAIResponseType.EasyInputMessage[];
    formatCallToolRequest(messages: OpenAIResponseType.Responses.Response): CallToolRequestParams[];
    formatToolResponse(result: CallToolResult): OpenAIResponseType.ResponseInputItem;
    formatToolList(tools: Awaited<ReturnType<Client["listTools"]>>["tools"]): OpenAIResponseType.Tool[];
    formatResponseToIntermediateRequestMessage(response: OpenAIResponseType.Responses.Response): GenericMessage;
    createMessageContext(): OpenAIResponseType.ResponseInput;
    addToApiMessageContext(response: OpenAIResponseType.Responses.Response, context: OpenAIResponseType.ResponseOutputItem[]): void;
    addToFormattedMessageContext(response: OpenAIResponseType.Responses.Response, type: MessageType, context: GenericMessage[]): void;
    getCostFromResponse(response: OpenAIResponseType.Responses.Response): number;
    formatImageData(imageData: string, mimeType?: string): string;
}
//# sourceMappingURL=openaiModel.d.ts.map