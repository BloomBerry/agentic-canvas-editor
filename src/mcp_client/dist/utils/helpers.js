"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reduceBase64Image = exports.logger = void 0;
exports.base64Encode = base64Encode;
exports.createImageUrl = createImageUrl;
exports.getAllSlides = getAllSlides;
exports.exportSlideImage = exportSlideImage;
exports.getSlidePageInfo = getSlidePageInfo;
exports.importJsonToFigma = importJsonToFigma;
exports.getLoadedPageStructureDescription = getLoadedPageStructureDescription;
exports.exportJsonFromFigma = exportJsonFromFigma;
exports.countSlidesFromExportedJson = countSlidesFromExportedJson;
exports.extractSkeletonFromExportedJson = extractSkeletonFromExportedJson;
const crypto_1 = require("crypto");
const canvas_1 = require("@napi-rs/canvas");
const COLORS = {
    GRAY: "\x1b[90m",
    CLIENT: "\x1b[35m",
    RESET: "\x1b[0m",
    ITALIC: "\x1b[3m",
    ERROR: "\x1b[31m",
};
const CLIENT_TAG = `${COLORS.CLIENT}[MCP-CLIENT]${COLORS.RESET}`;
const INFO_TAG = `[${COLORS.ITALIC}info${COLORS.RESET}]`;
const DEBUG_TAG = `[${COLORS.ITALIC}debug${COLORS.RESET}]`;
const WARN_TAG = `[${COLORS.ITALIC}warn${COLORS.RESET}]`;
const ERROR_TAG = `[${COLORS.ERROR}error${COLORS.RESET}]`;
const LOG_TAG = `[${COLORS.ITALIC}log${COLORS.RESET}]`;
const writeLog = (tag) => ({ header, body }) => process.stderr.write(`${CLIENT_TAG}${tag} ${header}${body ? `\n${COLORS.GRAY}${body}${COLORS.RESET}` : ""}\n`);
exports.logger = {
    info: writeLog(INFO_TAG),
    debug: writeLog(DEBUG_TAG),
    warn: writeLog(WARN_TAG),
    error: writeLog(ERROR_TAG),
    log: writeLog(LOG_TAG),
};
function base64Encode(buffer) {
    return buffer.toString("base64");
}
function createImageUrl(base64Data, mimeType = "image/png") {
    return `data:${mimeType};base64,${base64Data}`;
}
const ALLOWED_MIME_TYPES = [
    "image/png",
    "image/jpeg",
    "image/webp",
];
const reduceBase64Image = async (base64Image, mimeType = "image/png", maxHeight = 1024) => {
    const img = new canvas_1.Image();
    img.src = `data:${mimeType};base64,${base64Image}`;
    return new Promise((resolve, reject) => {
        img.onload = () => {
            let { width, height } = img;
            if (height > maxHeight) {
                const scale = maxHeight / height;
                width = Math.round(width * scale);
                height = maxHeight;
            }
            const canvas = new canvas_1.Canvas(width, height);
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("Unable to obtain 2-D canvas context."));
                return;
            }
            ctx.drawImage(img, 0, 0, width, height);
            // Canvas export only supports a limited set of mime types.
            const safeMimeType = ALLOWED_MIME_TYPES.includes(mimeType)
                ? mimeType
                : "image/png";
            const resizedBase64 = canvas
                .toDataURL(safeMimeType)
                .replace(`data:${safeMimeType};base64,`, "");
            resolve({ base64: resizedBase64, width, height });
        };
        img.onerror = (err) => reject(new Error(`Failed to load image: ${err}`));
    });
};
exports.reduceBase64Image = reduceBase64Image;
// ── Figma Slides helpers ──
async function getAllSlides(tools) {
    const call = tools.createToolCall("get_all_slides", (0, crypto_1.randomUUID)(), {});
    const result = await tools.callTool(call);
    if (result.isError) {
        throw new Error("Failed to get all slides");
    }
    return result.structuredContent;
}
async function exportSlideImage(tools, slideId) {
    const args = {};
    if (slideId)
        args.slideId = slideId;
    const call = tools.createToolCall("export_slide_image", (0, crypto_1.randomUUID)(), args);
    const result = await tools.callTool(call);
    if (result.isError) {
        throw new Error("Failed to export slide image");
    }
    if (!result.structuredContent || !result.structuredContent.imageData) {
        throw new Error("No image found in the export_slide_image response");
    }
    const imageURI = `data:${result.structuredContent.mimeType};base64,${result.structuredContent.imageData}`;
    return imageURI;
}
async function getSlidePageInfo(tools) {
    const call = tools.createToolCall("get_page_info", (0, crypto_1.randomUUID)(), {});
    const result = await tools.callTool(call);
    if (result.isError) {
        throw new Error("Failed to get page info");
    }
    return result.structuredContent ?? {};
}
// ── Import / Export JSON helpers ──
async function importJsonToFigma(tools, jsonString, imageData, slideIndicesToImport) {
    const args = { jsonString };
    if (imageData && Object.keys(imageData).length > 0) {
        args.imageData = imageData;
    }
    if (slideIndicesToImport && slideIndicesToImport.length > 0) {
        args.slideIndicesToImport = slideIndicesToImport;
    }
    const call = tools.createToolCall("import_json", (0, crypto_1.randomUUID)(), args);
    const result = await tools.callTool(call);
    if (result.isError) {
        const errorMessage = result.content
            .map((c) => c.text)
            .join("\n");
        throw new Error(`Failed to import JSON: ${errorMessage || "Unknown error"}`);
    }
    const sc = result.structuredContent ?? {};
    // Brief import summary (suppress verbose per-node diagnostics)
    const diagParts = [];
    if (sc.imagesRegistered !== undefined)
        diagParts.push(`images: ${sc.imagesRegistered}`);
    if (Array.isArray(sc.imageDiag))
        diagParts.push(`imageNodes: ${sc.imageDiag.length}`);
    if (Array.isArray(sc.importLogs))
        diagParts.push(`logEntries: ${sc.importLogs.length}`);
    if (diagParts.length > 0) {
        exports.logger.info({ header: `[importJsonToFigma] ${diagParts.join(", ")}` });
    }
    // Only surface errors
    if (sc.imageErrors) {
        exports.logger.warn({ header: "[importJsonToFigma] Image errors", body: JSON.stringify(sc.imageErrors) });
    }
    const failedLogs = Array.isArray(sc.importLogs)
        ? sc.importLogs.filter((l) => String(l).includes("❌"))
        : [];
    if (failedLogs.length > 0) {
        exports.logger.warn({ header: `[importJsonToFigma] ${failedLogs.length} failed import log(s)`, body: failedLogs.join("\n") });
    }
    const slideIds = sc.slideIds ?? [];
    const slideCount = sc.slideCount ?? 0;
    const nodeIdMap = sc.nodeIdMap ?? {};
    return { slideIds, slideCount, nodeIdMap };
}
/**
 * Get the current page structure as a text description (node id, name, type, position).
 * Use this once after import_json to provide live node IDs to the agent.
 */
async function getLoadedPageStructureDescription(tools) {
    const req = tools.createToolCall("get_page_structure", (0, crypto_1.randomUUID)(), {});
    const response = await tools.callTool(req);
    if (response.isError) {
        throw new Error("Failed to get page structure for context");
    }
    const firstText = Array.isArray(response.content) &&
        response.content.length > 0 &&
        typeof response.content[0].text === "string"
        ? response.content[0].text
        : "";
    if (!firstText) {
        throw new Error("No structure description in get_page_structure response");
    }
    return firstText;
}
async function exportJsonFromFigma(tools) {
    const call = tools.createToolCall("export_json", (0, crypto_1.randomUUID)(), {});
    const result = await tools.callTool(call);
    if (result.isError) {
        throw new Error("Failed to export JSON from Figma");
    }
    return result.structuredContent ?? {};
}
/**
 * Count slides from an exported JSON_REST_V1 document.
 * Handles the various nesting structures: SLIDE, FRAME, SECTION, SLIDE_ROW.
 */
function countSlidesFromExportedJson(exportedJson) {
    try {
        const canvas = exportedJson?.document?.children?.[0];
        if (!canvas?.children)
            return 1;
        let count = 0;
        for (const child of canvas.children) {
            const t = child.type;
            if (t === "SLIDE") {
                count++;
            }
            else if (t === "SECTION") {
                count += (child.children || []).filter((c) => c.type === "FRAME" || c.type === "SLIDE").length;
            }
            else if (t === "FRAME") {
                const inner = (child.children || []).filter((c) => c.type === "SLIDE" || c.type === "SLIDE_ROW");
                if (inner.length > 0) {
                    for (const row of child.children || []) {
                        if (row.type === "SLIDE")
                            count++;
                        else if (row.type === "SLIDE_ROW") {
                            count += (row.children || []).filter((c) => c.type === "SLIDE" || c.type === "FRAME").length;
                        }
                    }
                }
                else {
                    count++;
                }
            }
            else if (t === "SLIDE_ROW") {
                count += (child.children || []).filter((c) => c.type === "SLIDE" || c.type === "FRAME").length;
            }
        }
        return count || 1;
    }
    catch {
        return 1;
    }
}
// Keys to keep for TEXT node style in skeleton extraction
const SKELETON_STYLE_KEYS = new Set([
    "fontFamily", "fontStyle", "fontWeight", "fontSize", "textCase",
    "textDecoration", "textAlignHorizontal",
]);
/**
 * Strip an exported JSON_REST_V1 document to a lightweight skeleton,
 * keeping only identity (id, name, type), text content, minimal style,
 * and compact bounds [x, y, w, h] for spatial reasoning.
 *
 * Mirrors the Python `extract_skeleton_json()` logic from care_context.py.
 * Expected reduction: ~85-95 % of original size.
 */
function extractSkeletonFromExportedJson(exportedJson) {
    function compactBounds(node) {
        const bb = node.absoluteBoundingBox ?? node.absoluteRenderBounds;
        if (!bb || typeof bb !== "object")
            return null;
        try {
            return [
                Math.round(bb.x ?? 0),
                Math.round(bb.y ?? 0),
                Math.round(bb.width ?? 0),
                Math.round(bb.height ?? 0),
            ];
        }
        catch {
            return null;
        }
    }
    function strip(node) {
        if (!node || typeof node !== "object")
            return null;
        const out = {};
        // Identity – always keep
        if (node.id)
            out.id = node.id;
        if (node.name)
            out.name = node.name;
        if (node.type)
            out.type = node.type;
        // Bounds for spatial reasoning
        const bounds = compactBounds(node);
        if (bounds)
            out.bounds = bounds;
        // Slide size
        if ((node.type === "SLIDE" || node.type === "FRAME") && node.size) {
            out.size = node.size;
        }
        // Text content
        if (node.type === "TEXT") {
            if (node.characters)
                out.characters = node.characters;
            if (node.style && typeof node.style === "object") {
                const filteredStyle = {};
                for (const [k, v] of Object.entries(node.style)) {
                    if (SKELETON_STYLE_KEYS.has(k))
                        filteredStyle[k] = v;
                }
                if (Object.keys(filteredStyle).length > 0)
                    out.style = filteredStyle;
            }
        }
        // Recurse children
        if (Array.isArray(node.children)) {
            const children = [];
            for (const child of node.children) {
                const stripped = strip(child);
                if (stripped)
                    children.push(stripped);
            }
            if (children.length > 0)
                out.children = children;
        }
        return out;
    }
    return {
        fileName: exportedJson.fileName ?? "",
        document: strip(exportedJson.document ?? {}),
    };
}
//# sourceMappingURL=helpers.js.map