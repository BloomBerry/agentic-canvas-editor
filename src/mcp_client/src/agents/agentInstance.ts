import {
  UserRequestMessage,
  GenericMessage,
  AgentMetadata,
  SnapshotStructure,
} from "../types";
import { ModelInstance } from "../models/modelInstance";
import { Tools } from "../core/tools";

export abstract class AgentInstance {
  public maxTurns: number;
  public maxCalls: number;
  public maxRetries?: number;

  constructor(agentConfig: { maxTurns: number; maxCalls?: number; maxRetries?: number }) {
    this.maxTurns = agentConfig.maxTurns;
    this.maxCalls = agentConfig.maxCalls ?? 50;
    this.maxRetries = agentConfig.maxRetries;
  }

  // Contract: run an agent and return the full execution trace + artifacts.
  abstract run(params: {
    requestMessage: UserRequestMessage;
    model: ModelInstance;
    tools: Tools;
    metadata?: AgentMetadata;
  }): Promise<{
    case_id: string;
    history: GenericMessage[];
    responses: any[];
    cost: number;
    json_structure: Object;
    turn: number;
    image_uri: string;
    snapshots: SnapshotStructure[];
  }>;
}
