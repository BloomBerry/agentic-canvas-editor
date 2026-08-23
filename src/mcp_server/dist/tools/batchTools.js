import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createSuccessResponse, createErrorResponse, } from "../common/utils.js";
export function registerBatchTools(server) {
    server.tool("batch_execute", "Execute multiple tool operations in a single batch call. Use this when you need to apply the same or similar changes to many nodes (e.g., changing font on 50+ text nodes, recoloring multiple shapes). Each operation is a {command, params} pair that maps to an existing tool. Returns per-operation results with success/failure counts.", {
        operations: z
            .array(z.object({
            command: z
                .string()
                .describe("Tool/command name (e.g., 'set_text_font', 'set_fill_color', 'move_node')"),
            params: z
                .record(z.any())
                .optional()
                .describe("Parameters for the command (required: wrap command-specific args here)"),
        }).passthrough())
            .describe("Array of {command, params} operations to execute sequentially"),
    }, async ({ operations }) => {
        try {
            // Normalize: if params is missing, extract all non-command fields as params
            const normalizedOps = operations.map((op) => {
                if (op.params && typeof op.params === "object") {
                    return { command: op.command, params: op.params };
                }
                const { command, params, ...rest } = op;
                return { command, params: rest };
            });
            const timeoutMs = Math.max(30000, normalizedOps.length * 10000);
            const result = await sendCommandToFigma("batch_execute", { operations: normalizedOps }, timeoutMs);
            return createSuccessResponse({
                messages: [
                    `Batch executed ${normalizedOps.length} operations: ${result.succeeded}/${result.total} succeeded`,
                ],
                dataItem: result,
            });
        }
        catch (error) {
            return createErrorResponse({ error, context: "batch_execute" });
        }
    });
}
