import Anthropic from "@anthropic-ai/sdk";
import * as AnthropicMessages from "@anthropic-ai/sdk/resources/messages";
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

/** Claude via Anthropic API (ANTHROPIC_API_KEY). */
export class AnthropicModel extends ModelInstance {
  private client: Anthropic;

  constructor(config: ModelConfig) {
    super(config);
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is required for Anthropic (direct API) models. Set it in .env"
      );
    }
    this.client = new Anthropic({ apiKey });
  }

  async generateResponse(
    messages: AnthropicMessages.MessageParam[],
    options: Partial<AnthropicMessages.MessageCreateParams> = {}
  ): Promise<AnthropicMessages.Messages.Message> {
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
    messages: AnthropicMessages.MessageParam[],
    tools: AnthropicMessages.Tool[],
    options: Partial<AnthropicMessages.MessageCreateParams> = {}
  ): Promise<AnthropicMessages.Messages.Message> {
    // Anthropic prompt caching: place two ephemeral cache breakpoints so the
    // large static prefix (tool catalog + initial user prompt) is amortized
    // across multi-turn conversations. Each breakpoint caches everything that
    // precedes it. Five-minute TTL is fine because turns happen back-to-back.
    // Set DISABLE_PROMPT_CACHE=1 to bypass — used for cache-off ablation runs.
    const disableCache = process.env.DISABLE_PROMPT_CACHE === "1";
    const { tools: cachedTools, messages: cachedMessages } = disableCache
      ? { tools, messages }
      : applyPromptCacheBreakpoints(tools, messages);

    // Strip OpenAI-specific options that callers may forward provider-agnostically.
    // Anthropic's API rejects unknown keys; filter so the cross-provider
    // generic option bag (e.g. prompt_cache_key for OpenAI prefix caching)
    // doesn't break Anthropic calls.
    const { prompt_cache_key: _ignored, ...anthropicOptions } = (options || {}) as any;

    return await this.client.messages.create({
      model: this.modelName,
      messages: cachedMessages,
      tools: cachedTools,
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      ...anthropicOptions,
      stream: false,
    });
  }

  formatRequest(messages: GenericMessage[]): AnthropicMessages.MessageParam[] {
    if (!messages?.length) throw new Error("No messages provided");

    return messages.map((msg) => {
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
    message: AnthropicMessages.Messages.Message
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
  ): AnthropicMessages.MessageParam {
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
        } as AnthropicMessages.ToolResultBlockParam,
      ],
    };
  }

  formatToolList(
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"]
  ): AnthropicMessages.Tool[] {
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
    response: AnthropicMessages.Messages.Message
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

  createMessageContext(): AnthropicMessages.MessageParam[] {
    return [];
  }

  addToApiMessageContext(
    response: AnthropicMessages.Messages.Message,
    context: AnthropicMessages.MessageParam[]
  ): void {
    context.push({
      role: response.role,
      content: response.content,
    });
  }

  addToFormattedMessageContext(
    response: AnthropicMessages.Messages.Message,
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

  getCostFromResponse(response: AnthropicMessages.Messages.Message): number {
    return (
      response.usage.input_tokens * this.inputCost +
      response.usage.output_tokens * this.outputCost
    );
  }

  formatImageData(imageData: string, mimeType: string = "image/png"): string {
    return imageData.replace(/^data:image\/[^;]+;base64,/, "");
  }
}

/**
 * Apply ephemeral prompt-cache breakpoints to a (tools, messages) pair for the
 * Anthropic Messages API. We tag two slots so the large static prefix gets
 * cached:
 *   1) the last entry of the `tools` array  → caches the entire tool catalog
 *   2) the last content block of `messages[0]`  → caches the initial user
 *      prompt (CARE context, instructions, figma-slides basics).
 * Returns shallow clones; never mutates the caller's input.
 */
function applyPromptCacheBreakpoints(
  tools: AnthropicMessages.Tool[],
  messages: AnthropicMessages.MessageParam[]
): {
  tools: AnthropicMessages.Tool[];
  messages: AnthropicMessages.MessageParam[];
} {
  let cachedTools = tools;
  if (tools.length > 0) {
    cachedTools = tools.slice();
    const last = cachedTools[cachedTools.length - 1];
    cachedTools[cachedTools.length - 1] = {
      ...last,
      cache_control: { type: "ephemeral" },
    } as AnthropicMessages.Tool;
  }

  let cachedMessages = messages;
  if (messages.length > 0) {
    const first = messages[0];
    if (Array.isArray(first.content) && first.content.length > 0) {
      const newContent = first.content.slice();
      const lastIdx = newContent.length - 1;
      const lastBlock = newContent[lastIdx];
      if (lastBlock && typeof lastBlock === "object") {
        newContent[lastIdx] = {
          ...(lastBlock as unknown as Record<string, unknown>),
          cache_control: { type: "ephemeral" },
        } as unknown as typeof lastBlock;
        cachedMessages = messages.slice();
        cachedMessages[0] = { ...first, content: newContent };
      }
    }
  }

  return { tools: cachedTools, messages: cachedMessages };
}
