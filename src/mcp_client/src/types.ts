import { Request } from "express";
import {
  TextContent,
  ImageContent,
  AudioContent,
  EmbeddedResource,
  CallToolRequest,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export enum MessageType {
  SYSTEM = "system",
  USER_REQUEST = "user_request",
  USER_FEEDBACK = "user_feedback",
  INTERMEDIATE_REQUEST = "intermediate_request",
  AGENT_COMPLETION = "agent_completion",
  AGENT_REQUEST = "agent_request",
  TOOL_RESPONSE = "tool_response",
}

export enum RoleType {
  USER = "user",
  ASSISTANT = "assistant",
  SYSTEM = "system",
  TOOL = "tool",
}

export enum ContentType {
  TEXT = "text",
  IMAGE = "image",
  AUDIO = "audio",
  RESOURCE = "resource",
}

export interface BaseMessage {
  id: string;
  timestamp: number;
  role: RoleType;
  type: MessageType;
  content: (TextContent | ImageContent | AudioContent | EmbeddedResource)[];
}

export interface SystemMessage extends BaseMessage {
  role: RoleType.SYSTEM;
  type: MessageType.SYSTEM;
}

export interface UserRequestMessage extends BaseMessage {
  role: RoleType.USER;
  type: MessageType.USER_REQUEST;
}

export interface UserFeedbackMessage extends BaseMessage {
  role: RoleType.USER;
  type: MessageType.USER_FEEDBACK;
}

export interface AgentCompletionMessage extends BaseMessage {
  role: RoleType.ASSISTANT;
  type: MessageType.AGENT_COMPLETION;
  step_count: number;
}

export interface AgentRequestMessage extends BaseMessage {
  role: RoleType.ASSISTANT;
  type: MessageType.AGENT_REQUEST;
  calls: CallToolRequestParams[];
}

export interface IntermediateRequestMessage extends BaseMessage {
  role: RoleType.USER;
  type: MessageType.INTERMEDIATE_REQUEST;
}

export interface ToolResponseMessage extends BaseMessage {
  role: RoleType.TOOL;
  type: MessageType.TOOL_RESPONSE;
  results: CallToolResult[];
}

export type GenericMessage =
  | SystemMessage
  | UserRequestMessage
  | UserFeedbackMessage
  | AgentCompletionMessage
  | AgentRequestMessage
  | ToolResponseMessage
  | IntermediateRequestMessage;

export enum ToolResponseFormat {
  TEXT = "text",
  IMAGE = "image",
  AUDIO = "audio",
  RESOURCE = "resource",
}

export type CallToolRequestParams = CallToolRequest["params"] & {
  id?: string;
  call_id?: string;
};

export interface ModelConfig {
  modelName: string;
  modelProvider: ModelProvider;
  inputCost: number;
  outputCost: number;
  temperature: number;
  maxTokens: number;
  thinkingLevel?: string; // Gemini 3: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH"
}

export interface AgentConfig {
  agentType: AgentType;
  maxTurns: number;
  maxCalls?: number;
  maxRetries?: number;
}

export enum AgentType {
  SINGLE_FIGMA_SLIDE = "single_figma_slide",
}

// CARE (Context-Aware Routing Engine) modes
export enum RoutingMode {
  MICRO_SPATIAL = "micro_spatial",
  MACRO_PROGRAMMATIC = "macro_programmatic",
  SYSTEMIC_TOKEN = "systemic_token",
  FULL = "full",
}

export interface ServerConfig {
  models: ModelConfig[];
  agent_type: AgentType;
}

export enum ServerStatus {
  READY = "ready",
  CLOSED = "closed",
  CLOSING = "closing",
  ERROR = "error",
}

export interface AgentMetadata {
  caseId: string;
  width?: number;
  height?: number;
}

export interface MulterRequest extends Request {
  file?: Express.Multer.File;
  files?:
    | Express.Multer.File[]
    | { [fieldname: string]: Express.Multer.File[] };
}

export enum ModelProvider {
  OPENAI = "openai",
  AMAZON = "amazon",
  ANTHROPIC = "anthropic",
  GOOGLE = "google",
}

export enum ResponseStatus {
  SUCCESS = "success",
  ERROR = "error",
}

export interface ResponseData {
  status: ResponseStatus;
  message?: string;
  error?: string;
  payload?: Object;
}

export type ToolList = Awaited<ReturnType<Client["listTools"]>>;

export type ToolItem = ToolList["tools"][number];

export interface SnapshotStructure {
  case_id: string;
  init: boolean;
  turn: number;
  image_uri: string;
  image_uris?: string[];
  structure: Object;
  toolResults: CallToolResult[];
}
