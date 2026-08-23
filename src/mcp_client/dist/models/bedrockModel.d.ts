import * as BedrockMessages from "@anthropic-ai/sdk/resources/messages";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig, CallToolRequestParams, GenericMessage, MessageType } from "../types";
import { ModelInstance } from "./modelInstance";
export declare class BedrockModel extends ModelInstance {
    private client;
    constructor(config: ModelConfig);
    generateResponse(messages: BedrockMessages.MessageParam[], options?: Partial<BedrockMessages.MessageCreateParams>): Promise<BedrockMessages.Messages.Message>;
    generateResponseWithTool(messages: BedrockMessages.MessageParam[], tools: BedrockMessages.Tool[], options?: Partial<BedrockMessages.MessageCreateParams>): Promise<BedrockMessages.Messages.Message>;
    formatRequest(messages: GenericMessage[]): BedrockMessages.MessageParam[];
    formatCallToolRequest(message: BedrockMessages.Messages.Message): CallToolRequestParams[];
    formatToolResponse(result: CallToolResult): BedrockMessages.MessageParam;
    formatToolList(tools: Awaited<ReturnType<Client["listTools"]>>["tools"]): BedrockMessages.Tool[];
    formatResponseToIntermediateRequestMessage(response: BedrockMessages.Messages.Message): GenericMessage;
    createMessageContext(): BedrockMessages.MessageParam[];
    addToApiMessageContext(response: BedrockMessages.Messages.Message, context: BedrockMessages.MessageParam[]): void;
    addToFormattedMessageContext(response: BedrockMessages.Messages.Message, type: MessageType, context: GenericMessage[]): void;
    getCostFromResponse(response: BedrockMessages.Messages.Message): number;
    formatImageData(imageData: string, mimeType?: string): string;
}
//# sourceMappingURL=bedrockModel.d.ts.map