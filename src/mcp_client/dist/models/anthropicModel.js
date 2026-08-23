"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnthropicModel = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
const types_1 = require("../types");
const modelInstance_1 = require("./modelInstance");
/** Claude via Anthropic API (ANTHROPIC_API_KEY). */
class AnthropicModel extends modelInstance_1.ModelInstance {
    constructor(config) {
        super(config);
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            throw new Error("ANTHROPIC_API_KEY is required for Anthropic (direct API) models. Set it in .env");
        }
        this.client = new sdk_1.default({ apiKey });
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
        const { prompt_cache_key: _ignored, ...anthropicOptions } = (options || {});
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
    formatRequest(messages) {
        if (!messages?.length)
            throw new Error("No messages provided");
        return messages.map((msg) => {
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
exports.AnthropicModel = AnthropicModel;
/**
 * Apply ephemeral prompt-cache breakpoints to a (tools, messages) pair for the
 * Anthropic Messages API. We tag two slots so the large static prefix gets
 * cached:
 *   1) the last entry of the `tools` array  → caches the entire tool catalog
 *   2) the last content block of `messages[0]`  → caches the initial user
 *      prompt (CARE context, instructions, figma-slides basics).
 * Returns shallow clones; never mutates the caller's input.
 */
function applyPromptCacheBreakpoints(tools, messages) {
    let cachedTools = tools;
    if (tools.length > 0) {
        cachedTools = tools.slice();
        const last = cachedTools[cachedTools.length - 1];
        cachedTools[cachedTools.length - 1] = {
            ...last,
            cache_control: { type: "ephemeral" },
        };
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
                    ...lastBlock,
                    cache_control: { type: "ephemeral" },
                };
                cachedMessages = messages.slice();
                cachedMessages[0] = { ...first, content: newContent };
            }
        }
    }
    return { tools: cachedTools, messages: cachedMessages };
}
//# sourceMappingURL=anthropicModel.js.map