"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentInstance = void 0;
class AgentInstance {
    constructor(agentConfig) {
        this.maxTurns = agentConfig.maxTurns;
        this.maxCalls = agentConfig.maxCalls ?? 50;
        this.maxRetries = agentConfig.maxRetries;
    }
}
exports.AgentInstance = AgentInstance;
//# sourceMappingURL=agentInstance.js.map