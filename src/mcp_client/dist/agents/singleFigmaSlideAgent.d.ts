import { AgentMetadata, GenericMessage, SnapshotStructure, UserRequestMessage } from "../types";
import { ModelInstance } from "../models/modelInstance";
import { Tools } from "../core/tools";
import { AgentInstance } from "./agentInstance";
export declare class SingleFigmaSlideAgent extends AgentInstance {
    /**
     * Agentic modification for Figma Slides presentations.
     *
     * Each turn starts with a FRESH context:
     *   Turn 1: original image + prompt
     *   Turn 2+: re-captured image + prompt + previous turn summary
     *
     * This prevents context window overflow from accumulated tool results
     * and avoids paying image tokens for stale images every turn.
     */
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
        skipImport?: boolean;
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
    /**
     * Build a fresh UserRequestMessage for Turn 2+ with:
     * - Re-exported scene graph JSON (current canvas state)
     * - Re-captured slide images (current canvas state)
     * - Original prompt text (fallback if export fails)
     * - Summary of previous turn results
     */
    private buildUpdatedMessage;
    /**
     * Capture current slide images from Figma canvas.
     */
    private captureSlideImages;
    /**
     * Build a concise summary of tool results for the next turn's context.
     */
    private buildTurnSummary;
    private captureSnapshot;
    /**
     * Add tool results to formatted context for experiment logging only.
     * (API context is managed per-turn in the main loop.)
     */
    private addToolResultsToFormattedContext;
    /**
     * Check whether any tool results contain failures — either direct isError
     * results or partial failures inside batch_execute responses.
     */
    private detectPartialFailures;
    /**
     * Check whether text output is just an echo/recap of previously executed
     * tool calls (not a genuine context overflow).
     *
     * Returns true if the text mentions tool names that were already executed
     * in this turn and does NOT introduce new, unexecuted tool names.
     */
    private isEchoOfPreviousCalls;
}
//# sourceMappingURL=singleFigmaSlideAgent.d.ts.map