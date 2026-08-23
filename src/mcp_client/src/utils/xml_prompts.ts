/**
 * XML Ablation: OOXML-specific prompt builders
 *
 * Replaces the SceneGraph JSON context instructions with OOXML XML context
 * instructions for the ablation study. The key differences:
 * - Flat <p:spTree> structure instead of hierarchical node tree
 * - Absolute EMU coordinates instead of parent-relative pixels
 * - Integer <p:cNvPr id> element IDs instead of Figma "1:23" format
 * - XML code blocks instead of JSON
 */

import { AGENT_MODE } from "./batch_toggle";

// ---------------------------------------------------------------------------
// Mode-aware prompt fragments. Three variants per fragment:
//   AGENT_MODE === "batch"      → encourage batch_execute (default)
//   AGENT_MODE === "parallel"   → encourage parallel function calling
//   AGENT_MODE === "sequential" → one tool call per turn (stop-and-wait)
// ---------------------------------------------------------------------------

const MODIFY_EXISTING_NODE_GUIDANCE = (
  AGENT_MODE === "batch"      ? "use batch_execute with nodeId directly" :
  AGENT_MODE === "parallel"   ? "call set_*/move_node/resize_node tools directly with the nodeId" :
  /* sequential */              "call set_*/move_node/resize_node tools one at a time with the nodeId"
);

const PRINCIPLE_4 = (
  AGENT_MODE === "batch" ? `
4. Use batch_execute aggressively — it supports ALL commands
batch_execute works with EVERY tool command: creation (create_frame, create_text, create_rectangle, etc.), modification (set_text_font, set_fill_color, move_node, resize_node, etc.), and layout (set_layout_mode, set_padding, set_item_spacing, etc.).
ALWAYS prefer ONE batch_execute call over multiple individual tool calls. Each individual tool call costs a full API round-trip.
CRITICAL: If you need to create or modify 3+ elements, ALWAYS use batch_execute — never call create_* or set_* individually in separate tool calls.
Example — creating multiple elements + setting properties in one call:
  batch_execute({ operations: [
    { command: "create_frame", params: { x: 0, y: 0, width: 400, height: 40, name: "Row 1", parentId: "1:10" } },
    { command: "create_text", params: { x: 10, y: 5, width: 380, text: "Hello", fontSize: 16, parentId: "1:10" } },
    { command: "set_text_font", params: { nodeId: "1:23", fontFamily: "Inter", fontStyle: "Bold" } },
    { command: "set_fill_color", params: { nodeId: "1:67", color: "#FF0000" } }
  ] })
` :
  AGENT_MODE === "parallel" ? `
4. Emit every needed tool call in parallel within a single response
The API supports parallel function calling: a single assistant response can contain many tool calls that execute concurrently. ALWAYS emit ALL the tool calls required to satisfy the instruction in ONE response — do NOT make them one at a time across multiple turns. Each modification tool (set_text_font, set_fill_color, move_node, resize_node, create_*, etc.) accepts nodeId or parentId and can be invoked independently, so there are no dependencies that force serialization for existing-node edits.
CRITICAL: If you need to create or modify 3+ elements, ALWAYS emit them as parallel tool calls in the same response. Multiple turns must only happen when later calls depend on outputs of earlier calls (e.g. create_slide must finish before its children can reference its id).
Example — emit these as parallel tool calls in ONE response:
  create_frame({ x: 0, y: 0, width: 400, height: 40, name: "Row 1", parentId: "1:10" })
  create_text({ x: 10, y: 5, width: 380, text: "Hello", fontSize: 16, parentId: "1:10" })
  set_text_font({ nodeId: "1:23", fontFamily: "Inter", fontStyle: "Bold" })
  set_fill_color({ nodeId: "1:67", color: "#FF0000" })
` :
  /* sequential */ `
4. Emit exactly ONE tool call per response — stop and wait for its result
Each assistant response must contain a SINGLE tool call. Wait for the tool result to come back before deciding the next action. Do NOT emit multiple tool calls in one response. This is the traditional stop-and-wait agent loop: plan → call one tool → observe result → plan again → call next tool, and so on, until the instruction is fully satisfied.
CRITICAL: Even if you need to modify many elements, emit them one tool call at a time across many turns. Never collect multiple operations into a single response.
Example — one call per turn, repeat across turns:
  turn 1 response: create_frame({ x: 0, y: 0, width: 400, height: 40, name: "Row 1", parentId: "1:10" })
  (observe result)
  turn 2 response: create_text({ x: 10, y: 5, width: 380, text: "Hello", fontSize: 16, parentId: "1:10" })
  (observe result)
  turn 3 response: set_text_font({ nodeId: "1:23", fontFamily: "Inter", fontStyle: "Bold" })
  (observe result)
  turn 4 response: set_fill_color({ nodeId: "1:67", color: "#FF0000" })
  ... continue one call at a time until done ...
`
);

const PRINCIPLE_7 = (
  AGENT_MODE === "batch" ? `
7. Minimize API round-trips
- Collect ALL changes across ALL slides into a SINGLE batch_execute call when possible, rather than processing slides one-by-one.
- Do NOT alternate focus_slide → batch_execute per slide. Instead, gather every modification and execute in one batch.
- focus_slide is only needed before creating new nodes. For existing node modifications, batch_execute with nodeId works directly.
` :
  AGENT_MODE === "parallel" ? `
7. Minimize API round-trips via parallel tool calls
- Collect every change required across every slide before emitting any tool call, then issue them as parallel tool calls in a SINGLE response — do NOT spread independent edits across multiple turns.
- A new turn is only justified when later calls depend on outputs of earlier calls (e.g. waiting for a create_slide id). Independent set_*/move_node/resize_node calls have no such dependency and must be emitted together.
- focus_slide is only needed before creating new nodes. For existing node modifications, set_*/move_node/resize_node accept nodeId directly.
` :
  /* sequential */ `
7. Single-call-per-turn loop
- Each response contains exactly one tool call. After the tool result arrives, decide the next single tool call.
- Do NOT attempt to batch, parallelize, or pre-collect operations into a single response.
- focus_slide is only needed before creating new nodes. For existing node modifications, set_*/move_node/resize_node accept nodeId directly.
- Track progress mentally so you don't lose count of which edits remain. When all required edits are done, respond with no tool call to end the turn.
`
);

const PRINCIPLE_8 = (
  AGENT_MODE === "batch" ? `
8. Handle node ID staleness
- After deleting a slide or node, ALL child node IDs within it become invalid immediately.
- NEVER batch a delete_slide together with operations that reference nodes on other slides.
- NEVER batch a create_slide together with its child element operations (create_text, create_rectangle, etc.) in the same batch_execute — the new slide's ID is unknown until create_slide returns.
- CRITICAL — create_slide is NEVER the final step. After creating slides, you MUST ALWAYS follow up with batch_execute to populate them with content (backgrounds, text, shapes, etc.). A blank slide is never acceptable.
- CRITICAL — parentId after create_slide: When adding elements to a newly created slide, you MUST include parentId (the new slide's ID) in every create_* params. Without parentId, elements are placed on the previously focused slide, NOT on the new one. Required workflow:
  Step 1: create_slide({ column: 3, name: "Divider" })  → returns { id: "11:100" }
  Step 2 (MANDATORY): batch_execute({ operations: [
    { command: "create_rectangle", params: { x: 0, y: 0, width: 1920, height: 1080, fillColor: { r: 0, g: 0.2, b: 0.063 }, parentId: "11:100" } },
    { command: "create_text", params: { x: 100, y: 200, text: "Thank You", fontSize: 71, fontColor: { r: 0.78, g: 0.94, b: 0.31 }, parentId: "11:100" } }
  ] })
  NEVER stop after Step 1 — Step 2 is required to make the slide functional.
` :
  AGENT_MODE === "parallel" ? `
8. Handle node ID staleness
- After deleting a slide or node, ALL child node IDs within it become invalid immediately.
- After create_slide returns, capture the new slide's id and pass it as parentId in every subsequent create_* call that should populate that slide. Without parentId, elements are placed on the previously focused slide, NOT on the new one.
- create_slide must be its own turn because its new id is unknown until it returns. Do NOT emit a create_slide together with its children in the same parallel response — those children would not have the right parentId yet.
- CRITICAL — create_slide is NEVER the final step. After create_slide returns, you MUST follow up with parallel create_* calls (all in ONE response) to populate the new slide with content (backgrounds, text, shapes, etc.). A blank slide is never acceptable.
- Required workflow:
  Step 1 (own turn): create_slide({ column: 3, name: "Divider" })  → returns { id: "11:100" }
  Step 2 (single response, parallel calls):
    create_rectangle({ x: 0, y: 0, width: 1920, height: 1080, fillColor: { r: 0, g: 0.2, b: 0.063 }, parentId: "11:100" })
    create_text({ x: 100, y: 200, text: "Thank You", fontSize: 71, fontColor: { r: 0.78, g: 0.94, b: 0.31 }, parentId: "11:100" })
  NEVER stop after Step 1 — Step 2 is required to make the slide functional.
` :
  /* sequential */ `
8. Handle node ID staleness
- After deleting a slide or node, ALL child node IDs within it become invalid immediately.
- After create_slide returns, capture the new slide's id from the tool result and use it as parentId in subsequent create_* calls.
- CRITICAL — create_slide is NEVER the final step. After create_slide returns, you MUST follow up with create_* calls (one per turn) to populate the new slide with content (backgrounds, text, shapes, etc.). A blank slide is never acceptable.
- Required workflow (each line is its own turn):
  Turn N:   create_slide({ column: 3, name: "Divider" })  → returns { id: "11:100" }
  Turn N+1: create_rectangle({ x: 0, y: 0, width: 1920, height: 1080, fillColor: { r: 0, g: 0.2, b: 0.063 }, parentId: "11:100" })
  Turn N+2: create_text({ x: 100, y: 200, text: "Thank You", fontSize: 71, fontColor: { r: 0.78, g: 0.94, b: 0.31 }, parentId: "11:100" })
  ... continue one call per turn ...
`
);

// Re-use the single-shot principles from the main prompts module.
// These are the same tool-use guidelines regardless of context format.
const singleShotPrinciples = `
Your task is to produce an array of tool (function) calls necessary to modify the presentation in one turn.
Include every necessary tool (function) calls and do not output any text other than the function calls themselves.

1. Plan first
Briefly outline the key steps you will take.
2. Be exhaustive
Consider all parameters, options, ordering, and dependencies necessary to make the modification in one turn.
3. Preserve existing content
Do NOT delete or recreate elements that should remain unchanged. Only modify what the instruction asks for.
${PRINCIPLE_4}
5. Text layout quality
- ALWAYS set an explicit **width** on text nodes to prevent text overflow and overlap with adjacent elements.
- Predict the bounding box of every element BEFORE placing it. For text nodes, rendered height ≈ ceil(text_length_px / width) × fontSize × 1.3 (line-height). Use the predicted bounding box (x, y, width, rendered_height) to ensure NO overlap with any neighboring element in all directions — check that bounding boxes do not intersect horizontally or vertically.
- For multi-column layouts, calculate column width = (available width) / num_columns.
6. Avoid redundant discovery
- NEVER call check_connection_status — the connection is already established.
- NEVER call export_json or get_page_structure — the document structure is already provided.
- Do NOT call get_all_slides if slide IDs are already provided in the context.
- After completing modifications, do NOT make extra verification calls.
${PRINCIPLE_7}${PRINCIPLE_8}9. Deliver
Based on the plan, respond with the exact sequence of tool (function) calls it should run.
`;

const xmlSlidesInstruction = `
1. Presentation Format
- You are working with a presentation described in PresentationML (OOXML) XML format.
- The XML uses a FLAT structure: all shapes (<p:sp>) are direct children of <p:spTree>, regardless of visual grouping.
- Each slide is a <p:sld> element containing a <p:cSld> with a <p:spTree>.
- Slides are 1920×1080 pixels (18288000×10287000 EMU).

2. Element Identification
- Each element has an integer ID in <p:cNvPr id="N" name="...">.
- Use these integer IDs directly for all tool calls (nodeId, parentId, slideId).
- Example: if <p:cNvPr id="5" name="Title"/>, use nodeId: "5" in tool calls.

3. Coordinate System — EMU (English Metric Units)
- All positions and sizes in the XML use EMU: 1 pixel = 9525 EMU.
- <a:off x="..." y="..."/> gives ABSOLUTE position from slide top-left (0, 0).
- <a:ext cx="..." cy="..."/> gives element width and height.
- When calling move_node or create_* tools, provide coordinates in EMU.
- When calling resize_node, provide width/height in EMU.
- Common conversions: 100px = 952500 EMU, 1920px = 18288000 EMU, 1080px = 10287000 EMU.

4. Text Elements
- Text is in <p:txBody> → <a:p> → <a:r> → <a:t>.
- Font info is in <a:rPr>: sz (hundredths of a point), b (bold), i (italic).
- Font family is in <a:latin typeface="...">.
- Text color is in <a:solidFill> → <a:srgbClr val="RRGGBB">.

5. Shape Fills and Strokes
- Fill color: <a:solidFill> → <a:srgbClr val="RRGGBB"/> inside <p:spPr>.
- Stroke: <a:ln w="EMU"> → <a:solidFill> → <a:srgbClr>.
- Geometry: <a:prstGeom prst="rect|ellipse|...">.

6. Slide Management
- focus_slide navigates the viewport. Required before creating new nodes.
- For modifying existing nodes, ${MODIFY_EXISTING_NODE_GUIDANCE}.
- Each slide's ID is the integer from its <p:cNvPr> in <p:nvGrpSpPr>.

7. Deck theme consistency (new slides and new blocks only)
- When adding a new slide or major new content block, match the deck's existing styling. Read background and text colors from <a:srgbClr val="RRGGBB"/> on comparable slides (cover, section divider, Q&A/closing, table-of-contents, adjacent content).
- Do NOT default to white (#FFFFFF) background + black (#000000) text unless a comparable existing slide uses exactly that pattern.
- Copy font family, size, and color from reference slides via create_* fillColor/fontColor or set_fill_color/set_text_font.
- For chart/theme recolor tasks: use replace_color with exact source/target hex from the instruction; recolor only chart/data series elements.
- Do NOT restyle existing slides or nodes unless the instruction explicitly asks for it.
`;

// ---------------------------------------------------------------------------
// Prompt builder
// ---------------------------------------------------------------------------

/** Build a prompt for XML ablation mode. */
export function getXmlModePrompt(
  instruction: string,
  xmlContext: string,
  slideCount: number
): string {
  return `
**Context**
You are a presentation-design agent with access to Figma Slides via tool calls.
Follow the **Instruction** to modify the presentation.
Refer to the **Tool Use Principles** and **PresentationML Basics** for guidance.

**Tool Use Principles**
${singleShotPrinciples}

**PresentationML Basics**
${xmlSlidesInstruction}

**Current Presentation State (PresentationML XML)**
The presentation has ${slideCount} slide(s).
\`\`\`xml
${xmlContext}
\`\`\`

**Instruction**
${instruction}
`;
}
