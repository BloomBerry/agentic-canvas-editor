import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";
export function registerSlideTools(server) {
    // Create slide
    server.tool("create_slide", "Create a new slide in the Figma Slides presentation. Use 'column' to specify the insertion position (0-based index). For example, column=1 inserts after the first slide. column=-1 or omitted appends to the end.", {
        row: z
            .number()
            .int()
            .optional()
            .describe("Reserved for multi-row grid (not yet used)"),
        column: z
            .number()
            .int()
            .optional()
            .describe("Insertion position (0-based index). 0 = first, 1 = after first slide, -1 or omitted = append to end"),
        name: z
            .string()
            .optional()
            .describe("Name for the slide (optional)"),
    }, async ({ row, column, name }) => {
        try {
            const result = await sendCommandToFigma("create_slide", {
                row,
                column,
                name,
            });
            return createSuccessResponse({
                messages: [
                    `Created slide "${result.name || "Untitled"}" with ID: ${result.id}`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_slide" });
        }
    });
    // Delete slide
    server.tool("delete_slide", "Delete a slide from the presentation by its ID", {
        slideId: z.string().describe("ID of the slide to delete"),
    }, async ({ slideId }) => {
        try {
            const result = await sendCommandToFigma("delete_slide", { slideId });
            return createSuccessResponse({
                messages: [`Successfully deleted slide ${slideId}`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "delete_slide" });
        }
    });
    // Clone slide
    server.tool("clone_slide", "Clone an existing slide to create a duplicate", {
        slideId: z.string().describe("ID of the slide to clone"),
        name: z
            .string()
            .optional()
            .describe("Name for the cloned slide (optional)"),
    }, async ({ slideId, name }) => {
        try {
            const result = await sendCommandToFigma("clone_slide", {
                slideId,
                name,
            });
            return createSuccessResponse({
                messages: [
                    `Cloned slide "${result.name || "Untitled"}" with ID: ${result.id}`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "clone_slide" });
        }
    });
    // Focus slide
    server.tool("focus_slide", "Navigate to and focus on a specific slide in the presentation", {
        slideId: z.string().describe("ID of the slide to focus on"),
    }, async ({ slideId }) => {
        try {
            const result = await sendCommandToFigma("focus_slide", { slideId });
            return createSuccessResponse({
                messages: [`Now focusing on slide ${slideId}`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "focus_slide" });
        }
    });
    // Get focused slide
    server.tool("get_focused_slide", "Get information about the currently focused slide", {}, async () => {
        try {
            const result = await sendCommandToFigma("get_focused_slide", {});
            return createSuccessResponse({
                messages: [
                    result
                        ? `Current slide: "${result.name}" (${result.id})`
                        : "No slide is currently focused",
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "get_focused_slide" });
        }
    });
    // Get slide grid
    server.tool("get_slide_grid", "Get the complete slide grid structure with all slides organized by rows", {}, async () => {
        try {
            const result = await sendCommandToFigma("get_slide_grid", {});
            return createSuccessResponse({
                messages: [
                    `Retrieved slide grid with ${result.rows?.length || 0} rows`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "get_slide_grid" });
        }
    });
    // Get all slides
    server.tool("get_all_slides", "Get information about all slides in the presentation", {}, async () => {
        try {
            const result = await sendCommandToFigma("get_all_slides", {});
            return createSuccessResponse({
                messages: [`Found ${result.slides?.length || 0} slides`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "get_all_slides" });
        }
    });
    // Reorder slides
    server.tool("reorder_slides", "Reorder slides in the presentation. Provide the full list of slide IDs in the desired order. This is the ONLY way to change slide order — move_node does NOT affect presentation order.", {
        slideIds: z
            .array(z.string())
            .describe("Array of slide IDs in the desired presentation order"),
    }, async ({ slideIds }) => {
        try {
            const result = await sendCommandToFigma("reorder_slides", { slideIds });
            return createSuccessResponse({
                messages: [
                    `Reordered ${result.order?.length || 0} slides successfully`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "reorder_slides" });
        }
    });
    // Set slide transition
    server.tool("set_slide_transition", "Set the transition effect for a slide. For SMART_ANIMATE/DISSOLVE use 'curve' parameter. For direction-based styles (PUSH, SLIDE_IN, SLIDE_OUT, MOVE_IN, MOVE_OUT) use 'direction' parameter instead of 'curve'.", {
        slideId: z.string().describe("ID of the slide"),
        transitionStyle: z
            .enum([
            "NONE",
            "SMART_ANIMATE",
            "DISSOLVE",
            "PUSH",
            "SLIDE_IN",
            "SLIDE_OUT",
            "MOVE_IN",
            "MOVE_OUT",
        ])
            .describe("Transition style"),
        direction: z
            .enum(["LEFT", "RIGHT", "TOP", "BOTTOM"])
            .optional()
            .describe("Direction for PUSH, SLIDE_IN, SLIDE_OUT, MOVE_IN, MOVE_OUT transitions (default: LEFT)"),
        duration: z
            .number()
            .min(0)
            .max(10000)
            .optional()
            .describe("Transition duration in milliseconds (0-10000, default 300)"),
        curve: z
            .enum([
            "LINEAR",
            "EASE_IN",
            "EASE_OUT",
            "EASE_IN_AND_OUT",
            "GENTLE",
            "QUICK",
            "BOUNCY",
            "SLOW",
        ])
            .optional()
            .describe("Easing curve for SMART_ANIMATE and DISSOLVE only (default: EASE_OUT)"),
        timing: z
            .enum(["ON_CLICK", "AFTER_DELAY"])
            .optional()
            .describe("When the transition triggers (default: ON_CLICK)"),
        delay: z
            .number()
            .min(0)
            .max(10000)
            .optional()
            .describe("Delay in milliseconds before auto-advance (only for AFTER_DELAY timing)"),
    }, async ({ slideId, transitionStyle, direction, duration, curve, timing, delay }) => {
        try {
            const result = await sendCommandToFigma("set_slide_transition", {
                slideId,
                transitionStyle,
                direction: direction || "LEFT",
                duration: duration || 300,
                curve: curve || "EASE_OUT",
                timing: timing || "ON_CLICK",
                delay: delay || 0,
            });
            const displayStyle = ["PUSH", "SLIDE_IN", "SLIDE_OUT", "MOVE_IN", "MOVE_OUT"].includes(transitionStyle)
                ? `${transitionStyle} (${direction || "LEFT"})`
                : transitionStyle;
            return createSuccessResponse({
                messages: [
                    `Set transition for slide ${slideId} to ${displayStyle}`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "set_slide_transition" });
        }
    });
    // Skip slide
    server.tool("skip_slide", "Set whether a slide should be skipped during presentation mode", {
        slideId: z.string().describe("ID of the slide"),
        skip: z
            .boolean()
            .describe("Whether to skip this slide in presentation mode"),
    }, async ({ slideId, skip }) => {
        try {
            const result = await sendCommandToFigma("skip_slide", {
                slideId,
                skip,
            });
            return createSuccessResponse({
                messages: [
                    `Slide ${slideId} will ${skip ? "be skipped" : "not be skipped"} during presentation`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "skip_slide" });
        }
    });
    // Get slide properties (explore all properties including undocumented ones)
    server.tool("get_slide_properties", "Get all properties of a slide node, including undocumented ones. Useful for discovering hidden APIs like speaker notes.", {
        slideId: z.string().describe("ID of the slide to inspect"),
    }, async ({ slideId }) => {
        try {
            const result = await sendCommandToFigma("get_slide_properties", {
                slideId,
            });
            return createSuccessResponse({
                messages: [
                    `Found ${result.propertyCount} properties on slide "${result.name}"`,
                    result.hasNoteProperties
                        ? `Note-related properties found: ${Object.keys(result.noteRelatedProperties).join(", ")}`
                        : "No note-related properties found",
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "get_slide_properties" });
        }
    });
    // [DEPRECATED] Get speaker notes — Figma Plugin API does not support speaker notes.
    // This tool is kept for backward compatibility but will always return "not available".
    server.tool("get_slide_speaker_notes", "[DEPRECATED — Figma Plugin API does not support speaker notes. Do not use this tool.] Get speaker/presenter notes for a slide.", {
        slideId: z.string().describe("ID of the slide"),
    }, async ({ slideId }) => {
        try {
            const result = await sendCommandToFigma("get_slide_speaker_notes", {
                slideId,
            });
            return createSuccessResponse({
                messages: [
                    result.available
                        ? `Speaker notes found: "${result.speakerNotes}"`
                        : result.message || "Speaker notes not available",
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({
                error,
                context: "get_slide_speaker_notes",
            });
        }
    });
    // [DEPRECATED] Set speaker notes — Figma Plugin API does not support speaker notes.
    // This tool is kept for backward compatibility but will always fail.
    server.tool("set_slide_speaker_notes", "[DEPRECATED — Figma Plugin API does not support speaker notes. Do not use this tool.] Set speaker/presenter notes for a slide.", {
        slideId: z.string().describe("ID of the slide"),
        notes: z.string().describe("The speaker notes content to set"),
    }, async ({ slideId, notes }) => {
        try {
            const result = await sendCommandToFigma("set_slide_speaker_notes", {
                slideId,
                notes,
            });
            return createSuccessResponse({
                messages: [
                    result.success
                        ? `Speaker notes set successfully`
                        : result.message || "Failed to set speaker notes",
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({
                error,
                context: "set_slide_speaker_notes",
            });
        }
    });
}
