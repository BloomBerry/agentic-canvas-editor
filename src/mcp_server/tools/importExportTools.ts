import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { SERVER_CONFIG } from "../config.js";
import {
  createSuccessResponse,
  createErrorResponse,
} from "../common/utils.js";

export function registerImportExportTools(server: McpServer) {
  server.tool(
    "clear_canvas",
    "Remove all top-level nodes from the current Figma page, leaving it completely empty",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("clear_canvas");
        return createSuccessResponse({
          messages: [`Canvas cleared: ${result?.removed ?? 0} node(s) removed`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "clear_canvas" });
      }
    }
  );

  server.tool(
    "export_json",
    "Export the complete Figma Slides page as structured JSON (JSON_REST_V1 format), including every slide and all nested nodes",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("export_json");

        return createSuccessResponse({
          messages: [
            `Exported page as JSON with ${
              result?.document?.children?.length ?? "unknown"
            } top-level elements`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({
          error,
          context: "export_json",
        });
      }
    }
  );

  server.tool(
    "import_json",
    "Import and render slides from a JSON_REST_V1 document string into the current Figma Slides page. Clears existing slides first.",
    {
      jsonString: z
        .string()
        .describe(
          "The raw REST-v1 document JSON string to import and render as slides"
        ),
      imageData: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          "Optional mapping of imageRef → base64-encoded PNG bytes for IMAGE fills"
        ),
      slideIndicesToImport: z
        .array(z.number().int().min(0))
        .optional()
        .describe(
          "Optional 0-based slide indices to selectively import. Slides not in this list are kept as-is. Omit for full import."
        ),
    },
    async ({ jsonString, imageData, slideIndicesToImport }) => {
      try {
        const result = await sendCommandToFigma(
          "import_json",
          {
            jsonString,
            ...(imageData ? { imageData } : {}),
            ...(slideIndicesToImport ? { slideIndicesToImport } : {}),
          },
          SERVER_CONFIG.importTimeout
        );

        return createSuccessResponse({
          messages: [
            `Successfully imported ${result.slideCount} slide(s). Slide IDs: ${result.slideIds?.join(", ")}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({
          error,
          context: "import_json",
        });
      }
    }
  );
}
