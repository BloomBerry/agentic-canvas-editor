import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";
const ColorSchema = z.object({
    r: z.number().min(0).max(1),
    g: z.number().min(0).max(1),
    b: z.number().min(0).max(1),
    a: z.number().min(0).max(1).optional(),
});
const TableStyleSchema = z.object({
    headerBackground: ColorSchema.optional().describe("Header row background color"),
    headerTextColor: ColorSchema.optional().describe("Header text color"),
    cellBackground: ColorSchema.optional().describe("Cell background color"),
    cellTextColor: ColorSchema.optional().describe("Cell text color"),
    borderColor: ColorSchema.optional().describe("Border color"),
    borderWidth: z.number().optional().describe("Border width (default: 1)"),
    cellPadding: z.number().optional().describe("Cell padding in px (default: 12)"),
    fontSize: z.number().optional().describe("Cell font size (default: 14)"),
    headerFontSize: z.number().optional().describe("Header font size (default: 14)"),
    fontFamily: z.string().optional().describe("Font family (default: Inter)"),
    minCellWidth: z.number().optional().describe("Minimum cell width (default: 80)"),
    minCellHeight: z.number().optional().describe("Minimum cell height (default: 36)"),
    stripedRows: z.boolean().optional().describe("Alternating row background colors"),
    stripedColor: ColorSchema.optional().describe("Color for alternating rows"),
    cornerRadius: z.number().optional().describe("Table corner radius"),
});
export function registerTableTools(server) {
    // Create Table from text (CSV/TSV/Markdown)
    server.tool("create_table", "Create a table from text data. Supports CSV, TSV, and Markdown table formats. Auto-detects format if not specified. The text is parsed and rendered as a styled Frame-based table with header row, cell borders, and auto-layout.", {
        x: z.number().optional().describe("X coordinate (default: 0)"),
        y: z.number().optional().describe("Y coordinate (default: 0)"),
        width: z.number().optional().describe("Table width (default: 600)"),
        text: z.string().describe("Table data as text. CSV example: 'Name,Age\\nAlice,30\\nBob,25'. TSV: tab-separated. Markdown: '| Name | Age |\\n|---|---|\\n| Alice | 30 |'"),
        format: z
            .enum(["csv", "tsv", "markdown", "auto"])
            .optional()
            .describe("Input format (default: auto-detect)"),
        hasHeader: z.boolean().optional().describe("Whether first row is a header (default: auto-detect)"),
        style: TableStyleSchema.optional().describe("Table styling options"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        name: z.string().optional().describe("Name for the table frame"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_table", params);
            return createSuccessResponse({
                messages: [`Created table "${result.name}" (${result.id}) - ${result.columns} columns, ${result.rows} rows, format: ${result.format}`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_table" });
        }
    });
    // Create Table from structured data (headers + rows arrays)
    server.tool("create_table_from_data", "Create a table from structured data (headers array + rows array). Use this when you already have parsed data rather than raw text.", {
        x: z.number().optional().describe("X coordinate (default: 0)"),
        y: z.number().optional().describe("Y coordinate (default: 0)"),
        width: z.number().optional().describe("Table width (default: 600)"),
        headers: z.array(z.string()).describe("Column header labels"),
        rows: z.array(z.array(z.string())).describe("2D array of cell values"),
        alignments: z
            .array(z.enum(["LEFT", "CENTER", "RIGHT"]))
            .optional()
            .describe("Column alignments (default: all LEFT)"),
        style: TableStyleSchema.optional().describe("Table styling options"),
        parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
        name: z.string().optional().describe("Name for the table frame"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("create_table_from_data", params);
            return createSuccessResponse({
                messages: [`Created table "${result.name}" (${result.id}) - ${result.columns} columns, ${result.rows} rows`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "create_table_from_data" });
        }
    });
    // Update Table
    server.tool("update_table", "Update an existing table with new text data or styling. The table will be re-rendered.", {
        tableId: z.string().describe("ID of the table to update"),
        text: z.string().optional().describe("New table data as text"),
        format: z
            .enum(["csv", "tsv", "markdown", "auto"])
            .optional()
            .describe("Input format for the new text"),
        style: TableStyleSchema.optional().describe("Updated styling options (merged with existing)"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("update_table", params);
            return createSuccessResponse({
                messages: [`Updated table "${result.name}" (${result.id})`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "update_table" });
        }
    });
    // Get Table Info
    server.tool("get_table_info", "Get the current data, structure, and styling of an existing table.", {
        tableId: z.string().describe("ID of the table to inspect"),
    }, async (params) => {
        try {
            const result = await sendCommandToFigma("get_table_info", params);
            return createSuccessResponse({
                messages: [`Table "${result.name}" - ${result.columns} columns, ${result.rows} rows`],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "get_table_info" });
        }
    });
}
