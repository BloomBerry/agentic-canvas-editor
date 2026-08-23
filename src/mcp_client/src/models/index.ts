import { OpenAIModel } from "./openaiModel";
import { BedrockModel } from "./bedrockModel";
import { AnthropicModel } from "./anthropicModel";
import { ModelConfig, ModelProvider } from "../types";
import { ModelInstance } from "./modelInstance";
import { GoogleModel } from "./googleModel";

// Model factory used by agents/routes.
export function createModel(modelConfig: ModelConfig): ModelInstance {
  switch (modelConfig.modelProvider) {
    case ModelProvider.OPENAI:
      return new OpenAIModel(modelConfig);
    case ModelProvider.AMAZON:
      return new BedrockModel(modelConfig);
    case ModelProvider.ANTHROPIC:
      return new AnthropicModel(modelConfig);
    case ModelProvider.GOOGLE:
      return new GoogleModel(modelConfig);
    default:
      throw new Error(
        `Unsupported model provider: ${modelConfig.modelProvider}`
      );
  }
}
