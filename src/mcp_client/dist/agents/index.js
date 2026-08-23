"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAgent = createAgent;
const types_1 = require("../types");
const singleFigmaSlideAgent_1 = require("./singleFigmaSlideAgent");
// Factory for agent instances based on configured type.
function createAgent(agentConfig) {
    switch (agentConfig.agentType) {
        case types_1.AgentType.SINGLE_FIGMA_SLIDE:
            return new singleFigmaSlideAgent_1.SingleFigmaSlideAgent(agentConfig);
        default:
            throw new Error(`Unsupported agent type: ${agentConfig.agentType}`);
    }
}
//# sourceMappingURL=index.js.map