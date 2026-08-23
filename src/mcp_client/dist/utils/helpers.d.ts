import { Tools } from "../core/tools";
type LogEntry = {
    header: string;
    body?: string;
};
export declare const logger: {
    info: ({ header, body }: LogEntry) => boolean;
    debug: ({ header, body }: LogEntry) => boolean;
    warn: ({ header, body }: LogEntry) => boolean;
    error: ({ header, body }: LogEntry) => boolean;
    log: ({ header, body }: LogEntry) => boolean;
};
export interface Message {
    role: string;
    content: any;
    id?: string;
}
export declare function base64Encode(buffer: Buffer): string;
export declare function createImageUrl(base64Data: string, mimeType?: string): string;
export declare const reduceBase64Image: (base64Image: string, mimeType?: string, maxHeight?: number) => Promise<{
    base64: string;
    width: number;
    height: number;
}>;
export declare function getAllSlides(tools: Tools): Promise<any>;
export declare function exportSlideImage(tools: Tools, slideId?: string): Promise<string>;
export declare function getSlidePageInfo(tools: Tools): Promise<Object>;
export declare function importJsonToFigma(tools: Tools, jsonString: string, imageData?: Record<string, string>, slideIndicesToImport?: number[]): Promise<{
    slideIds: string[];
    slideCount: number;
    nodeIdMap: Record<string, string>;
}>;
/**
 * Get the current page structure as a text description (node id, name, type, position).
 * Use this once after import_json to provide live node IDs to the agent.
 */
export declare function getLoadedPageStructureDescription(tools: Tools): Promise<string>;
export declare function exportJsonFromFigma(tools: Tools): Promise<Object>;
/**
 * Count slides from an exported JSON_REST_V1 document.
 * Handles the various nesting structures: SLIDE, FRAME, SECTION, SLIDE_ROW.
 */
export declare function countSlidesFromExportedJson(exportedJson: any): number;
/**
 * Strip an exported JSON_REST_V1 document to a lightweight skeleton,
 * keeping only identity (id, name, type), text content, minimal style,
 * and compact bounds [x, y, w, h] for spatial reasoning.
 *
 * Mirrors the Python `extract_skeleton_json()` logic from care_context.py.
 * Expected reduction: ~85-95 % of original size.
 */
export declare function extractSkeletonFromExportedJson(exportedJson: any): any;
export {};
//# sourceMappingURL=helpers.d.ts.map