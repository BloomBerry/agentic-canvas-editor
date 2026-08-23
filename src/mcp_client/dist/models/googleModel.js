"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GoogleModel = void 0;
const genai_1 = require("@google/genai");
const types_1 = require("../types");
const modelInstance_1 = require("./modelInstance");
const crypto_1 = require("crypto");
const helpers_1 = require("../utils/helpers");
const path_1 = __importDefault(require("path"));
class GoogleModel extends modelInstance_1.ModelInstance {
    constructor(config) {
        super(config);
        this.thinkingLevel = config.thinkingLevel;
        const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (credPath) {
            // Resolve relative path from project root (4 levels up from src/mcp_client/src/models)
            const absCredPath = path_1.default.isAbsolute(credPath)
                ? credPath
                : path_1.default.resolve(__dirname, "../../../..", credPath);
            // Vertex AI mode: authenticate via service account JSON key file
            this.client = new genai_1.GoogleGenAI({
                vertexai: true,
                project: process.env.GOOGLE_CLOUD_PROJECT ?? "your-gcp-project-id",
                location: process.env.GOOGLE_CLOUD_LOCATION ?? "global",
                googleAuthOptions: {
                    keyFile: absCredPath,
                },
            });
        }
        else {
            // API key mode (legacy)
            this.client = new genai_1.GoogleGenAI({
                apiKey: process.env.GEMINI_API_KEY,
            });
        }
    }
    async generateResponse(input, options = {}) {
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
    async generateResponseWithTool(input, tools, options = {}) {
        const mode = options.functionCallingMode ?? genai_1.FunctionCallingConfigMode.AUTO;
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
    formatRequest(messages) {
        if (!messages?.length) {
            throw new Error("No messages provided");
        }
        return messages.map((msg) => {
            const role = msg.role === types_1.RoleType.ASSISTANT ? "model" : "user";
            const parts = msg.content.map((item) => {
                switch (item.type) {
                    case types_1.ContentType.TEXT:
                        return { text: item.text };
                    case types_1.ContentType.IMAGE:
                        return {
                            inlineData: {
                                mimeType: item.mimeType ?? "image/png",
                                data: this.formatImageData(item.data, item.mimeType),
                            },
                        };
                    case types_1.ContentType.AUDIO:
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
    formatCallToolRequest(response) {
        if (!response.functionCalls?.length)
            return [];
        return response.functionCalls.map((call) => {
            const uuid = (0, crypto_1.randomUUID)();
            // Gemini may omit IDs; generate a stable call_id for tool routing.
            return {
                id: call.id ?? `${call.name ?? "tool_call"}` + `-${uuid}`,
                call_id: uuid,
                name: call.name ?? uuid,
                arguments: call.args ?? {},
            };
        });
    }
    formatToolResponse(result) {
        if (!result.name || typeof result.name !== "string") {
            helpers_1.logger.error({
                header: "Error Detected: Missing tool name in response",
                body: `Result: ${JSON.stringify(result, (_k, v) => typeof v === "string" && v.length > 200 ? v.slice(0, 200) + `...[${v.length} chars]` : v, 2)}`,
            });
        }
        return {
            role: "user",
            parts: [
                {
                    functionResponse: {
                        name: typeof result.name === "string" ? result.name : "unknown_tool",
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
    formatToolResponses(results) {
        if (results.length === 0)
            return [];
        return [
            {
                role: "user",
                parts: results.map((result) => ({
                    functionResponse: {
                        name: typeof result.name === "string" ? result.name : "unknown_tool",
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
    formatToolList(tools) {
        return tools.map((tool) => ({
            name: tool.name,
            description: tool.description ?? "",
            parameters: tool.inputSchema,
        }));
    }
    formatResponseToIntermediateRequestMessage(response) {
        const text = response.text ?? "";
        return {
            id: response.responseId ?? "",
            timestamp: Date.now(),
            type: types_1.MessageType.INTERMEDIATE_REQUEST,
            role: types_1.RoleType.USER,
            content: [{ type: types_1.ContentType.TEXT, text }],
        };
    }
    createMessageContext() {
        return [];
    }
    addToApiMessageContext(response, context) {
        if (response.candidates[0].finishReason === "MALFORMED_FUNCTION_CALL") {
            helpers_1.logger.error({
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
    addToFormattedMessageContext(response, type, context) {
        const calls = this.formatCallToolRequest(response);
        context.push({
            id: response.responseId ?? "",
            timestamp: Date.now(),
            type: type,
            role: types_1.RoleType.ASSISTANT,
            content: [{ type: types_1.ContentType.TEXT, text: response.text ?? "" }],
            calls,
        });
    }
    getCostFromResponse(response) {
        if (!response.usageMetadata) {
            throw new Error("Response does not contain usage metadata");
        }
        const usage = response.usageMetadata;
        const inTokens = usage.promptTokenCount ?? 0;
        const outTokens = usage.candidatesTokenCount ?? 0;
        const thoughtsTokens = usage.thoughtsTokenCount ?? 0;
        return (inTokens * this.inputCost +
            outTokens * this.outputCost +
            thoughtsTokens * this.outputCost);
    }
    formatImageData(imageData, mimeType) {
        imageData = imageData.replace(/^data:image\/[^;]+;base64,/, "");
        return imageData;
    }
    stripDataUrl(data) {
        return data.replace(/^data:[^;]+;base64,/, "");
    }
}
exports.GoogleModel = GoogleModel;
//# sourceMappingURL=googleModel.js.map