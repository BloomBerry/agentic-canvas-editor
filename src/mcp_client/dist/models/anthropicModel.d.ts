import * as AnthropicMessages from "@anthropic-ai/sdk/resources/messages";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ModelConfig, CallToolRequestParams, GenericMessage, MessageType } from "../types";
import { ModelInstance } from "./modelInstance";
/** Claude via Anthropic API (ANTHROPIC_API_KEY). */
export declare class AnthropicModel extends ModelInstance {
    private client;
    constructor(config: ModelConfig);
    generateResponse(messages: AnthropicMessages.MessageParam[], options?: Partial<AnthropicMessages.MessageCreateParams>): Promise<AnthropicMessages.Messages.Message>;
    generateResponseWithTool(messages: AnthropicMessages.MessageParam[], tools: AnthropicMessages.Tool[], options?: Partial<AnthropicMessages.MessageCreateParams>): Promise<AnthropicMessages.Messages.Message>;
    formatRequest(messages: GenericMessage[]): AnthropicMessages.MessageParam[];
    formatCallToolRequest(message: AnthropicMessages.Messages.Message): CallToolRequestParams[];
    formatToolResponse(result: CallToolResult): AnthropicMessages.MessageParam;
    formatToolList(tools: Awaited<ReturnType<Client["listTools"]>>["tools"]): AnthropicMessages.Tool[];
    formatResponseToIntermediateRequestMessage(response: AnthropicMessages.Messages.Message): GenericMessage;
    createMessageContext(): AnthropicMessages.MessageParam[];
    addToApiMessageContext(response: AnthropicMessages.Messages.Message, context: AnthropicMessages.MessageParam[]): void;
    addToFormattedMessageContext(response: AnthropicMessages.Messages.Message, type: MessageType, context: GenericMessage[]): void;
    getCostFromResponse(response: AnthropicMessages.Messages.Message): number;
    formatImageData(imageData: string, mimeType?: string): string;
}
//# sourceMappingURL=anthropicModel.d.ts.map