"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createModel = createModel;
const openaiModel_1 = require("./openaiModel");
const bedrockModel_1 = require("./bedrockModel");
const anthropicModel_1 = require("./anthropicModel");
const types_1 = require("../types");
const googleModel_1 = require("./googleModel");
// Model factory used by agents/routes.
function createModel(modelConfig) {
    switch (modelConfig.modelProvider) {
        case types_1.ModelProvider.OPENAI:
            return new openaiModel_1.OpenAIModel(modelConfig);
        case types_1.ModelProvider.AMAZON:
            return new bedrockModel_1.BedrockModel(modelConfig);
        case types_1.ModelProvider.ANTHROPIC:
            return new anthropicModel_1.AnthropicModel(modelConfig);
        case types_1.ModelProvider.GOOGLE:
            return new googleModel_1.GoogleModel(modelConfig);
        default:
            throw new Error(`Unsupported model provider: ${modelConfig.modelProvider}`);
    }
}
//# sourceMappingURL=index.js.map