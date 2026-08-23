/**
 * XML Ablation Agent
 *
 * Mirrors SingleFigmaSlideAgent but:
 * 1. Wraps tools with MappedTools for XML ID → Figma ID remapping
 * 2. Converts EMU coordinates to pixel parent-relative coordinates
 * 3. Uses XML-specific prompts
 * 4. Re-converts SceneGraph to XML on Turn 2+ context refresh
 */
import { AgentMetadata, GenericMessage, SnapshotStructure, UserRequestMessage } from "../types";
import { ModelInstance } from "../models/modelInstance";
import { Tools } from "../core/tools";
import { AgentInstance } from "./agentInstance";
import { XmlIdMapping } from "../utils/xml_tools";
export declare class XmlFigmaSlideAgent extends AgentInstance {
    private mappedTools;
    /** Real (unmapped) tools — used for import/export operations. */
    private realTools;
    run(params: {
        requestMessage: UserRequestMessage;
        tools: Tools;
        model: ModelInstance;
        baseJsonString: string;
        metadata: AgentMetadata;
        imageData?: Record<string, string>;
        targetSlideIndices?: number[];
        routingMode?: string;
        rawInstruction?: string;
        xmlIdMapping?: XmlIdMapping;
    }): Promise<{
        case_id: string;
        history: GenericMessage[];
        responses: any[];
        cost: number;
        json_structure: Object;
        turn: number;
        image_uri: string;
        image_uris: string[];
        snapshots: SnapshotStructure[];
    }>;
    private buildUpdatedMessage;
    private captureSlideImages;
    private buildTurnSummary;
    private captureSnapshot;
    private addToolResultsToFormattedContext;
    private detectPartialFailures;
    private isEchoOfPreviousCalls;
}
//# sourceMappingURL=xmlFigmaSlideAgent.d.ts.map