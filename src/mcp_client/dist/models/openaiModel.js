"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAIModel = void 0;
const openai_1 = require("openai");
const types_1 = require("../types");
const modelInstance_1 = require("./modelInstance");
class OpenAIModel extends modelInstance_1.ModelInstance {
    constructor(config) {
        super(config);
        this.client = new openai_1.OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
        });
    }
    async generateResponse(input, options = {}) {
        // Reasoning models (o-series and gpt-5+) ignore temperature.
        const reasoning = this.modelName.includes("o3") ||
            this.modelName.includes("o1") ||
            this.modelName.includes("gpt-5");
        const params = {
            model: this.modelName,
            input: input,
            max_output_tokens: this.maxTokens,
            ...options,
            stream: false,
        };
        if (reasoning) {
            params.reasoning = { effort: "medium" };
        }
        else {
            params.temperature = this.temperature;
        }
        return await this.client.responses.create(params);
    }
    async generateResponseWithTool(input, tools, options) {
        // Reasoning models (o-series and gpt-5+) ignore temperature.
        const reasoning = this.modelName.includes("o3") ||
            this.modelName.includes("o1") ||
            this.modelName.includes("gpt-5");
        const params = {
            model: this.modelName,
            input: input,
            tools: tools,
            max_output_tokens: this.maxTokens,
            ...options,
            stream: false,
        };
        if (reasoning) {
            params.reasoning = { effort: "medium" };
        }
        else {
            params.temperature = this.temperature;
        }
        return await this.client.responses.create(params);
    }
    formatRequest(messages) {
        if (!messages?.length) {
            throw new Error("No messages provided for formatting");
        }
        return messages.map((message) => {
            if (message.role !== "user" && message.role !== "system") {
                throw new Error(`Unsupported message role: ${message.role}`);
            }
            const content = message.content.map((item) => {
                if (item.type === types_1.ContentType.TEXT) {
                    return {
                        type: "input_text",
                        text: item.text || "",
                    };
                }
                else if (item.type === types_1.ContentType.IMAGE) {
                    return {
                        type: "input_image",
                        image_url: this.formatImageData(item.data, item.mimeType),
                        detail: "auto",
                    };
                }
                throw new Error(`Unsupported message item type: ${item.type}`);
            });
            return { role: message.role, content: content };
        });
    }
    formatCallToolRequest(messages) {
        const requests = messages.output;
        if (!requests || !Array.isArray(requests))
            return [];
        return requests
            .filter((item) => item.type === "function_call")
            .map((item) => ({
            id: item.id,
            call_id: item.call_id,
            name: item.name,
            arguments: (() => {
                try {
                    return typeof item.arguments === "string"
                        ? JSON.parse(item.arguments)
                        : item.arguments || {};
                }
                catch {
                    return {};
                }
            })(),
        }));
    }
    formatToolResponse(result) {
        if (!result.call_id) {
            throw new Error("Missing call_id in tool response");
        }
        const MAX_OUTPUT_BYTES = 9 * 1024 * 1024; // 9MB safety margin (OpenAI limit: 10MB)
        let output = JSON.stringify({
            content: result.content,
            structuredContent: result.structuredContent || {},
        });
        if (output.length > MAX_OUTPUT_BYTES) {
            console.warn(`[OpenAIModel] Tool result too large (${(output.length / 1024 / 1024).toFixed(1)}MB), truncating`);
            // Strip large data fields (e.g., base64 imageData) and return summary
            output = JSON.stringify({
                content: [{ type: "text", text: `[Tool result truncated: ${(output.length / 1024 / 1024).toFixed(1)}MB exceeded 9MB limit. Re-call with smaller parameters.]` }],
                structuredContent: {},
            });
        }
        return {
            type: "function_call_output",
            call_id: result.call_id,
            output,
        };
    }
    formatToolList(tools) {
        return tools.map((tool) => ({
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
        }));
    }
    formatResponseToIntermediateRequestMessage(response) {
        return {
            id: response.id,
            timestamp: response.created_at,
            type: types_1.MessageType.INTERMEDIATE_REQUEST,
            role: types_1.RoleType.USER,
            content: [
                { type: types_1.ContentType.TEXT, text: response.output_text },
            ],
        };
    }
    createMessageContext() {
        return [];
    }
    addToApiMessageContext(response, context) {
        context.push(...response.output);
    }
    addToFormattedMessageContext(response, type, context) {
        const toolRequests = this.formatCallToolRequest(response);
        context.push({
            id: response.id,
            timestamp: response.created_at,
            type: type,
            role: types_1.RoleType.ASSISTANT,
            content: [
                { type: types_1.ContentType.TEXT, text: response.output_text },
            ],
            calls: toolRequests,
        });
    }
    getCostFromResponse(response) {
        if (!response.usage) {
            throw new Error("Response does not contain usage information");
        }
        return (response.usage.input_tokens * this.inputCost +
            response.usage.output_tokens * this.outputCost);
    }
    formatImageData(imageData, mimeType = "image/png") {
        if (/^data:image\/[^;]+;base64,/.test(imageData)) {
            return imageData;
        }
        return `data:${mimeType};base64,${imageData}`;
    }
}
exports.OpenAIModel = OpenAIModel;
//# sourceMappingURL=openaiModel.js.map