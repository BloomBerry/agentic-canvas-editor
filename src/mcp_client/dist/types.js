"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResponseStatus = exports.ModelProvider = exports.ServerStatus = exports.RoutingMode = exports.AgentType = exports.ToolResponseFormat = exports.ContentType = exports.RoleType = exports.MessageType = void 0;
var MessageType;
(function (MessageType) {
    MessageType["SYSTEM"] = "system";
    MessageType["USER_REQUEST"] = "user_request";
    MessageType["USER_FEEDBACK"] = "user_feedback";
    MessageType["INTERMEDIATE_REQUEST"] = "intermediate_request";
    MessageType["AGENT_COMPLETION"] = "agent_completion";
    MessageType["AGENT_REQUEST"] = "agent_request";
    MessageType["TOOL_RESPONSE"] = "tool_response";
})(MessageType || (exports.MessageType = MessageType = {}));
var RoleType;
(function (RoleType) {
    RoleType["USER"] = "user";
    RoleType["ASSISTANT"] = "assistant";
    RoleType["SYSTEM"] = "system";
    RoleType["TOOL"] = "tool";
})(RoleType || (exports.RoleType = RoleType = {}));
var ContentType;
(function (ContentType) {
    ContentType["TEXT"] = "text";
    ContentType["IMAGE"] = "image";
    ContentType["AUDIO"] = "audio";
    ContentType["RESOURCE"] = "resource";
})(ContentType || (exports.ContentType = ContentType = {}));
var ToolResponseFormat;
(function (ToolResponseFormat) {
    ToolResponseFormat["TEXT"] = "text";
    ToolResponseFormat["IMAGE"] = "image";
    ToolResponseFormat["AUDIO"] = "audio";
    ToolResponseFormat["RESOURCE"] = "resource";
})(ToolResponseFormat || (exports.ToolResponseFormat = ToolResponseFormat = {}));
var AgentType;
(function (AgentType) {
    AgentType["SINGLE_FIGMA_SLIDE"] = "single_figma_slide";
})(AgentType || (exports.AgentType = AgentType = {}));
// CARE (Context-Aware Routing Engine) modes
var RoutingMode;
(function (RoutingMode) {
    RoutingMode["MICRO_SPATIAL"] = "micro_spatial";
    RoutingMode["MACRO_PROGRAMMATIC"] = "macro_programmatic";
    RoutingMode["SYSTEMIC_TOKEN"] = "systemic_token";
    RoutingMode["FULL"] = "full";
})(RoutingMode || (exports.RoutingMode = RoutingMode = {}));
var ServerStatus;
(function (ServerStatus) {
    ServerStatus["READY"] = "ready";
    ServerStatus["CLOSED"] = "closed";
    ServerStatus["CLOSING"] = "closing";
    ServerStatus["ERROR"] = "error";
})(ServerStatus || (exports.ServerStatus = ServerStatus = {}));
var ModelProvider;
(function (ModelProvider) {
    ModelProvider["OPENAI"] = "openai";
    ModelProvider["AMAZON"] = "amazon";
    ModelProvider["ANTHROPIC"] = "anthropic";
    ModelProvider["GOOGLE"] = "google";
})(ModelProvider || (exports.ModelProvider = ModelProvider = {}));
var ResponseStatus;
(function (ResponseStatus) {
    ResponseStatus["SUCCESS"] = "success";
    ResponseStatus["ERROR"] = "error";
})(ResponseStatus || (exports.ResponseStatus = ResponseStatus = {}));
//# sourceMappingURL=types.js.map