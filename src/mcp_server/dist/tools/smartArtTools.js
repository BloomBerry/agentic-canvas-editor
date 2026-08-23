import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";
const ColorSchema = z.object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1).optional(),
});
const SmartArtStyleSchema = z.object({
    colorPalette: z
        .enum(["dark", "colorful", "monochrome", "accent1", "accent2", "accent3", "custom"])
        .optional()
        .describe("Color palette theme (default: dark). 'dark' = professional dark navy, 'colorful' = bright multi-color"),
    customColors: z
        .array(ColorSchema)
        .optional()
        .describe("Custom colors when palette is 'custom'"),
    backgroundColor: ColorSchema.optional().describe("Background color for the SmartArt frame"),
    fontFamily: z
        .string()
        .optional()
        .describe("Font family (default: Inter)"),
    fontSize: z
        .number()
        .optional()
        .describe("Base font size (default: 14)"),
    titleFontSize: z
        .number()
        .optional()
        .describe("Title/header font size (default: 16)"),
    blockCornerRadius: z
        .number()
        .optional()
        .describe("Corner radius for blocks (default: 8)"),
    connectorColor: ColorSchema.optional().describe("Arrow/connector color"),
    connectorWidth: z
        .number()
        .optional()
        .describe("Arrow/connector stroke width (default: 2)"),
});
const SmartArtTypeEnum = z.enum([
    "basic_block_list",
    "vertical_block_list",
    "basic_process",
    "chevron_process",
    "org_chart",
    "basic_venn",
    "basic_cycle",
    "basic_matrix",
]);
export function registerSmartArtTools(server) {
    // Create SmartArt
    server.tool("create_smartart", "Create a SmartArt diagram from bullet text. Converts hierarchical bullet lists into predefined visual layouts (list, process, hierarchy, relationship, cycle, matrix). Input text uses bullet markers (-, *, or numbered) with indentation for nesting. Layout types: basic_block_list (horizontal colored blocks), vertical_block_list (vertical blocks with title+description), basic_process (steps with arrows), chevron_process (chevron arrow shapes), org_chart (tree hierarchy), basic_venn (overlapping circles), basic_cycle (circular arrangement), basic_matrix (2x2 grid).", {
        x: z.number().optional().describe("X coordinate (default: 0)"),
        y: z.number().optional().describe("Y coordinate (default: 0)"),
        width: z.number().optional().describe("SmartArt width (default: 800)"),
        height: z.number().optional().describe("SmartArt height (default: 400)"),
        smartArtType: SmartArtTypeEnum.describe("SmartArt layout type"),
        bulletText: z
            .string()
            .describe("Hierarchical bullet text. Use '- ' or '* ' or '1. ' for items. Indent with 2 spaces or tab for nesting. Example:\n- Item 1\n- Item 2\n  - Sub Item 2.1\n  - Sub Item 2.2\n- Item 3"),
        style: SmartArtStyleSchema.optional().describe("SmartArt styling options"),
        parentId: z
            .string()
            .optional()
            .describe("Parent node ID (defaults to current slide)"),
        name: z
            .string()
            .optional()
            .describe("Name for the SmartArt frame"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_smartart", params);
            return createSuccessResponse({
                messages: [
                    `Created ${result.smartArtType} SmartArt "${result.name}" (${result.id}) - ${result.itemCount} items`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_smartart" });
        }
    });
    // Update SmartArt
    server.tool("update_smartart", "Update an existing SmartArt diagram with new bullet text and/or styling. The SmartArt will be re-rendered while preserving its type and position.", {
        smartArtId: z.string().describe("ID of the SmartArt to update"),
        bulletText: z
            .string()
            .optional()
            .describe("New bullet text content"),
        style: SmartArtStyleSchema.optional().describe("Updated styling options (merged with existing)"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("update_smartart", params);
            return createSuccessResponse({
                messages: [`Updated SmartArt "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "update_smartart" });
        }
    });
    // Change SmartArt Type
    server.tool("change_smartart_type", "Change the layout type of an existing SmartArt diagram. Data is preserved and the diagram is re-rendered with the new layout. Supports: basic_block_list, vertical_block_list, basic_process, chevron_process, org_chart, basic_venn, basic_cycle, basic_matrix.", {
        smartArtId: z.string().describe("ID of the SmartArt to modify"),
        newType: SmartArtTypeEnum.describe("New SmartArt layout type"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("change_smartart_type", params);
            return createSuccessResponse({
                messages: [
                    `Changed SmartArt type from "${result.oldType}" to "${result.newType}"`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({
                error,
                context: "change_smartart_type",
            });
        }
    });
    // Get SmartArt Info
    server.tool("get_smartart_info", "Get the current data, layout type, and styling of an existing SmartArt diagram.", {
        smartArtId: z.string().describe("ID of the SmartArt to inspect"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("get_smartart_info", params);
            return createSuccessResponse({
                messages: [
                    `SmartArt "${result.name}" (type: ${result.smartArtType})`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({
                error,
                context: "get_smartart_info",
            });
        }
    });
}
