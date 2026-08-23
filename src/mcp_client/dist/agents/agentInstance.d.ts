import { UserRequestMessage, GenericMessage, AgentMetadata, SnapshotStructure } from "../types";
import { ModelInstance } from "../models/modelInstance";
import { Tools } from "../core/tools";
export declare abstract class AgentInstance {
    maxTurns: number;
    maxCalls: number;
    maxRetries?: number;
    constructor(agentConfig: {
        maxTurns: number;
        maxCalls?: number;
        maxRetries?: number;
    });
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
//# sourceMappingURL=agentInstance.d.ts.map