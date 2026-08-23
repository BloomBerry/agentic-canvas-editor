import { AgentConfig, AgentType } from "../types";
import { AgentInstance } from "./agentInstance";
import { SingleFigmaSlideAgent } from "./singleFigmaSlideAgent";

// Factory for agent instances based on configured type.
export function createAgent(agentConfig: AgentConfig): AgentInstance {
  switch (agentConfig.agentType) {
    case AgentType.SINGLE_FIGMA_SLIDE:
      return new SingleFigmaSlideAgent(agentConfig);
    default:
      throw new Error(`Unsupported agent type: ${agentConfig.agentType}`);
  }
}
