import { OpenAI } from "openai";
import * as OpenAIResponseType from "openai/resources/responses/responses";
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
  IntermediateRequestMessage,
} from "../types";
import { ModelInstance } from "./modelInstance";

/**
 * Does this model reject `temperature`?
 *
 * o-series and gpt-5 and newer are reasoning models: sending `temperature`
 * returns `400 Unsupported parameter`. Keep this in one place — the check used
 * to be inlined in two methods and silently missed gpt-6 when it shipped.
 */
function isReasoningModel(name: string): boolean {
  const n = name.toLowerCase();
  if (n.includes("o1") || n.includes("o3") || n.includes("o4")) return true;
  const m = n.match(/gpt-(\d+)/);
  return m !== null && Number(m[1]) >= 5;
}

export class OpenAIModel extends ModelInstance {
  private client: OpenAI;

  constructor(config: ModelConfig) {
    super(config);
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  async generateResponse(
    input: OpenAIResponseType.ResponseInput,
    options: Partial<
      Omit<
        OpenAIResponseType.ResponseCreateParams,
        "messages" | "model" | "tools"
      >
    > = {}
  ): Promise<any> {
    // Reasoning models (o-series and gpt-5+) reject `temperature` outright (HTTP 400),
    // so the check must cover every new family — gpt-6 was missing here.
    const reasoning = isReasoningModel(this.modelName);
    const params: OpenAIResponseType.ResponseCreateParams = {
      model: this.modelName,
      input: input,
      max_output_tokens: this.maxTokens,
      ...options,
      stream: false,
    };

    if (reasoning) {
      (params as any).reasoning = { effort: "medium" };
    } else {
      params.temperature = this.temperature;
    }

    return await this.client.responses.create(params);
  }

  async generateResponseWithTool(
    input: OpenAIResponseType.ResponseInput,
    tools: OpenAIResponseType.Tool[],
    options?: Partial<
      Omit<OpenAIResponseType.ResponseCreateParams, "input" | "model" | "tools">
    >
  ): Promise<OpenAIResponseType.Responses.Response> {
    // Reasoning models (o-series and gpt-5+) reject `temperature` outright (HTTP 400),
    // so the check must cover every new family — gpt-6 was missing here.
    const reasoning = isReasoningModel(this.modelName);
    const params: OpenAIResponseType.ResponseCreateParams = {
      model: this.modelName,
      input: input,
      tools: tools,
      max_output_tokens: this.maxTokens,
      ...options,
      stream: false,
    };

    if (reasoning) {
      (params as any).reasoning = { effort: "medium" };
    } else {
      params.temperature = this.temperature;
    }

    return await this.client.responses.create(params);
  }

  formatRequest(
    messages: GenericMessage[]
  ): OpenAIResponseType.EasyInputMessage[] {
    if (!messages?.length) {
      throw new Error("No messages provided for formatting");
    }

    return messages.map((message) => {
      if (message.role !== "user" && message.role !== "system") {
        throw new Error(`Unsupported message role: ${message.role}`);
      }

      const content = message.content.map((item) => {
        if (item.type === ContentType.TEXT) {
          return {
            type: "input_text" as const,
            text: item.text || "",
          };
        } else if (item.type === ContentType.IMAGE) {
          return {
            type: "input_image" as const,
            image_url: this.formatImageData(item.data, item.mimeType),
            detail: "auto" as const,
          };
        }
        throw new Error(`Unsupported message item type: ${item.type}`);
      });

      return { role: message.role, content: content };
    });
  }

  formatCallToolRequest(
    messages: OpenAIResponseType.Responses.Response
  ): CallToolRequestParams[] {
    const requests = messages.output;
    if (!requests || !Array.isArray(requests)) return [];

    return requests
      .filter((item: any) => item.type === "function_call")
      .map((item: any) => ({
        id: item.id,
        call_id: item.call_id,
        name: item.name,
        arguments: (() => {
          try {
            return typeof item.arguments === "string"
              ? JSON.parse(item.arguments)
              : item.arguments || {};
          } catch {
            return {};
          }
        })(),
      }));
  }

  formatToolResponse(
    result: CallToolResult
  ): OpenAIResponseType.ResponseInputItem {
    if (!result.call_id) {
      throw new Error("Missing call_id in tool response");
    }

    const MAX_OUTPUT_BYTES = 9 * 1024 * 1024; // 9MB safety margin (OpenAI limit: 10MB)
    let output = JSON.stringify({
      content: result.content,
      structuredContent: result.structuredContent || {},
    });

    if (output.length > MAX_OUTPUT_BYTES) {
      console.warn(
        `[OpenAIModel] Tool result too large (${(output.length / 1024 / 1024).toFixed(1)}MB), truncating`
      );
      // Strip large data fields (e.g., base64 imageData) and return summary
      output = JSON.stringify({
        content: [{ type: "text", text: `[Tool result truncated: ${(output.length / 1024 / 1024).toFixed(1)}MB exceeded 9MB limit. Re-call with smaller parameters.]` }],
        structuredContent: {},
      });
    }

    return {
      type: "function_call_output",
      call_id: result.call_id as string,
      output,
    };
  }

  formatToolList(
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"]
  ): OpenAIResponseType.Tool[] {
    return tools.map(
      (tool) =>
        ({
          type: "function",
          name: tool.name,
          description: tool.description ?? "",
          parameters: tool.inputSchema
            ? {
                ...tool.inputSchema,
                additionalProperties: false,
                required: tool.inputSchema.required || [],
              }
            : {
                type: "object",
                properties: {},
                required: [],
              },
          strict: false,
        }) as OpenAIResponseType.Tool
    );
  }

  formatResponseToIntermediateRequestMessage(
    response: OpenAIResponseType.Responses.Response
  ): GenericMessage {
    return {
      id: response.id,
      timestamp: response.created_at,
      type: MessageType.INTERMEDIATE_REQUEST,
      role: RoleType.USER,
      content: [
        { type: ContentType.TEXT, text: (response as any).output_text },
      ],
    } as IntermediateRequestMessage;
  }

  createMessageContext(): OpenAIResponseType.ResponseInput {
    return [];
  }

  addToApiMessageContext(
    response: OpenAIResponseType.Responses.Response,
    context: OpenAIResponseType.ResponseOutputItem[]
  ): void {
    context.push(...response.output);
  }

  addToFormattedMessageContext(
    response: OpenAIResponseType.Responses.Response,
    type: MessageType,
    context: GenericMessage[]
  ): void {
    const toolRequests = this.formatCallToolRequest(response);

    context.push({
      id: response.id,
      timestamp: response.created_at,
      type: type,
      role: RoleType.ASSISTANT,
      content: [
        { type: ContentType.TEXT, text: (response as any).output_text },
      ],
      calls: toolRequests,
    } as AgentRequestMessage);
  }

  getCostFromResponse(response: OpenAIResponseType.Responses.Response): number {
    if (!response.usage) {
      throw new Error("Response does not contain usage information");
    }
    return (
      response.usage.input_tokens * this.inputCost +
      response.usage.output_tokens * this.outputCost
    );
  }

  formatImageData(imageData: string, mimeType: string = "image/png"): string {
    if (/^data:image\/[^;]+;base64,/.test(imageData)) {
      return imageData;
    }
    return `data:${mimeType};base64,${imageData}`;
  }
}
