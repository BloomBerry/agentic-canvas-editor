import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  ContentListUnion,
  GenerateContentResponse,
  Schema,
  ThinkingLevel,
} from "@google/genai";
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
import { randomUUID } from "crypto";
import { logger } from "../utils/helpers";
import path from "path";

export class GoogleModel extends ModelInstance {
  private client: GoogleGenAI;
  private thinkingLevel?: ThinkingLevel;

  constructor(config: ModelConfig) {
    super(config);
    this.thinkingLevel = config.thinkingLevel as ThinkingLevel | undefined;

    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (credPath) {
      // Resolve relative path from project root (4 levels up from src/mcp_client/src/models)
      const absCredPath = path.isAbsolute(credPath)
        ? credPath
        : path.resolve(__dirname, "../../../..", credPath);

      // Vertex AI mode: authenticate via service account JSON key file
      this.client = new GoogleGenAI({
        vertexai: true,
        project: process.env.GOOGLE_CLOUD_PROJECT ?? "your-gcp-project-id",
        location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
        googleAuthOptions: {
          keyFile: absCredPath,
        },
      });
    } else {
      // API key mode (legacy)
      this.client = new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY,
      });
    }
  }

  async generateResponse(
    input: ContentListUnion,
    options: Partial<{
      systemInstruction: any;
    }> = {}
  ): Promise<GenerateContentResponse> {
    return await this.client.models.generateContent({
      model: this.modelName,
      contents: input,
      config: {
        temperature: this.temperature,
        maxOutputTokens: Math.max(this.maxTokens, 32768),
        ...(this.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } }
          : {}),
        ...(options.systemInstruction
          ? { systemInstruction: options.systemInstruction }
          : {}),
      },
    });
  }

  async generateResponseWithTool(
    input: ContentListUnion,
    tools: FunctionDeclaration[],
    options: Partial<{
      functionCallingMode: FunctionCallingConfigMode;
      allowedFunctionNames: string[];
      systemInstruction: any;
    }> = {}
  ): Promise<GenerateContentResponse> {
    const mode = options.functionCallingMode ?? FunctionCallingConfigMode.AUTO;

    return await this.client.models.generateContent({
      model: this.modelName,
      contents: input,
      config: {
        temperature: this.temperature,
        maxOutputTokens: Math.max(this.maxTokens, 32768),
        ...(this.thinkingLevel
          ? { thinkingConfig: { thinkingLevel: this.thinkingLevel } }
          : {}),
        tools: [
          {
            functionDeclarations: tools,
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode,
            ...(options.allowedFunctionNames
              ? { allowedFunctionNames: options.allowedFunctionNames }
              : {}),
          },
        },
        ...(options.systemInstruction
          ? { systemInstruction: options.systemInstruction }
          : {}),
      },
    });
  }

  formatRequest(messages: GenericMessage[]): ContentListUnion[] {
    if (!messages?.length) {
      throw new Error("No messages provided");
    }

    return messages.map((msg) => {
      const role = msg.role === RoleType.ASSISTANT ? "model" : "user";

      const parts = msg.content.map((item) => {
        switch (item.type) {
          case ContentType.TEXT:
            return { text: item.text };
          case ContentType.IMAGE:
            return {
              inlineData: {
                mimeType: item.mimeType ?? "image/png",
                data: this.formatImageData(item.data, item.mimeType),
              },
            };
          case ContentType.AUDIO:
            return {
              inlineData: {
                mimeType: item.mimeType ?? "audio/wav",
                data: this.stripDataUrl(item.data),
              },
            };
          default:
            throw new Error(`Unsupported content type: ${item.type}`);
        }
      });

      return { role, parts };
    });
  }

  formatCallToolRequest(
    response: GenerateContentResponse
  ): CallToolRequestParams[] {
    if (!response.functionCalls?.length) return [];
    return response.functionCalls.map((call) => {
      const uuid = randomUUID();
      // Gemini may omit IDs; generate a stable call_id for tool routing.
      return {
        id: call.id ?? `${call.name ?? "tool_call"}` + `-${uuid}`,
        call_id: uuid,
        name: call.name ?? uuid,
        arguments: call.args ?? {},
      };
    });
  }

  formatToolResponse(result: CallToolResult): ContentListUnion {
    if (!result.name || typeof result.name !== "string") {
      logger.error({
        header: "Error Detected: Missing tool name in response",
        body: `Result: ${JSON.stringify(result, (_k, v) => typeof v === "string" && v.length > 200 ? v.slice(0, 200) + `...[${v.length} chars]` : v, 2)}`,
      });
    }

    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name:
              typeof result.name === "string" ? result.name : "unknown_tool",
            response: {
              output: {
                content: result.content,
                structuredContent: result.structuredContent ?? {},
              },
            },
          },
        },
      ],
    };
  }

  /**
   * Gemini requires ALL function responses in a single message whose part
   * count matches the number of function calls in the model's turn.
   */
  formatToolResponses(results: CallToolResult[]): ContentListUnion[] {
    if (results.length === 0) return [];

    return [
      {
        role: "user" as const,
        parts: results.map((result) => ({
          functionResponse: {
            name:
              typeof result.name === "string" ? result.name : "unknown_tool",
            response: {
              output: {
                content: result.content,
                structuredContent: result.structuredContent ?? {},
              },
            },
          },
        })),
      },
    ];
  }

  formatToolList(
    tools: Awaited<ReturnType<Client["listTools"]>>["tools"]
  ): FunctionDeclaration[] {
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema as Record<string, Schema>,
    }));
  }

  formatResponseToIntermediateRequestMessage(
    response: GenerateContentResponse
  ): GenericMessage {
    const text = response.text ?? "";
    return {
      id: response.responseId ?? "",
      timestamp: Date.now(),
      type: MessageType.INTERMEDIATE_REQUEST,
      role: RoleType.USER,
      content: [{ type: ContentType.TEXT, text }],
    } as IntermediateRequestMessage;
  }

  createMessageContext(): ContentListUnion[] {
    return [];
  }

  addToApiMessageContext(
    response: GenerateContentResponse,
    context: ContentListUnion[]
  ): void {
    if (response.candidates![0].finishReason === "MALFORMED_FUNCTION_CALL") {
      logger.error({
        header: "Malformed function call detected in Gemini response",
      });
    }

    if (response.candidates?.[0]?.content) {
      context.push({
        role: "model",
        parts: response.candidates[0].content.parts,
      });
    }
  }

  addToFormattedMessageContext(
    response: GenerateContentResponse,
    type: MessageType,
    context: GenericMessage[]
  ): void {
    const calls = this.formatCallToolRequest(response);

    context.push({
      id: response.responseId ?? "",
      timestamp: Date.now(),
      type: type,
      role: RoleType.ASSISTANT,
      content: [{ type: ContentType.TEXT, text: response.text ?? "" }],
      calls,
    } as AgentRequestMessage);
  }

  getCostFromResponse(response: GenerateContentResponse): number {
    if (!response.usageMetadata) {
      throw new Error("Response does not contain usage metadata");
    }

    const usage = response.usageMetadata;
    const inTokens = usage.promptTokenCount ?? 0;
    const outTokens = usage.candidatesTokenCount ?? 0;
    const thoughtsTokens = usage.thoughtsTokenCount ?? 0;

    return (
      inTokens * this.inputCost +
      outTokens * this.outputCost +
      thoughtsTokens * this.outputCost
    );
  }

  formatImageData(imageData: string, mimeType: string): string {
    imageData = imageData.replace(/^data:image\/[^;]+;base64,/, "");
    return imageData;
  }

  private stripDataUrl(data: string): string {
    return data.replace(/^data:[^;]+;base64,/, "");
  }
}
