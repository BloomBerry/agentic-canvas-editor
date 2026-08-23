"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MappedTools = void 0;
exports.scenegraphToXml = scenegraphToXml;
const helpers_1 = require("./helpers");
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const EMU_PER_PX = 9525;
const PX_TO_EMU = 9525;
const DEFAULT_SLIDE_W = 1920;
const DEFAULT_SLIDE_H = 1080;
/**
 * Threshold to distinguish EMU values from pixel values.
 * 1 pixel = 9525 EMU, so any value below 9500 is almost certainly already in pixels.
 * Any value above is almost certainly in EMU and needs conversion.
 */
const EMU_PIXEL_THRESHOLD = 9500;
// Commands whose x/y parameters are coordinates (need EMU→px + abs→relative)
const COORDINATE_COMMANDS = new Set([
    "move_node",
    "create_text",
    "create_rectangle",
    "create_ellipse",
    "create_frame",
    "create_graphic",
    "create_polygon",
    "create_line",
    "create_star",
    "create_math",
    "create_marker",
    "create_table",
    "create_table_from_data",
    "create_bar_chart",
    "create_line_chart",
    "create_pie_chart",
    "create_donut_chart",
    "create_data_chart",
    "create_smartart",
    "insert_image",
]);
// Commands whose width/height parameters need EMU→px conversion
const DIMENSION_COMMANDS = new Set([
    "resize_node",
    "create_text",
    "create_rectangle",
    "create_ellipse",
    "create_frame",
    "create_graphic",
    "create_polygon",
    "create_line",
    "create_star",
    "create_math",
    "create_marker",
    "create_table",
    "create_table_from_data",
    "create_bar_chart",
    "create_line_chart",
    "create_data_chart",
    "create_smartart",
    "insert_image",
]);
// ---------------------------------------------------------------------------
// MappedTools
// ---------------------------------------------------------------------------
/**
 * Wraps a real Tools instance to intercept tool calls and:
 * 1. Remap XML element IDs (integers) to Figma node IDs ("1:23")
 * 2. Convert EMU coordinates to pixel coordinates
 * 3. Convert absolute positions to parent-relative positions
 */
class MappedTools {
    /** Expose the catalogue so the agent can see the same tool list. */
    get catalogue() {
        return this.realTools.catalogue;
    }
    constructor(realTools, mapping) {
        this.realTools = realTools;
        this.mapping = mapping;
        this.reverseMap = MappedTools.buildReverseMap(mapping);
        this.nextXmlId = MappedTools.computeNextId(mapping);
    }
    /** Replace the mapping (used on Turn 2+ context refresh). */
    updateMapping(newMapping) {
        this.mapping = newMapping;
        this.reverseMap = MappedTools.buildReverseMap(newMapping);
        this.nextXmlId = MappedTools.computeNextId(newMapping);
    }
    /** Get the current mapping (for stable ID reuse on Turn 2+ re-export). */
    getMapping() {
        return this.mapping;
    }
    /** Proxy createToolCall to the real Tools. */
    createToolCall(toolName, id, args, callId) {
        return this.realTools.createToolCall(toolName, id, args, callId);
    }
    /** Intercept, remap, then delegate to real Tools.
     *  After execution, reverse-map Figma IDs in the result so the LLM
     *  only ever sees XML integer IDs.
     *  Pass timeoutMs through unchanged — the underlying Tools.callTool will
     *  apply per-tool defaults (e.g. 30 min for import_json) when undefined. */
    async callTool(toolCall, timeoutMs) {
        const remapped = this.remapToolCall(toolCall);
        const result = await this.realTools.callTool(remapped, timeoutMs);
        return this.reverseMapResult(result);
    }
    // ── Private remapping logic ──
    remapToolCall(toolCall) {
        const args = JSON.parse(JSON.stringify(toolCall.arguments ?? {}));
        if (toolCall.name === "batch_execute" && Array.isArray(args.operations)) {
            args.operations = args.operations.map((op) => this.remapOperation(op));
        }
        else {
            this.remapArgs(toolCall.name, args);
        }
        return { ...toolCall, arguments: args };
    }
    remapOperation(op) {
        // Handle both formats:
        //   { command, params: { nodeId, x, ... } }   ← params-wrapped (expected)
        //   { command, nodeId, x, ... }                ← flat (GPT sometimes does this)
        let params;
        if (op.params && typeof op.params === "object") {
            params = { ...op.params };
        }
        else {
            // Extract all keys except "command" as params
            const { command, ...rest } = op;
            params = { ...rest };
        }
        this.remapArgs(op.command, params);
        return { command: op.command, params };
    }
    remapArgs(command, args) {
        // Remap nodeId
        if (args.nodeId !== undefined) {
            const key = String(args.nodeId);
            const entry = this.mapping[key];
            if (entry) {
                args.nodeId = entry.figmaId;
                // Coordinate conversion for move_node: EMU abs → px parent-relative
                // Skip conversion if values are already in pixels (below threshold)
                if (command === "move_node") {
                    const isEmuX = args.x !== undefined && Math.abs(args.x) >= EMU_PIXEL_THRESHOLD;
                    const isEmuY = args.y !== undefined && Math.abs(args.y) >= EMU_PIXEL_THRESHOLD;
                    if (args.x !== undefined) {
                        const xPx = isEmuX ? args.x / EMU_PER_PX : args.x;
                        args.x = Math.round(xPx - entry.parentAbsX);
                    }
                    if (args.y !== undefined) {
                        const yPx = isEmuY ? args.y / EMU_PER_PX : args.y;
                        args.y = Math.round(yPx - entry.parentAbsY);
                    }
                }
                // Dimension conversion for resize_node: EMU → px
                // Skip conversion if values are already in pixels (below threshold)
                if (command === "resize_node") {
                    if (args.width !== undefined) {
                        args.width = args.width >= EMU_PIXEL_THRESHOLD
                            ? Math.round(args.width / EMU_PER_PX)
                            : Math.round(args.width);
                    }
                    if (args.height !== undefined) {
                        args.height = args.height >= EMU_PIXEL_THRESHOLD
                            ? Math.round(args.height / EMU_PER_PX)
                            : Math.round(args.height);
                    }
                }
            }
            else if (command === "move_node") {
                // Unmapped nodeId: just EMU → px (no parent-relative offset)
                if (args.x !== undefined) {
                    args.x = Math.abs(args.x) >= EMU_PIXEL_THRESHOLD
                        ? Math.round(args.x / EMU_PER_PX)
                        : Math.round(args.x);
                }
                if (args.y !== undefined) {
                    args.y = Math.abs(args.y) >= EMU_PIXEL_THRESHOLD
                        ? Math.round(args.y / EMU_PER_PX)
                        : Math.round(args.y);
                }
            }
            else if (command === "resize_node") {
                // Unmapped nodeId: just EMU → px
                if (args.width !== undefined) {
                    args.width = args.width >= EMU_PIXEL_THRESHOLD
                        ? Math.round(args.width / EMU_PER_PX)
                        : Math.round(args.width);
                }
                if (args.height !== undefined) {
                    args.height = args.height >= EMU_PIXEL_THRESHOLD
                        ? Math.round(args.height / EMU_PER_PX)
                        : Math.round(args.height);
                }
            }
        }
        // Remap parentId (for create_* commands)
        if (args.parentId !== undefined) {
            const key = String(args.parentId);
            const entry = this.mapping[key];
            if (entry) {
                args.parentId = entry.figmaId;
            }
        }
        // Coordinate conversion for create_* commands (move_node handled above)
        // Skip conversion if values are already in pixels (below threshold)
        if (COORDINATE_COMMANDS.has(command) && command !== "move_node") {
            if (args.x !== undefined) {
                args.x = Math.abs(args.x) >= EMU_PIXEL_THRESHOLD
                    ? Math.round(args.x / EMU_PER_PX)
                    : Math.round(args.x);
            }
            if (args.y !== undefined) {
                args.y = Math.abs(args.y) >= EMU_PIXEL_THRESHOLD
                    ? Math.round(args.y / EMU_PER_PX)
                    : Math.round(args.y);
            }
        }
        if (DIMENSION_COMMANDS.has(command) && command !== "resize_node") {
            if (args.width !== undefined) {
                args.width = args.width >= EMU_PIXEL_THRESHOLD
                    ? Math.round(args.width / EMU_PER_PX)
                    : Math.round(args.width);
            }
            if (args.height !== undefined) {
                args.height = args.height >= EMU_PIXEL_THRESHOLD
                    ? Math.round(args.height / EMU_PER_PX)
                    : Math.round(args.height);
            }
        }
        // ── create_line special coordinates (startX/Y, endX/Y not covered by x/y) ──
        if (command === "create_line") {
            for (const key of ["startX", "startY", "endX", "endY"]) {
                if (args[key] !== undefined) {
                    args[key] = Math.abs(args[key]) >= EMU_PIXEL_THRESHOLD
                        ? Math.round(args[key] / EMU_PER_PX)
                        : Math.round(args[key]);
                }
            }
            // dashPattern: array of EMU values [dash, gap]
            if (Array.isArray(args.dashPattern)) {
                args.dashPattern = args.dashPattern.map((v) => v >= EMU_PIXEL_THRESHOLD
                    ? Math.max(1, Math.round(v / EMU_PER_PX))
                    : Math.max(1, Math.round(v)));
            }
        }
        // ── Offset coordinates (clone_node, set_drop_shadow, set_inner_shadow) ──
        for (const key of ["offsetX", "offsetY"]) {
            if (args[key] !== undefined && Math.abs(args[key]) > 100) {
                args[key] = Math.round(args[key] / EMU_PER_PX);
            }
        }
        // ── Generic dimensional params (heuristic: >100 = likely EMU) ──
        // These are typically small pixel values (1-50px) so >100 safely detects EMU.
        const SMALL_DIMENSION_PARAMS = [
            "strokeWeight", // create_rectangle, create_polygon, create_star, create_line
            "weight", // set_stroke (different param name)
            "cornerRadius", // create_rectangle
            "radius", // set_corner_radius, set_drop_shadow, set_inner_shadow
            "spread", // set_drop_shadow, set_inner_shadow
            "lineWidth", // create_line_chart, chart style
            "barSpacing", // create_bar_chart
            "dotSize", // data chart style
            "barCornerRadius", // data chart style
            "connectorWidth", // smartart style
            "blockCornerRadius", // smartart style
            "borderWidth", // table style
            "cellPadding", // table style
            "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", // set_padding
            "itemSpacing", // set_item_spacing
        ];
        for (const key of SMALL_DIMENSION_PARAMS) {
            if (args[key] !== undefined && typeof args[key] === "number" && args[key] > 100) {
                args[key] = Math.max(1, Math.round(args[key] / EMU_PER_PX));
            }
        }
        // ── "size" param (create_marker, create_pie_chart, create_donut_chart) ──
        // Typically 50-600px, so use higher threshold (>1000) to avoid false positives.
        if (args.size !== undefined && typeof args.size === "number" && args.size > 1000) {
            args.size = Math.round(args.size / EMU_PER_PX);
        }
        // ── Nested style objects (table/chart/smartart tools) ──
        if (args.style && typeof args.style === "object") {
            for (const key of SMALL_DIMENSION_PARAMS) {
                if (args.style[key] !== undefined && typeof args.style[key] === "number" && args.style[key] > 100) {
                    args.style[key] = Math.max(1, Math.round(args.style[key] / EMU_PER_PX));
                }
            }
            // Font sizes in style: hundredths-of-point → points
            for (const key of ["fontSize", "headerFontSize", "titleFontSize"]) {
                if (args.style[key] !== undefined && args.style[key] > 1000) {
                    args.style[key] = Math.round(args.style[key] / 100);
                }
            }
            // minCellWidth/Height: can be >100px, use >1000 threshold
            for (const key of ["minCellWidth", "minCellHeight"]) {
                if (args.style[key] !== undefined && args.style[key] > 1000) {
                    args.style[key] = Math.round(args.style[key] / EMU_PER_PX);
                }
            }
        }
        // ── Font size conversion: OOXML hundredths-of-point → points ──
        if (args.fontSize !== undefined && args.fontSize > 1000) {
            args.fontSize = Math.round(args.fontSize / 100);
        }
        // Remap slideId (focus_slide)
        if (args.slideId !== undefined) {
            const key = String(args.slideId);
            const entry = this.mapping[key];
            if (entry) {
                args.slideId = entry.figmaId;
            }
        }
        // Remap slideIds array (reorder_slides)
        if (Array.isArray(args.slideIds)) {
            args.slideIds = args.slideIds.map((id) => {
                const entry = this.mapping[String(id)];
                return entry ? entry.figmaId : id;
            });
        }
        // Remap nodeIds array (group_nodes, boolean_nodes)
        if (Array.isArray(args.nodeIds)) {
            args.nodeIds = args.nodeIds.map((id) => {
                const entry = this.mapping[String(id)];
                return entry ? entry.figmaId : id;
            });
        }
    }
    // ── Reverse mapping: Figma IDs → XML IDs in tool results ──
    static buildReverseMap(mapping) {
        const rev = {};
        for (const [xmlId, entry] of Object.entries(mapping)) {
            rev[entry.figmaId] = xmlId;
        }
        return rev;
    }
    static computeNextId(mapping) {
        let max = 0;
        for (const key of Object.keys(mapping)) {
            const n = parseInt(key, 10);
            if (!isNaN(n) && n > max)
                max = n;
        }
        return max + 1;
    }
    /**
     * Replace all Figma node IDs ("XX:YYY" format) in tool result text
     * with their corresponding XML integer IDs.
     * For newly created nodes (not in the mapping), assign fresh XML IDs.
     *
     * Also reverse-maps structuredContent so that model formatToolResponse()
     * (which serialises both content + structuredContent) never leaks Figma IDs.
     */
    reverseMapResult(result) {
        if (!result.content || !Array.isArray(result.content))
            return result;
        const replaceFigmaIds = (str) => str.replace(/"(\d+:\d+)"/g, (_match, figmaId) => {
            let xmlId = this.reverseMap[figmaId];
            if (!xmlId) {
                // Dynamically created node — assign a new XML ID
                xmlId = String(this.nextXmlId++);
                this.reverseMap[figmaId] = xmlId;
                this.mapping[xmlId] = {
                    figmaId,
                    type: "UNKNOWN",
                    name: "",
                    parentFigmaId: "",
                    parentAbsX: 0,
                    parentAbsY: 0,
                    absX: 0,
                    absY: 0,
                };
                helpers_1.logger.info({
                    header: `[XML Reverse Map] New node ${figmaId} → XML ID ${xmlId}`,
                });
            }
            return `"${xmlId}"`;
        });
        const newContent = result.content.map((part) => {
            if (part.type !== "text" || !part.text)
                return part;
            return { ...part, text: replaceFigmaIds(part.text) };
        });
        // Also reverse-map structuredContent — all model providers serialise it
        // alongside content[] and send both to the LLM.
        let newStructured = result.structuredContent;
        if (newStructured) {
            try {
                const raw = JSON.stringify(newStructured);
                const mapped = replaceFigmaIds(raw);
                newStructured = JSON.parse(mapped);
            }
            catch {
                // If serialisation round-trip fails, drop structuredContent entirely
                // to avoid leaking Figma IDs.
                newStructured = undefined;
            }
        }
        return { ...result, content: newContent, structuredContent: newStructured };
    }
}
exports.MappedTools = MappedTools;
// ---------------------------------------------------------------------------
// SceneGraph → OOXML converter (TypeScript version for Turn 2+ refresh)
// ---------------------------------------------------------------------------
function escapeXml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}
function pxToEmu(px) {
    return Math.round(px * PX_TO_EMU);
}
function fontSizeToOoxml(pt) {
    return Math.round(pt * 100);
}
function rgbaToHex(color) {
    if (!color || typeof color !== "object")
        return null;
    const r = Math.round((color.r ?? 0) * 255);
    const g = Math.round((color.g ?? 0) * 255);
    const b = Math.round((color.b ?? 0) * 255);
    return (r.toString(16).padStart(2, "0") +
        g.toString(16).padStart(2, "0") +
        b.toString(16).padStart(2, "0")).toUpperCase();
}
function getFillHex(node) {
    const fills = node.fills;
    if (!Array.isArray(fills))
        return null;
    for (const fill of fills) {
        if (fill?.type !== "SOLID")
            continue;
        if (typeof fill.color === "string" && fill.color.startsWith("#")) {
            return fill.color.slice(1).toUpperCase();
        }
        if (fill.color && typeof fill.color === "object") {
            return rgbaToHex(fill.color);
        }
    }
    return null;
}
function getAbsPosition(node) {
    const bb = node.absoluteBoundingBox;
    if (bb && typeof bb === "object")
        return [bb.x ?? 0, bb.y ?? 0];
    const rt = node.relativeTransform;
    if (Array.isArray(rt) && rt.length === 2) {
        try {
            return [rt[0][2], rt[1][2]];
        }
        catch {
            /* fall through */
        }
    }
    if (Array.isArray(node.pos) && node.pos.length === 2) {
        return [node.pos[0], node.pos[1]];
    }
    if (Array.isArray(node.bounds) && node.bounds.length >= 2) {
        return [node.bounds[0], node.bounds[1]];
    }
    return [0, 0];
}
function getSize(node) {
    const sz = node.size;
    if (sz && typeof sz === "object" && !Array.isArray(sz)) {
        return [sz.x ?? 0, sz.y ?? 0];
    }
    if (Array.isArray(sz) && sz.length === 2)
        return [sz[0], sz[1]];
    const bb = node.absoluteBoundingBox;
    if (bb && typeof bb === "object")
        return [bb.width ?? 0, bb.height ?? 0];
    if (Array.isArray(node.bounds) && node.bounds.length >= 4) {
        return [node.bounds[2], node.bounds[3]];
    }
    return [0, 0];
}
const NS_P = "http://schemas.openxmlformats.org/presentationml/2006/main";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
function shapeToXml(xmlId, node, absX, absY, w, h) {
    const name = escapeXml(node.name ?? "");
    const xEmu = pxToEmu(absX);
    const yEmu = pxToEmu(absY);
    const cxEmu = pxToEmu(w);
    const cyEmu = pxToEmu(h);
    const prst = node.type === "ELLIPSE" ? "ellipse" : "rect";
    let spPrChildren = `<a:xfrm>\n  <a:off x="${xEmu}" y="${yEmu}"/>\n  <a:ext cx="${cxEmu}" cy="${cyEmu}"/>\n</a:xfrm>\n` +
        `<a:prstGeom prst="${prst}"/>`;
    const fillHex = getFillHex(node);
    if (fillHex) {
        spPrChildren += `\n<a:solidFill>\n  <a:srgbClr val="${fillHex}"/>\n</a:solidFill>`;
    }
    let txBody = "";
    if (node.type === "TEXT") {
        const chars = node.characters ?? "";
        const style = node.style ?? {};
        const ff = escapeXml(style.fontFamily ?? "Arial");
        const sz = fontSizeToOoxml(style.fontSize ?? 18);
        const bold = style.fontWeight &&
            ["bold", "700", "800", "900"].includes(String(style.fontWeight).toLowerCase())
            ? ' b="1"'
            : "";
        const textColor = fillHex ?? "000000";
        const lines = chars.split("\n");
        const paras = lines
            .map((line) => `<a:p>\n  <a:r>\n    <a:rPr lang="en-US" sz="${sz}"${bold} dirty="0">\n` +
            `      <a:solidFill><a:srgbClr val="${textColor}"/></a:solidFill>\n` +
            `      <a:latin typeface="${ff}"/>\n    </a:rPr>\n` +
            `    <a:t>${escapeXml(line)}</a:t>\n  </a:r>\n</a:p>`)
            .join("\n");
        txBody = `\n<p:txBody>\n  <a:bodyPr/>\n  ${paras}\n</p:txBody>`;
    }
    return (`<p:sp>\n` +
        `  <p:nvSpPr>\n    <p:cNvPr id="${xmlId}" name="${name}"/>\n    <p:cNvSpPr/>\n    <p:nvPr/>\n  </p:nvSpPr>\n` +
        `  <p:spPr>\n    ${spPrChildren}\n  </p:spPr>${txBody}\n` +
        `</p:sp>`);
}
function findSlidesInDocument(doc) {
    const slides = [];
    function walk(node) {
        if (!node || typeof node !== "object")
            return;
        const t = node.type;
        if (t === "SLIDE") {
            slides.push(node);
            return;
        }
        if (t === "DOCUMENT" || t === "SLIDE_ROW") {
            for (const c of node.children ?? [])
                walk(c);
            return;
        }
        if (t === "CANVAS") {
            for (const c of node.children ?? []) {
                if (c.type === "SLIDE")
                    slides.push(c);
                else if (c.type === "SECTION") {
                    for (const gc of c.children ?? []) {
                        if (gc.type === "FRAME" || gc.type === "SLIDE")
                            slides.push(gc);
                    }
                }
                else if (c.type === "FRAME") {
                    const inner = (c.children ?? []).filter((x) => x.type === "SLIDE" || x.type === "SLIDE_ROW");
                    if (inner.length > 0) {
                        for (const item of c.children ?? []) {
                            if (item.type === "SLIDE")
                                slides.push(item);
                            else if (item.type === "SLIDE_ROW") {
                                for (const gc of item.children ?? []) {
                                    if (gc.type === "SLIDE" || gc.type === "FRAME")
                                        slides.push(gc);
                                }
                            }
                        }
                    }
                    else {
                        slides.push(c);
                    }
                }
                else if (c.type === "SLIDE_ROW") {
                    for (const gc of c.children ?? []) {
                        if (gc.type === "SLIDE" || gc.type === "FRAME")
                            slides.push(gc);
                    }
                }
            }
            return;
        }
        for (const c of node.children ?? [])
            walk(c);
    }
    walk(doc.document ?? doc);
    return slides;
}
function flattenSlideNodes(node, slideAbsX, slideAbsY, parentFigmaId, parentAbsX, parentAbsY, idAssigner, shapes, mapping) {
    for (const child of node.children ?? []) {
        if (!child || typeof child !== "object")
            continue;
        if (child.visible === false)
            continue;
        const childId = child.id ?? "";
        const childType = child.type ?? "";
        // Compute absolute position
        let cAbsX, cAbsY;
        const bb = child.absoluteBoundingBox;
        if (bb && typeof bb === "object") {
            cAbsX = (bb.x ?? 0) - slideAbsX;
            cAbsY = (bb.y ?? 0) - slideAbsY;
        }
        else if (Array.isArray(child.bounds) && child.bounds.length >= 2) {
            cAbsX = child.bounds[0];
            cAbsY = child.bounds[1];
        }
        else if (Array.isArray(child.pos) && child.pos.length === 2) {
            cAbsX = parentAbsX + child.pos[0];
            cAbsY = parentAbsY + child.pos[1];
        }
        else {
            const [rx, ry] = getAbsPosition(child);
            cAbsX = parentAbsX + rx;
            cAbsY = parentAbsY + ry;
        }
        const [cW, cH] = getSize(child);
        if (cW === 0 && cH === 0 && childType !== "TEXT") {
            if (["FRAME", "GROUP", "SECTION", "SLIDE_ROW"].includes(childType)) {
                flattenSlideNodes(child, slideAbsX, slideAbsY, childId, cAbsX, cAbsY, idAssigner, shapes, mapping);
            }
            continue;
        }
        const xmlId = idAssigner.assign(childId);
        mapping[String(xmlId)] = {
            figmaId: childId,
            type: childType,
            name: child.name ?? "",
            parentFigmaId,
            parentAbsX,
            parentAbsY,
            absX: cAbsX,
            absY: cAbsY,
        };
        shapes.push(shapeToXml(xmlId, child, cAbsX, cAbsY, cW, cH));
        if (["FRAME", "GROUP", "SECTION"].includes(childType)) {
            flattenSlideNodes(child, slideAbsX, slideAbsY, childId, cAbsX, cAbsY, idAssigner, shapes, mapping);
        }
    }
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
function scenegraphToXml(sceneGraph, previousMapping) {
    const mapping = {};
    // Build figmaId → previous xmlId lookup for stable re-assignment
    const prevFigmaToXml = {};
    let maxPrevId = 0;
    if (previousMapping) {
        for (const [xmlId, entry] of Object.entries(previousMapping)) {
            const n = parseInt(xmlId, 10);
            if (!isNaN(n)) {
                prevFigmaToXml[entry.figmaId] = n;
                if (n > maxPrevId)
                    maxPrevId = n;
            }
        }
    }
    // Counter for new nodes starts after the highest previous ID
    let nextNewId = maxPrevId;
    const usedIds = new Set(Object.values(prevFigmaToXml));
    const idAssigner = {
        assign(figmaId) {
            // Reuse previous XML ID for the same Figma node
            if (figmaId in prevFigmaToXml) {
                return prevFigmaToXml[figmaId];
            }
            // Assign a new ID for nodes not seen before
            nextNewId++;
            while (usedIds.has(nextNewId))
                nextNewId++;
            usedIds.add(nextNewId);
            return nextNewId;
        },
    };
    // Handle micro-spatial context
    let slidesData;
    if (sceneGraph.targetSlides) {
        slidesData = sceneGraph.targetSlides
            .map((ts) => ts.sceneGraph)
            .filter(Boolean);
    }
    else {
        slidesData = findSlidesInDocument(sceneGraph);
    }
    if (slidesData.length === 0) {
        return { xml: "<p:presentation/>", mapping: {} };
    }
    const slideXmls = [];
    for (let idx = 0; idx < slidesData.length; idx++) {
        const slide = slidesData[idx];
        const slideId = slide.id ?? "";
        const slideName = escapeXml(slide.name ?? `Slide ${idx + 1}`);
        let [w, h] = getSize(slide);
        if (w === 0)
            w = DEFAULT_SLIDE_W;
        if (h === 0)
            h = DEFAULT_SLIDE_H;
        const bb = slide.absoluteBoundingBox ?? {};
        const slideAbsX = typeof bb === "object" ? (bb.x ?? 0) : 0;
        const slideAbsY = typeof bb === "object" ? (bb.y ?? 0) : 0;
        const wEmu = pxToEmu(w);
        const hEmu = pxToEmu(h);
        const slideXmlId = idAssigner.assign(slideId);
        mapping[String(slideXmlId)] = {
            figmaId: slideId,
            type: slide.type ?? "SLIDE",
            name: slide.name ?? "",
            parentFigmaId: "",
            parentAbsX: 0,
            parentAbsY: 0,
            absX: 0,
            absY: 0,
        };
        const shapes = [];
        flattenSlideNodes(slide, slideAbsX, slideAbsY, slideId, 0, 0, idAssigner, shapes, mapping);
        const fillHex = getFillHex(slide);
        const bgXml = fillHex
            ? `\n    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${fillHex}"/></a:solidFill></p:bgPr></p:bg>`
            : "";
        slideXmls.push(`<p:sld xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">\n` +
            `  <p:cSld name="${slideName}">${bgXml}\n` +
            `    <p:spTree>\n` +
            `      <p:nvGrpSpPr><p:cNvPr id="${slideXmlId}" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\n` +
            `      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/><a:chOff x="0" y="0"/><a:chExt cx="${wEmu}" cy="${hEmu}"/></a:xfrm></p:grpSpPr>\n` +
            shapes.map((s) => "      " + s.replace(/\n/g, "\n      ")).join("\n") +
            `\n    </p:spTree>\n` +
            `  </p:cSld>\n` +
            `</p:sld>`);
    }
    const xml = slideXmls.length === 1
        ? slideXmls[0]
        : `<p:presentation xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}">\n` +
            slideXmls.map((s) => "  " + s.replace(/\n/g, "\n  ")).join("\n") +
            `\n</p:presentation>`;
    helpers_1.logger.info({
        header: `[XML] SceneGraph→XML: ${slidesData.length} slide(s), ${Object.keys(mapping).length} elements, ${xml.length.toLocaleString()} bytes`,
    });
    return { xml, mapping };
}
//# sourceMappingURL=xml_tools.js.map