"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelInstance = void 0;
class ModelInstance {
    constructor(config) {
        this.modelName = config.modelName;
        this.modelProvider = config.modelProvider;
        this.inputCost = config.inputCost;
        this.outputCost = config.outputCost;
        this.temperature = config.temperature;
        this.maxTokens = config.maxTokens;
    }
    /**
     * Format multiple tool responses. Override in subclasses that require
     * all function responses in a single message (e.g. Gemini).
     * Default implementation delegates to formatToolResponse per result.
     */
    formatToolResponses(results) {
        return results.map((r) => this.formatToolResponse(r));
    }
}
exports.ModelInstance = ModelInstance;
//# sourceMappingURL=modelInstance.js.map