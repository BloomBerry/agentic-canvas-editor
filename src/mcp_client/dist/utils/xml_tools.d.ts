/**
 * XML Ablation: MappedTools wrapper + SceneGraph-to-OOXML converter (TypeScript)
 *
 * MappedTools wraps the real Tools instance and intercepts every callTool()
 * to remap XML element IDs → Figma SceneGraph node IDs, and convert
 * EMU absolute coordinates → pixel parent-relative coordinates.
 *
 * scenegraphToXml mirrors the Python xml_converter.py for Turn 2+ context
 * refresh where the agent re-exports the SceneGraph from Figma and needs
 * it re-converted to XML.
 */
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CallToolRequestParams } from "../types";
import { Tools } from "../core/tools";
export interface XmlIdMappingEntry {
    figmaId: string;
    type: string;
    name: string;
    parentFigmaId: string;
    parentAbsX: number;
    parentAbsY: number;
    absX: number;
    absY: number;
}
export type XmlIdMapping = Record<string, XmlIdMappingEntry>;
/**
 * Wraps a real Tools instance to intercept tool calls and:
 * 1. Remap XML element IDs (integers) to Figma node IDs ("1:23")
 * 2. Convert EMU coordinates to pixel coordinates
 * 3. Convert absolute positions to parent-relative positions
 */
export declare class MappedTools {
    private realTools;
    private mapping;
    /** Reverse lookup: Figma node ID → XML integer ID */
    private reverseMap;
    /** Next available XML integer ID for dynamically created nodes */
    private nextXmlId;
    /** Expose the catalogue so the agent can see the same tool list. */
    get catalogue(): Map<string, {
        inputSchema: {
            [x: string]: unknown;
            type: "object";
            properties?: Record<string, object> | undefined;
            required?: string[] | undefined;
        };
        name: string;
        description?: string | undefined;
        outputSchema?: {
            [x: string]: unknown;
            type: "object";
            properties?: Record<string, object> | undefined;
            required?: string[] | undefined;
        } | undefined;
        annotations?: {
            title?: string | undefined;
            readOnlyHint?: boolean | undefined;
            destructiveHint?: boolean | undefined;
            idempotentHint?: boolean | undefined;
            openWorldHint?: boolean | undefined;
        } | undefined;
        execution?: {
            taskSupport?: "optional" | "required" | "forbidden" | undefined;
        } | undefined;
        _meta?: Record<string, unknown> | undefined;
        icons?: {
            src: string;
            mimeType?: string | undefined;
            sizes?: string[] | undefined;
            theme?: "light" | "dark" | undefined;
        }[] | undefined;
        title?: string | undefined;
    }>;
    constructor(realTools: Tools, mapping: XmlIdMapping);
    /** Replace the mapping (used on Turn 2+ context refresh). */
    updateMapping(newMapping: XmlIdMapping): void;
    /** Get the current mapping (for stable ID reuse on Turn 2+ re-export). */
    getMapping(): XmlIdMapping;
    /** Proxy createToolCall to the real Tools. */
    createToolCall(toolName: string, id: string, args?: Record<string, unknown>, callId?: string): CallToolRequestParams;
    /** Intercept, remap, then delegate to real Tools.
     *  After execution, reverse-map Figma IDs in the result so the LLM
     *  only ever sees XML integer IDs.
     *  Pass timeoutMs through unchanged — the underlying Tools.callTool will
     *  apply per-tool defaults (e.g. 30 min for import_json) when undefined. */
    callTool(toolCall: CallToolRequestParams, timeoutMs?: number): Promise<CallToolResult>;
    private remapToolCall;
    private remapOperation;
    private remapArgs;
    private static buildReverseMap;
    private static computeNextId;
    /**
     * Replace all Figma node IDs ("XX:YYY" format) in tool result text
     * with their corresponding XML integer IDs.
     * For newly created nodes (not in the mapping), assign fresh XML IDs.
     *
     * Also reverse-maps structuredContent so that model formatToolResponse()
     * (which serialises both content + structuredContent) never leaks Figma IDs.
     */
    private reverseMapResult;
}
/**
 * Convert a SceneGraph JSON document to OOXML PresentationML XML.
 * TypeScript mirror of Python xml_converter.scenegraph_to_xml().
 *
 * @param previousMapping  When provided (Turn 2+), reuses the same XML
 *   integer IDs for Figma nodes that already had an assignment.  This keeps
 *   IDs stable across turns so the LLM never sees conflicting IDs between
 *   the current XML context and the Previous Turn Result summary.
 */
export declare function scenegraphToXml(sceneGraph: any, previousMapping?: XmlIdMapping): {
    xml: string;
    mapping: XmlIdMapping;
};
//# sourceMappingURL=xml_tools.d.ts.map