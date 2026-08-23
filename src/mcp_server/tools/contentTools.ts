import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sendCommandToFigma } from "../common/websocket.js";
import { createErrorResponse, createSuccessResponse } from "../common/utils.js";

export function registerContentTools(server: McpServer) {
  // Create Rectangle
  server.tool(
    "create_rectangle",
    "Create a rectangle shape on the current slide",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      width: z.number().describe("Width of the rectangle"),
      height: z.number().describe("Height of the rectangle"),
      name: z.string().optional().describe("Name for the rectangle"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node ID (defaults to current slide)"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Fill color in RGBA format"),
      strokeColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Stroke color in RGBA format"),
      strokeWeight: z.number().optional().describe("Stroke weight in pixels"),
      cornerRadius: z
        .number()
        .optional()
        .describe("Corner radius for rounded corners"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_rectangle", params);
        return createSuccessResponse({
          messages: [`Created rectangle "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_rectangle" });
      }
    }
  );

  // Create Frame
  server.tool(
    "create_frame",
    "Create a frame container on the current slide",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      width: z.number().describe("Width of the frame"),
      height: z.number().describe("Height of the frame"),
      name: z.string().optional().describe("Name for the frame"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node ID (defaults to current slide)"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Fill color in RGBA format"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_frame", params);
        return createSuccessResponse({
          messages: [`Created frame "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_frame" });
      }
    }
  );

  // Create Text
  server.tool(
    "create_text",
    "Create a text element on the current slide",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      text: z.string().describe("Text content"),
      name: z.string().optional().describe("Name for the text node"),
      fontSize: z.number().optional().describe("Font size (default: 14)"),
      fontColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Text color in RGBA format"),
      textAlign: z
        .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
        .optional()
        .describe("Text alignment"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node ID (defaults to current slide)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_text", params);
        return createSuccessResponse({
          messages: [`Created text "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_text" });
      }
    }
  );

  // Create Ellipse
  server.tool(
    "create_ellipse",
    "Create an ellipse/circle shape on the current slide",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      width: z.number().describe("Width of the ellipse"),
      height: z.number().describe("Height of the ellipse"),
      name: z.string().optional().describe("Name for the ellipse"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node ID (defaults to current slide)"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Fill color in RGBA format"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_ellipse", params);
        return createSuccessResponse({
          messages: [`Created ellipse "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_ellipse" });
      }
    }
  );

  // Create Marker
  server.tool(
    "create_marker",
    "Create a marker shape (data-point marker) on the current slide. Supports: circle, square, diamond, triangle_up, triangle_down, star, pentagon, hexagon, x, plus. Useful for chart data points, annotations, or decorative markers.",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      size: z.number().describe("Marker size in pixels (width & height)"),
      shape: z
        .enum([
          "circle",
          "square",
          "diamond",
          "triangle_up",
          "triangle_down",
          "star",
          "pentagon",
          "hexagon",
          "x",
          "plus",
        ])
        .describe("Marker shape type"),
      name: z.string().optional().describe("Name for the marker node"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node ID (defaults to current slide)"),
      fillColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Fill color in RGBA format"),
      strokeColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Stroke color in RGBA format"),
      strokeWeight: z.number().optional().describe("Stroke weight in pixels"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_marker", params);
        return createSuccessResponse({
          messages: [`Created ${params.shape} marker "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_marker" });
      }
    }
  );

  // Create Graphic (SVG)
  server.tool(
    "create_graphic",
    "Create a vector graphic from SVG markup on the current slide",
    {
      svg: z.string().describe("SVG markup string"),
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      name: z.string().optional().describe("Name for the graphic"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node ID (defaults to current slide)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_graphic", params);
        return createSuccessResponse({
          messages: [`Created graphic "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_graphic" });
      }
    }
  );

  // Move Node
  server.tool(
    "move_node",
    "Move a node to a new position, optionally changing its parent container",
    {
      nodeId: z.string().describe("ID of the node to move"),
      x: z.number().describe("New X coordinate"),
      y: z.number().describe("New Y coordinate"),
      parentId: z
        .string()
        .optional()
        .describe("Optional new parent node ID (Frame, Group, or Slide) to reparent into"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("move_node", params);
        return createSuccessResponse({
          messages: [
            params.parentId
              ? `Moved node ${params.nodeId} to (${params.x}, ${params.y}) in parent ${params.parentId}`
              : `Moved node ${params.nodeId} to (${params.x}, ${params.y})`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "move_node" });
      }
    }
  );

  // Resize Node
  server.tool(
    "resize_node",
    "Resize a node to new dimensions",
    {
      nodeId: z.string().describe("ID of the node to resize"),
      width: z.number().describe("New width"),
      height: z.number().describe("New height"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("resize_node", params);
        return createSuccessResponse({
          messages: [
            `Resized node ${params.nodeId} to ${params.width}x${params.height}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "resize_node" });
      }
    }
  );

  // Delete Node
  server.tool(
    "delete_node",
    "Delete a node from the slide",
    {
      nodeId: z.string().describe("ID of the node to delete"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("delete_node", params);
        return createSuccessResponse({
          messages: [`Deleted node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "delete_node" });
      }
    }
  );

  // Clone Node
  server.tool(
    "clone_node",
    "Clone/duplicate a node. Use parentId to place the clone inside a specific Frame or container.",
    {
      nodeId: z.string().describe("ID of the node to clone"),
      offsetX: z.number().optional().describe("X offset for the clone"),
      offsetY: z.number().optional().describe("Y offset for the clone"),
      parentId: z.string().optional().describe("Parent node ID to place the clone into (e.g., a Frame ID)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("clone_node", params);
        return createSuccessResponse({
          messages: [`Cloned node ${params.nodeId} (new ID: ${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "clone_node" });
      }
    }
  );

  // Group Nodes
  server.tool(
    "group_nodes",
    "Group multiple nodes together",
    {
      nodeIds: z.array(z.string()).describe("Array of node IDs to group"),
      groupName: z.string().optional().describe("Name for the group"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("group_nodes", params);
        return createSuccessResponse({
          messages: [`Grouped ${params.nodeIds.length} nodes (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "group_nodes" });
      }
    }
  );

  // Ungroup Nodes
  server.tool(
    "ungroup_nodes",
    "Ungroup a group node",
    {
      groupId: z.string().describe("ID of the group to ungroup"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("ungroup_nodes", params);
        return createSuccessResponse({
          messages: [`Ungrouped group ${params.groupId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "ungroup_nodes" });
      }
    }
  );

  // Reparent Node - move a node to a different parent container
  server.tool(
    "reparent_node",
    "Move a node to a different parent container (Frame, Group, or Slide). This is useful for placing nodes inside Frames after cloning.",
    {
      nodeId: z.string().describe("ID of the node to move"),
      parentId: z.string().describe("ID of the new parent (Frame, Group, or Slide)"),
      index: z
        .number()
        .int()
        .optional()
        .describe("Optional index position in the parent's children array"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("reparent_node", params);
        return createSuccessResponse({
          messages: [
            `Moved node ${params.nodeId} to parent ${params.parentId}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "reparent_node" });
      }
    }
  );

  // Set Fill Color
  server.tool(
    "set_fill_color",
    "Set the fill color of a node",
    {
      nodeId: z.string().describe("ID of the node"),
      color: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).describe("Color in RGBA format"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_fill_color", params);
        return createSuccessResponse({
          messages: [`Set fill color for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_fill_color" });
      }
    }
  );

  // Set Stroke
  server.tool(
    "set_stroke",
    "Set the stroke properties of a node",
    {
      nodeId: z.string().describe("ID of the node"),
      color: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).describe("Stroke color in RGBA format"),
      weight: z.number().optional().describe("Stroke weight in pixels"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_stroke", params);
        return createSuccessResponse({
          messages: [`Set stroke for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_stroke" });
      }
    }
  );

  // Set Opacity
  server.tool(
    "set_opacity",
    "Set the opacity of a node",
    {
      nodeId: z.string().describe("ID of the node"),
      opacity: z.number().min(0).max(1).describe("Opacity value (0-1)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_opacity", params);
        return createSuccessResponse({
          messages: [`Set opacity to ${params.opacity} for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_opacity" });
      }
    }
  );

  // Set Corner Radius
  server.tool(
    "set_corner_radius",
    "Set the corner radius of a node",
    {
      nodeId: z.string().describe("ID of the node"),
      radius: z.number().describe("Corner radius value"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_corner_radius", params);
        return createSuccessResponse({
          messages: [`Set corner radius to ${params.radius} for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_corner_radius" });
      }
    }
  );

  // Set Text Content
  server.tool(
    "set_text_content",
    "Set the text content of a text node",
    {
      nodeId: z.string().describe("ID of the text node"),
      text: z.string().describe("New text content"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_text_content", params);
        return createSuccessResponse({
          messages: [`Set text content for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_text_content" });
      }
    }
  );

  // Set Text Properties
  server.tool(
    "set_text_properties",
    "Set text properties like font size, color, alignment",
    {
      nodeId: z.string().describe("ID of the text node"),
      fontSize: z.number().optional().describe("Font size"),
      fontColor: z
        .object({
          r: z.number().min(0).max(1),
          g: z.number().min(0).max(1),
          b: z.number().min(0).max(1),
          a: z.number().min(0).max(1).optional(),
        })
        .optional()
        .describe("Font color in RGBA format"),
      textAlign: z
        .enum(["LEFT", "CENTER", "RIGHT", "JUSTIFIED"])
        .optional()
        .describe("Text alignment"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_text_properties", params);
        return createSuccessResponse({
          messages: [`Set text properties for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_text_properties" });
      }
    }
  );

  // Get Text Node Info
  server.tool(
    "get_text_node_info",
    "Collect all text nodes within a specified node",
    {
      nodeId: z.string().describe("ID of the node to search for text nodes"),
      depth: z
        .number()
        .optional()
        .describe("Maximum depth to search (optional)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("get_text_node_info", params);
        return createSuccessResponse({
          messages: [
            `Found ${result.totalTextNodes} text node(s) in node ${params.nodeId}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_text_node_info" });
      }
    }
  );

  // Set Text Decoration
  server.tool(
    "set_text_decoration",
    "Set text decoration (underline/strikethrough/casing) on a text node",
    {
      nodeId: z.string().describe("ID of the text node to modify"),
      textDecoration: z
        .enum(["NONE", "UNDERLINE", "STRIKETHROUGH"])
        .optional()
        .describe("Text decoration style"),
      textCase: z
        .enum([
          "ORIGINAL",
          "UPPER",
          "LOWER",
          "TITLE",
          "SMALL_CAPS",
          "SMALL_CAPS_FORCED",
        ])
        .optional()
        .describe("Text case transformation"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_text_decoration", params);
        return createSuccessResponse({
          messages: [`Set text decoration for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_text_decoration" });
      }
    }
  );

  // Set Text Font
  server.tool(
    "set_text_font",
    "Set the font family and style of a text node",
    {
      nodeId: z.string().describe("ID of the text node to modify"),
      fontFamily: z.string().describe("Font family name (e.g., 'Inter')"),
      fontStyle: z.string().describe("Font style (e.g., 'Regular', 'Bold')"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_text_font", params);
        return createSuccessResponse({
          messages: [
            `Set font to ${params.fontFamily} ${params.fontStyle} for node ${params.nodeId}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_text_font" });
      }
    }
  );

  // Set Text Range Style (character-level formatting)
  server.tool(
    "set_text_range_style",
    "Apply formatting (color, font, size, decoration) to specific character ranges within a text node. Useful for highlighting keywords with different colors or making specific words bold. Use start/end indices (0-based, end is exclusive) to specify which characters to style.",
    {
      nodeId: z.string().describe("ID of the text node to modify"),
      ranges: z
        .array(
          z.object({
            start: z.number().int().min(0).describe("Start index (0-based, inclusive)"),
            end: z.number().int().min(1).describe("End index (0-based, exclusive)"),
            color: z
              .object({
                r: z.number().min(0).max(1),
                g: z.number().min(0).max(1),
                b: z.number().min(0).max(1),
                a: z.number().min(0).max(1).optional(),
              })
              .optional()
              .describe("Text color for this range in RGBA format"),
            fontFamily: z.string().optional().describe("Font family (e.g., 'Inter')"),
            fontStyle: z.string().optional().describe("Font style (e.g., 'Bold', 'Regular')"),
            fontSize: z.number().optional().describe("Font size for this range"),
            textDecoration: z
              .enum(["NONE", "UNDERLINE", "STRIKETHROUGH"])
              .optional()
              .describe("Text decoration for this range"),
          })
        )
        .describe("Array of character ranges with formatting to apply"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_text_range_style", params);
        return createSuccessResponse({
          messages: [
            `Applied formatting to ${result.rangesApplied} range(s) in text node ${params.nodeId}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_text_range_style" });
      }
    }
  );

  // Get Page Info
  server.tool(
    "get_page_info",
    "Get information about the current page/presentation",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_page_info", {});
        return createSuccessResponse({
          messages: [`Retrieved page information`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_page_info" });
      }
    }
  );

  // Get Node Info
  server.tool(
    "get_node_info",
    "Get detailed information about a specific node including its children. Returns node properties, position, size, and for text nodes includes the text content. Use depth parameter to control how deep to traverse children.",
    {
      nodeId: z.string().describe("ID of the node"),
      depth: z
        .number()
        .int()
        .min(0)
        .max(10)
        .optional()
        .describe("How many levels of children to include (default: 2, max: 10)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("get_node_info", params);
        return createSuccessResponse({
          messages: [`Retrieved information for node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_node_info" });
      }
    }
  );

  // Get Selection Info
  server.tool(
    "get_selection_info",
    "Get information about currently selected nodes",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_selection_info", {});
        return createSuccessResponse({
          messages: [`Retrieved selection information`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_selection_info" });
      }
    }
  );

  // Rename Node
  server.tool(
    "rename_node",
    "Rename a single layer/node in Figma Slides. Similar to the rename feature in Figma Design.",
    {
      nodeId: z.string().describe("ID of the node to rename"),
      name: z.string().describe("New name for the node"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("rename_node", params);
        return createSuccessResponse({
          messages: [
            `Renamed "${result.oldName}" to "${result.newName}" (${result.id})`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "rename_node" });
      }
    }
  );

  // Rename Layers (Batch)
  server.tool(
    "rename_layers",
    "Rename multiple layers at once with various patterns. Similar to the bulk rename feature in Figma Design. You can apply: 1) A fixed pattern/name to all, 2) Sequential numbering (e.g., Layer 1, Layer 2), 3) Prefix/suffix, 4) Find and replace text in names. Options can be combined.",
    {
      nodeIds: z.array(z.string()).describe("Array of node IDs to rename"),
      pattern: z
        .string()
        .optional()
        .describe(
          "Fixed name pattern to apply to all nodes (replaces entire name)"
        ),
      prefix: z
        .string()
        .optional()
        .describe("Text to add at the beginning of each name"),
      suffix: z
        .string()
        .optional()
        .describe("Text to add at the end of each name"),
      replace: z
        .object({
          from: z.string(),
          to: z.string(),
        })
        .optional()
        .describe("Find and replace text in names"),
      sequential: z
        .object({
          start: z.number().int().describe("Starting number for sequence"),
          prefix: z
            .string()
            .optional()
            .describe("Prefix for sequential names (default: 'Layer')"),
        })
        .optional()
        .describe(
          "Apply sequential numbering (e.g., Layer 1, Layer 2, or Custom 1, Custom 2)"
        ),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("rename_layers", params);
        return createSuccessResponse({
          messages: [`Renamed ${result.renamed.length} layers`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "rename_layers" });
      }
    }
  );

  // Set Layout Mode (Auto Layout)
  server.tool(
    "set_layout_mode",
    "Set the layout mode of a frame (NONE to remove auto-layout, HORIZONTAL or VERTICAL to enable)",
    {
      nodeId: z.string().describe("Frame ID"),
      layoutMode: z
        .enum(["NONE", "HORIZONTAL", "VERTICAL"])
        .describe("Layout mode: NONE (remove auto-layout), HORIZONTAL, or VERTICAL"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_layout_mode", params);
        return createSuccessResponse({
          messages: [`Set layout mode to ${params.layoutMode} for frame ${result.name}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_layout_mode" });
      }
    }
  );

  // Export Slide Image
  server.tool(
    "export_slide_image",
    "Export the current or specified slide as a PNG image",
    {
      slideId: z.string().optional().describe("Slide ID (defaults to focused slide)"),
      scale: z.number().min(0.1).max(1).optional().describe("Export scale (default 1, max 1)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("export_slide_image", params);
        return createSuccessResponse({
          messages: [`Exported slide "${result.slideName}" as image`],
          images: [{ data: result.imageData, mimeType: result.mimeType }],
          dataItem: { slideId: result.slideId, slideName: result.slideName, scale: result.scale, imageData: result.imageData, mimeType: result.mimeType },
        });
      } catch (error) {
        return createErrorResponse({ error, context: "export_slide_image" });
      }
    }
  );

  // Rotate Node
  server.tool(
    "rotate_node",
    "Rotate a node to a specific angle (in degrees). Rotates around center pivot.",
    {
      nodeId: z.string().describe("ID of the node to rotate"),
      angle: z.number().describe("Rotation angle in degrees (0 = no rotation)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("rotate_node", params);
        return createSuccessResponse({
          messages: [`Rotated node ${result.name} to ${params.angle}°`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "rotate_node" });
      }
    }
  );

  // ============ TEXT STYLES ============

  // Get Local Text Styles
  server.tool(
    "get_local_text_styles",
    "Get all local text styles defined in the current Figma file. Returns style names, IDs, font properties, and other text style settings. Use this to discover available text styles before applying them to text nodes.",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_local_text_styles", {});
        return createSuccessResponse({
          messages: [`Found ${result.totalStyles} local text style(s)`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_local_text_styles" });
      }
    }
  );

  // Set Text Style (apply to node)
  server.tool(
    "set_text_style",
    "Apply a text style to a text node by style ID. Use get_local_text_styles to discover available styles first.",
    {
      nodeId: z.string().describe("ID of the text node to apply the style to"),
      textStyleId: z.string().describe("ID of the text style to apply"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_text_style", params);
        return createSuccessResponse({
          messages: [`Applied text style ${result.textStyleId} to node ${params.nodeId}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_text_style" });
      }
    }
  );

  // Get Text Style (read from node)
  server.tool(
    "get_text_style",
    "Get the text style currently applied to a text node. Returns the style ID and font properties.",
    {
      nodeId: z.string().describe("ID of the text node to check"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("get_text_style", params);
        return createSuccessResponse({
          messages: [
            result.textStyleId
              ? `Text style ${result.textStyleId} is applied to node ${params.nodeId}`
              : `No text style applied to node ${params.nodeId}`,
          ],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_text_style" });
      }
    }
  );

  // Replace Color
  server.tool(
    "replace_color",
    "Replace all occurrences of a specific fill color with a new color within a node and all its children. Useful for batch color changes across multiple elements in a slide or frame.",
    {
      nodeId: z.string().describe("ID of the parent node to search within (e.g., slide ID)"),
      oldColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
      }).describe("Color to find and replace (RGB values 0-1)"),
      newColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
      }).describe("New color to replace with (RGB values 0-1)"),
      tolerance: z.number().min(0).max(0.5).optional().describe("Color matching tolerance (default: 0.02)"),
      includeStrokes: z.boolean().optional().describe("Also replace stroke colors (default: true)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("replace_color", params);
        return createSuccessResponse({
          messages: [`Replaced ${result.replacedCount} color instances in "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "replace_color" });
      }
    }
  );

  // ============ CANVAS-PORTED TOOLS ============

  // Create Polygon
  server.tool(
    "create_polygon",
    "Create a polygon shape with configurable number of sides and styling",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      width: z.number().describe("Width of the polygon"),
      height: z.number().describe("Height of the polygon"),
      pointCount: z.number().int().min(3).describe("Number of sides (≥3)"),
      name: z.string().optional().describe("Name for the polygon"),
      parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
      fillColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).optional().describe("Fill color in RGBA format"),
      strokeColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).optional().describe("Stroke color in RGBA format"),
      strokeWeight: z.number().min(0).optional().describe("Stroke weight in pixels"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_polygon", params);
        return createSuccessResponse({
          messages: [`Created polygon "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_polygon" });
      }
    }
  );

  // Create Star
  server.tool(
    "create_star",
    "Create a star shape with customizable points, inner radius, and styling",
    {
      x: z.number().describe("X coordinate"),
      y: z.number().describe("Y coordinate"),
      width: z.number().describe("Width of the star"),
      height: z.number().describe("Height of the star"),
      pointCount: z.number().int().min(3).max(60).describe("Number of star points"),
      innerRadius: z.number().min(0).max(100).optional().describe("Inner radius as % of diameter (default: 50)"),
      name: z.string().optional().describe("Name for the star"),
      parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
      fillColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).optional().describe("Fill color in RGBA format"),
      strokeColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).optional().describe("Stroke color in RGBA format"),
      strokeWeight: z.number().min(0).optional().describe("Stroke weight in pixels"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_star", params);
        return createSuccessResponse({
          messages: [`Created star "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_star" });
      }
    }
  );

  // Create Line
  server.tool(
    "create_line",
    "Create a line between two points with customizable stroke styling and end caps",
    {
      startX: z.number().describe("Start point X coordinate"),
      startY: z.number().describe("Start point Y coordinate"),
      endX: z.number().describe("End point X coordinate"),
      endY: z.number().describe("End point Y coordinate"),
      name: z.string().optional().describe("Name for the line"),
      parentId: z.string().optional().describe("Parent node ID (defaults to current slide)"),
      strokeColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).optional().describe("Stroke color in RGBA format"),
      strokeWeight: z.number().min(0).optional().describe("Stroke weight in pixels"),
      strokeCap: z.enum(["NONE", "ROUND", "SQUARE"]).optional().describe("Line-end cap style"),
      dashPattern: z.array(z.number().min(0)).length(2).optional().describe("[dash, gap] in px for dashed lines"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_line", params);
        return createSuccessResponse({
          messages: [`Created line "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_line" });
      }
    }
  );

  // Create Mask
  server.tool(
    "create_mask",
    "Create a mask group by combining a mask node with content nodes to apply clipping effects",
    {
      maskNodeId: z.string().describe("Node ID to use as the mask shape"),
      contentNodeIds: z.array(z.string()).min(1).describe("IDs of nodes to be masked"),
      groupName: z.string().optional().describe("Name for the mask group"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("create_mask", params);
        return createSuccessResponse({
          messages: [`Created mask group "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "create_mask" });
      }
    }
  );

  // Get Node Info By Types
  server.tool(
    "get_node_info_by_types",
    "Get information about all nodes with specific types (e.g., FRAME, TEXT, RECTANGLE) within a given parent node",
    {
      nodeId: z.string().describe("ID of the parent node to scan"),
      types: z.array(z.string()).describe("Array of node types to search for (e.g., ['FRAME', 'TEXT'])"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("get_node_info_by_types", params);
        return createSuccessResponse({
          messages: [`Found ${result.count} matching nodes of types [${result.searchedTypes.join(", ")}]`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_node_info_by_types" });
      }
    }
  );

  // Get Result Image
  server.tool(
    "get_result_image",
    "Export and retrieve a visual image of the current page design",
    {
      pageId: z.string().optional().describe("Page ID (defaults to current page)"),
      scale: z.number().min(0.1).optional().describe("Export scale (default: 1)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("get_result_image", {
          pageId: params.pageId,
          scale: params.scale || 1,
        });
        return createSuccessResponse({
          messages: [`Exported page ${params.pageId || "current"} as image`],
          images: [{ data: result.imageData, mimeType: result.mimeType ?? "image/png" }],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_result_image" });
      }
    }
  );

  // Get Page Structure
  server.tool(
    "get_page_structure",
    "Get a hierarchical tree structure of all elements on the current page with their names, IDs, types, and positions",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_page_structure", {});
        return createSuccessResponse({
          messages: [`Retrieved page structure for "${result.pageName}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_page_structure" });
      }
    }
  );

  // Reorder Node
  server.tool(
    "reorder_node",
    "Change the stacking order (z-index) of an element within its parent. Control which elements appear in front or behind others.",
    {
      nodeId: z.string().describe("ID of the node to reorder"),
      direction: z.enum(["TOP", "BOTTOM", "FORWARD", "BACKWARD"]).describe("Movement direction: TOP (bring to front), BOTTOM (send to back), FORWARD (one layer up), BACKWARD (one layer down)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("reorder_node", params);
        return createSuccessResponse({
          messages: [`Moved "${result.name}" from index ${result.oldIndex} to ${result.newIndex}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "reorder_node" });
      }
    }
  );

  // Boolean Nodes
  server.tool(
    "boolean_nodes",
    "Combine two or more shapes using boolean operations: UNION (merge), SUBTRACT (cut out), INTERSECT (overlap area), EXCLUDE (non-overlap area)",
    {
      nodeIds: z.array(z.string()).min(2).describe("Node IDs to combine (≥2)"),
      operation: z.enum(["UNION", "SUBTRACT", "INTERSECT", "EXCLUDE"]).describe("Boolean operation to apply"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("boolean_nodes", params);
        return createSuccessResponse({
          messages: [`Combined ${result.containedIds.length} nodes into ${result.operation} "${result.name}" (${result.id})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "boolean_nodes" });
      }
    }
  );

  // Get Styles
  server.tool(
    "get_styles",
    "Retrieve all available text styles, color styles, and effect styles from the current Figma document",
    {},
    async () => {
      try {
        const result = await sendCommandToFigma("get_styles", {});
        return createSuccessResponse({
          messages: [`Retrieved styles from document`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "get_styles" });
      }
    }
  );

  // Set Fill Gradient
  server.tool(
    "set_fill_gradient",
    "Apply a gradient fill to a node. Supports linear, radial, angular, and diamond gradients with customizable color stops.",
    {
      nodeId: z.string().describe("ID of the node to modify"),
      gradientStops: z.array(z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
        position: z.number().min(0).max(1).describe("Stop position (0-1)"),
      })).min(2).describe("Gradient color stops (≥2)"),
      gradientType: z.enum(["GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND"]).optional().describe("Gradient type (default: GRADIENT_LINEAR)"),
      angle: z.number().min(0).max(360).optional().describe("Angle for linear gradients (degrees)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_fill_gradient", params);
        return createSuccessResponse({
          messages: [`Applied ${params.gradientType || "linear"} gradient to "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_fill_gradient" });
      }
    }
  );

  // Set Drop Shadow
  server.tool(
    "set_drop_shadow",
    "Add a drop shadow effect to a node for depth and elevation",
    {
      nodeId: z.string().describe("ID of the node to modify"),
      shadowColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).describe("Shadow color (RGBA)"),
      offsetX: z.number().describe("Horizontal shadow offset (px)"),
      offsetY: z.number().describe("Vertical shadow offset (px)"),
      radius: z.number().min(0).describe("Blur radius (px)"),
      spread: z.number().min(0).optional().describe("Spread radius (px)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_drop_shadow", params);
        return createSuccessResponse({
          messages: [`Applied drop shadow to "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_drop_shadow" });
      }
    }
  );

  // Set Inner Shadow
  server.tool(
    "set_inner_shadow",
    "Add an inner shadow effect inside a node's boundaries",
    {
      nodeId: z.string().describe("ID of the node to modify"),
      shadowColor: z.object({
        r: z.number().min(0).max(1),
        g: z.number().min(0).max(1),
        b: z.number().min(0).max(1),
        a: z.number().min(0).max(1).optional(),
      }).describe("Shadow color (RGBA)"),
      offsetX: z.number().describe("Horizontal shadow offset (px)"),
      offsetY: z.number().describe("Vertical shadow offset (px)"),
      radius: z.number().min(0).describe("Blur radius (px)"),
      spread: z.number().min(0).optional().describe("Spread radius (px)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_inner_shadow", params);
        return createSuccessResponse({
          messages: [`Applied inner shadow to "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_inner_shadow" });
      }
    }
  );

  // Copy Style
  server.tool(
    "copy_style",
    "Copy visual styling properties (fills, strokes, effects, corner radius, opacity) from one node to another",
    {
      sourceNodeId: z.string().describe("Node ID to copy style from"),
      targetNodeId: z.string().describe("Node ID to apply style to"),
      properties: z.array(z.enum(["fills", "strokes", "effects", "cornerRadius", "opacity"])).optional().describe("Style properties to copy (default: all)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("copy_style", params);
        return createSuccessResponse({
          messages: [`Copied style from "${result.sourceName}" to "${result.targetName}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "copy_style" });
      }
    }
  );

  // Set Blend Mode
  server.tool(
    "set_blend_mode",
    "Change how a node blends with layers beneath it",
    {
      nodeId: z.string().describe("ID of the node to modify"),
      blendMode: z.enum([
        "PASS_THROUGH", "NORMAL", "DARKEN", "MULTIPLY", "LINEAR_BURN", "COLOR_BURN",
        "LIGHTEN", "SCREEN", "LINEAR_DODGE", "COLOR_DODGE", "OVERLAY", "SOFT_LIGHT",
        "HARD_LIGHT", "DIFFERENCE", "EXCLUSION", "HUE", "SATURATION", "COLOR", "LUMINOSITY",
      ]).describe("Target blend mode"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_blend_mode", params);
        return createSuccessResponse({
          messages: [`Set blend mode of "${result.name}" to ${params.blendMode}`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_blend_mode" });
      }
    }
  );

  // Set Padding
  server.tool(
    "set_padding",
    "Set internal spacing (padding) for auto-layout frames",
    {
      nodeId: z.string().describe("Frame ID"),
      paddingTop: z.number().optional().describe("Top padding"),
      paddingRight: z.number().optional().describe("Right padding"),
      paddingBottom: z.number().optional().describe("Bottom padding"),
      paddingLeft: z.number().optional().describe("Left padding"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_padding", params);
        return createSuccessResponse({
          messages: [`Set padding for frame "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_padding" });
      }
    }
  );

  // Set Axis Align
  server.tool(
    "set_axis_align",
    "Configure child element alignment along primary and counter axes in auto-layout frames",
    {
      nodeId: z.string().describe("Frame ID"),
      primaryAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "SPACE_BETWEEN"]).optional().describe("Primary axis alignment"),
      counterAxisAlignItems: z.enum(["MIN", "MAX", "CENTER", "BASELINE"]).optional().describe("Counter axis alignment"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_axis_align", params);
        return createSuccessResponse({
          messages: [`Set axis alignment for frame "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_axis_align" });
      }
    }
  );

  // Set Layout Sizing
  server.tool(
    "set_layout_sizing",
    "Control how any node resizes in auto-layout (FIXED, HUG content, or FILL parent). Works on frames, rectangles, text, and other node types.",
    {
      nodeId: z.string().describe("Node ID (any type: FRAME, RECTANGLE, TEXT, etc.)"),
      layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Horizontal sizing mode"),
      layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional().describe("Vertical sizing mode"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_layout_sizing", params);
        return createSuccessResponse({
          messages: [`Set layout sizing for frame "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_layout_sizing" });
      }
    }
  );

  // Set Item Spacing
  server.tool(
    "set_item_spacing",
    "Define the gap distance between child elements in auto-layout frames",
    {
      nodeId: z.string().describe("Frame ID"),
      itemSpacing: z.number().describe("Distance between children in px"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_item_spacing", params);
        return createSuccessResponse({
          messages: [`Set item spacing to ${params.itemSpacing} for frame "${result.name}"`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_item_spacing" });
      }
    }
  );

  // Set Child Layout Properties (layoutGrow, layoutAlign, layoutPositioning)
  server.tool(
    "set_child_layout_props",
    "Set layout properties on a child node within an auto-layout frame. Use layoutPositioning='ABSOLUTE' to ignore auto-layout (enabling constraints), layoutGrow=1 to fill available space, layoutAlign to control cross-axis alignment.",
    {
      nodeId: z.string().describe("Child node ID"),
      layoutGrow: z.number().optional().describe("0 = fixed size, 1 = fill available space"),
      layoutAlign: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"]).optional().describe("Cross-axis alignment"),
      layoutPositioning: z.enum(["AUTO", "ABSOLUTE"]).optional().describe("AUTO = participate in auto-layout, ABSOLUTE = ignore auto-layout (enables constraints)"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_child_layout_props", params);
        return createSuccessResponse({
          messages: [`Set child layout props for "${result.name}" (${result.type})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_child_layout_props" });
      }
    }
  );

  // Set Constraints
  server.tool(
    "set_constraints",
    "Set resize constraints (horizontal/vertical) on a node. Controls how the node resizes when its parent is resized. Only works on nodes NOT inside auto-layout frames.",
    {
      nodeId: z.string().describe("Node ID"),
      horizontal: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]).optional().describe("Horizontal constraint"),
      vertical: z.enum(["MIN", "CENTER", "MAX", "STRETCH", "SCALE"]).optional().describe("Vertical constraint"),
    },
    async (params) => {
      try {
        const result = await sendCommandToFigma("set_constraints", params);
        return createSuccessResponse({
          messages: [`Set constraints for "${result.name}" (${result.type})`],
          dataItem: result,
        });
      } catch (error) {
        return createErrorResponse({ error, context: "set_constraints" });
      }
    }
  );

  // export_json and import_json are registered in importExportTools.ts
}

