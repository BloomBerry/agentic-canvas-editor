"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BedrockModel = void 0;
const bedrock_sdk_1 = __importDefault(require("@anthropic-ai/bedrock-sdk"));
const types_1 = require("../types");
const modelInstance_1 = require("./modelInstance");
class BedrockModel extends modelInstance_1.ModelInstance {
    constructor(config) {
        super(config);
        // AWS credentials are read from environment variables.
        this.client = new bedrock_sdk_1.default({
            awsAccessKey: process.env.BEDROCK_ACCESS_KEY,
            awsSecretKey: process.env.BEDROCK_SECRET_KEY,
            awsRegion: "us-west-2",
        });
    }
    async generateResponse(messages, options = {}) {
        return await this.client.messages.create({
            model: this.modelName,
            messages,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            ...options,
            stream: false,
        });
    }
    async generateResponseWithTool(messages, tools, options = {}) {
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
    formatRequest(messages) {
        if (!messages?.length)
            throw new Error("No messages provided");
        return messages.map((msg) => {
            // Bedrock Claude doesn't accept "system" role; map to "user".
            const role = msg.role === "system" ? "user" : msg.role;
            const content = msg.content.map((item) => {
                switch (item.type) {
                    case types_1.ContentType.TEXT:
                        return { type: "text", text: item.text };
                    case types_1.ContentType.IMAGE: {
                        const imageData = item;
                        if (!["image/jpeg", "image/png", "image/gif", "image/webp"].includes(imageData.mimeType)) {
                            throw new Error(`Unsupported image type: ${imageData.mimeType}`);
                        }
                        return {
                            type: "image",
                            source: {
                                type: "base64",
                                media_type: imageData.mimeType,
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
    formatCallToolRequest(message) {
        const messageContent = message.content;
        if (!Array.isArray(messageContent))
            return [];
        return messageContent
            .filter((c) => c.type === "tool_use")
            .map((c) => ({
            id: c.id,
            call_id: "",
            name: c.name,
            arguments: c.input ?? {},
        }));
    }
    formatToolResponse(result) {
        const textJSON = JSON.stringify({
            content: result.content,
            structuredContent: result.structuredContent ?? {},
        });
        return {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: result.id,
                    content: textJSON,
                },
            ],
        };
    }
    formatToolList(tools) {
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
    formatResponseToIntermediateRequestMessage(response) {
        if (!response || !response.content) {
            throw new Error("Invalid response format");
        }
        const textContent = response.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        return {
            id: response.id,
            timestamp: Date.now(),
            type: types_1.MessageType.INTERMEDIATE_REQUEST,
            role: types_1.RoleType.USER,
            content: [{ type: types_1.ContentType.TEXT, text: textContent }],
        };
    }
    createMessageContext() {
        return [];
    }
    addToApiMessageContext(response, context) {
        context.push({
            role: response.role,
            content: response.content,
        });
    }
    addToFormattedMessageContext(response, type, context) {
        const textContent = response.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("\n");
        context.push({
            id: response.id,
            timestamp: Date.now(),
            type,
            role: types_1.RoleType.ASSISTANT,
            content: [{ type: types_1.ContentType.TEXT, text: textContent }],
            calls: this.formatCallToolRequest(response),
        });
    }
    getCostFromResponse(response) {
        return (response.usage.input_tokens * this.inputCost +
            response.usage.output_tokens * this.outputCost);
    }
    formatImageData(imageData, mimeType = "image/png") {
        return imageData.replace(/^data:image\/[^;]+;base64,/, "");
    }
}
exports.BedrockModel = BedrockModel;
//# sourceMappingURL=bedrockModel.js.map