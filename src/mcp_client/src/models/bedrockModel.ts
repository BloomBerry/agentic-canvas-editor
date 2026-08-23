import Bedrock from "@anthropic-ai/bedrock-sdk";
import * as BedrockMessages from "@anthropic-ai/sdk/resources/messages";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  ModelConfig,
  CallToolRequestParams,
  GenericMessage,
  ContentType,
  AgentRequestMessage,
  RoleType,
  MessageType,
} from "../types";
import { ModelInstance } from "./modelInstance";

export class BedrockModel extends ModelInstance {
  private client: Bedrock;

  constructor(config: ModelConfig) {
    super(config);
    // AWS credentials are read from environment variables.
    this.client = new Bedrock({
      awsAccessKey: process.env.BEDROCK_ACCESS_KEY,
      awsSecretKey: process.env.BEDROCK_SECRET_KEY,
      awsRegion: "us-west-2",
    });
  }

  async generateResponse(
    messages: BedrockMessages.MessageParam[],
    options: Partial<BedrockMessages.MessageCreateParams> = {}
  ): Promise<BedrockMessages.Messages.Message> {
    return await this.client.messages.create({
      model: this.modelName,
      messages,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      ...options,
      stream: false,
    });
  }

  async generateResponseWithTool(
    messages: BedrockMessages.MessageParam[],
    tools: BedrockMessages.Tool[],
    options: Partial<BedrockMessages.MessageCreateParams> = {}
  ): Promise<BedrockMessages.Messages.Message> {
    return await this.client.messages.create({
      model: this.modelName,
      messages,
      tools,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      ...options,
      stream: false,
    });
  }

  formatRequest(messages: GenericMessage[]): BedrockMessages.MessageParam[] {
    if (!messages?.length) throw new Error("No messages provided");

    return messages.map((msg) => {
      // Bedrock Claude doesn't accept "system" role; map to "user".
      const role =
        msg.role === "system" ? "user" : (msg.role as "user" | "assistant");
      const content = msg.content.map((item) => {
        switch (item.type) {
          case ContentType.TEXT:
            return { type: "text" as const, text: item.text };
          case ContentType.IMAGE: {
            const imageData = item as any;
            if (
              !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(
                imageData.mimeType
              )
            ) {
              throw new Error(`Unsupported image type: ${imageData.mimeType}`);
            }
            return {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: imageData.mimeType as
                  | "image/jpeg"
                  | "image/png"
                  | "image/gif"
                  | "image/webp",
                data: this.formatImageData(imageData.data),
              },
            };
          }
          default:
            throw new Error(`Unsupported content type: ${item.type}`);
        }
      });

      return { role, content };
    });
  }

  formatCallToolRequest(
    message: BedrockMessages.Messages.Message
  ): CallToolRequestParams[] {
    const messageContent = message.content;
    if (!Array.isArray(messageContent)) return [];

    return messageContent
      .filter((c: any) => c.type === "tool_use")
      .map((c: any) => ({
        id: c.id,
        call_id: "",
        name: c.name,
        arguments: c.input ?? {},
      }));
  }

  formatToolResponse(
    result: CallToolResult
  ): BedrockMessages.MessageParam {
    const textJSON = JSON.stringify({
      content: result.content,
      structuredContent: result.structuredContent ?? {},
    });

    return {
      role: "user",
      content: [
        {
          type: "tool_result" as const,
          tool_use_id: result.id,
          content: textJSON,
        } as BedrockMessages.ToolResultBlockParam,
      ],
    };
  }

  formatToolList(
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"]
  ): BedrockMessages.Tool[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema: tool.inputSchema ?? {
        type: "object",
        properties: {},
        required: [],
      },
    }));
  }

  formatResponseToIntermediateRequestMessage(
    response: BedrockMessages.Messages.Message
  ): GenericMessage {
    if (!response || !response.content) {
      throw new Error("Invalid response format");
    }
    const textContent = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    return {
      id: response.id,
      timestamp: Date.now(),
      type: MessageType.INTERMEDIATE_REQUEST,
      role: RoleType.USER,
      content: [{ type: ContentType.TEXT, text: textContent }],
    } as GenericMessage;
  }

  createMessageContext(): BedrockMessages.MessageParam[] {
    return [];
  }

  addToApiMessageContext(
    response: BedrockMessages.Messages.Message,
    context: BedrockMessages.MessageParam[]
  ): void {
    context.push({
      role: response.role,
      content: response.content,
    });
  }

  addToFormattedMessageContext(
    response: BedrockMessages.Messages.Message,
    type: MessageType,
    context: GenericMessage[]
  ): void {
    const textContent = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    context.push({
      id: response.id,
      timestamp: Date.now(),
      type,
      role: RoleType.ASSISTANT,
      content: [{ type: ContentType.TEXT, text: textContent }],
      calls: this.formatCallToolRequest(response),
    } as AgentRequestMessage);
  }

  getCostFromResponse(response: BedrockMessages.Messages.Message): number {
    return (
      response.usage.input_tokens * this.inputCost +
      response.usage.output_tokens * this.outputCost
    );
  }

  formatImageData(imageData: string, mimeType: string = "image/png"): string {
    return imageData.replace(/^data:image\/[^;]+;base64,/, "");
  }
}
