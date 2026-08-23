// @ts-nocheck
import { createNode, nodeIdMap, imageHashMap, imagePaintStats, formatPaint, importLogs, resetImportLogs, _ilog } from "../bridge";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/* ------------------------------------------------------------------ */
/*  Manual node-tree serialization (JSON_REST_V1-compatible output)    */
/*  This is the inverse of bridge.ts → createNode().                  */
/* ------------------------------------------------------------------ */

function cloneJSON(val: any): any {
  try { return JSON.parse(JSON.stringify(val)); } catch { return val; }
}

/** Serialize a Paint array to REST-API format */
function serializePaints(paints: ReadonlyArray<any>): any[] {
  if (!paints || !Array.isArray(paints)) return [];
  return paints.map((p: any) => {
    const out: any = { type: p.type, visible: p.visible ?? true };
    if (p.opacity !== undefined) out.opacity = p.opacity;
    if (p.blendMode) out.blendMode = p.blendMode;

    switch (p.type) {
      case "SOLID":
        if (p.color) {
          out.color = { r: p.color.r, g: p.color.g, b: p.color.b, a: p.opacity ?? 1 };
        }
        break;
      case "IMAGE":
        out.imageHash = p.imageHash;
        out.scaleMode = p.scaleMode ?? "FILL";
        if (p.imageTransform) out.imageTransform = cloneJSON(p.imageTransform);
        break;
      case "GRADIENT_LINEAR":
      case "GRADIENT_RADIAL":
      case "GRADIENT_ANGULAR":
      case "GRADIENT_DIAMOND":
        if (p.gradientTransform) out.gradientTransform = cloneJSON(p.gradientTransform);
        if (p.gradientStops) {
          out.gradientStops = p.gradientStops.map((s: any) => ({
            position: s.position,
            color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a ?? 1 },
          }));
        }
        break;
    }
    return out;
  });
}

/** Serialize an Effect array */
function serializeEffects(effects: ReadonlyArray<any>): any[] {
  if (!effects || !Array.isArray(effects)) return [];
  return cloneJSON(effects);
}

/** Compute absoluteBoundingBox from absoluteTransform + size */
function computeBBox(node: any): any | null {
  try {
    const t = node.absoluteTransform;
    if (t) {
      return { x: t[0][2], y: t[1][2], width: node.width, height: node.height };
    }
  } catch {}
  return null;
}

/** Serialize text node properties including styled segments */
function serializeText(node: any, json: any) {
  json.characters = node.characters ?? "";
  json.textAutoResize = node.textAutoResize ?? "NONE";
  json.textAlignHorizontal = node.textAlignHorizontal ?? "LEFT";
  json.textAlignVertical = node.textAlignVertical ?? "TOP";

  // Root style (from uniform properties or first character)
  const style: any = {};
  const fn = node.fontName;
  if (fn && fn !== figma.mixed) {
    style.fontFamily = fn.family;
    style.fontStyle = fn.style;
  } else if (node.characters.length > 0) {
    try {
      const fn0 = node.getRangeFontName(0, 1);
      style.fontFamily = fn0.family;
      style.fontStyle = fn0.style;
    } catch {}
  }

  const fs = node.fontSize;
  if (fs !== undefined && fs !== figma.mixed) {
    style.fontSize = fs;
  } else if (node.characters.length > 0) {
    try { style.fontSize = node.getRangeFontSize(0, 1); } catch {}
  }

  // Line height
  try {
    const lh = node.lineHeight;
    if (lh && lh !== figma.mixed) {
      if (lh.unit === "AUTO") {
        style.lineHeightUnit = "AUTO";
      } else if (lh.unit === "PIXELS") {
        style.lineHeightPx = lh.value;
        style.lineHeightUnit = "PIXELS";
      } else if (lh.unit === "PERCENT") {
        style.lineHeightPercent = lh.value;
        style.lineHeightUnit = "PERCENT";
      }
    }
  } catch {}

  // Letter spacing
  try {
    const ls = node.letterSpacing;
    if (ls && ls !== figma.mixed) {
      style.letterSpacing = ls.value;
      style.letterSpacingUnit = ls.unit;
    }
  } catch {}

  // Text case & decoration
  try {
    const tc = node.textCase;
    if (tc !== undefined && tc !== figma.mixed) style.textCase = tc;
  } catch {}
  try {
    const td = node.textDecoration;
    if (td !== undefined && td !== figma.mixed) style.textDecoration = td;
  } catch {}

  // Paragraph
  try { style.paragraphIndent = node.paragraphIndent ?? 0; } catch {}
  try { style.paragraphSpacing = node.paragraphSpacing ?? 0; } catch {}

  style.textAlignHorizontal = json.textAlignHorizontal;
  style.textAlignVertical = json.textAlignVertical;
  style.textAutoResize = json.textAutoResize;

  // Leading trim
  try {
    if (node.leadingTrim !== undefined) style.leadingTrim = node.leadingTrim;
  } catch {}

  // Root-level list options and indentation (from first character segment)
  try {
    if (node.characters.length > 0 && typeof node.getStyledTextSegments === "function") {
      const liSegs = node.getStyledTextSegments(["listOptions", "indentation"]);
      // Diagnostic: log what we get for list options
      if (liSegs.length > 0) {
        const hasAnyList = liSegs.some((s: any) => s.listOptions && s.listOptions.type && s.listOptions.type !== "NONE");
        if (hasAnyList || node.characters.includes("•") || node.characters.includes("·") || node.characters.includes("-\n")) {
          console.log(`[serializeText] BULLET DIAG node="${node.name}" chars="${node.characters.substring(0, 80)}..." segs=${liSegs.length}`);
          for (let si = 0; si < Math.min(liSegs.length, 5); si++) {
            const s = liSegs[si];
            console.log(`  seg[${si}] [${s.start}-${s.end}] listOptions=${JSON.stringify(s.listOptions)} indent=${s.indentation}`);
          }
        }
        if (liSegs[0].listOptions && liSegs[0].listOptions.type !== "NONE") {
          style.listOptions = { type: liSegs[0].listOptions.type };
        }
        if (liSegs[0].indentation !== undefined && liSegs[0].indentation > 0) {
          style.indentation = liSegs[0].indentation;
        }
      }
    }
  } catch (e) {
    console.warn(`[serializeText] listOptions capture failed for "${node.name}":`, e);
  }

  json.style = style;

  // lineTypes & lineIndentations (per-paragraph bullet/list info for REST API format)
  try {
    if (node.characters.length > 0 && typeof node.getStyledTextSegments === "function") {
      const listSegs = node.getStyledTextSegments(["listOptions", "indentation"]);
      if (listSegs.length > 0) {
        // Build per-line arrays by finding which segment covers each line start
        const lines = node.characters.split("\n");
        const lineTypes: string[] = [];
        const lineIndentations: number[] = [];
        let charOffset = 0;
        for (const line of lines) {
          // Find the segment that covers charOffset
          const seg = listSegs.find((s: any) => s.start <= charOffset && s.end > charOffset);
          if (seg && seg.listOptions && seg.listOptions.type && seg.listOptions.type !== "NONE") {
            lineTypes.push(seg.listOptions.type);
            lineIndentations.push(seg.indentation ?? 0);
          } else {
            lineTypes.push("NONE");
            lineIndentations.push(seg?.indentation ?? 0);
          }
          charOffset += line.length + 1; // +1 for the newline
        }
        // Only store if there's at least one non-NONE line
        const hasAnyList = lineTypes.some(t => t !== "NONE");
        const hasAnyIndent = lineIndentations.some(i => i > 0);
        if (hasAnyList || hasAnyIndent) {
          json.lineTypes = lineTypes;
          json.lineIndentations = lineIndentations;
          console.log(`[serializeText] lineTypes for "${node.name}": ${JSON.stringify(lineTypes)} indent: ${JSON.stringify(lineIndentations)}`);
        }
      }
    }
  } catch (e) {
    console.warn(`[serializeText] lineTypes capture failed for "${node.name}":`, e);
  }

  // Character style overrides using getStyledTextSegments
  if (node.characters.length > 0 && typeof node.getStyledTextSegments === "function") {
    try {
      const segments = node.getStyledTextSegments([
        "fontName", "fontSize", "lineHeight", "letterSpacing",
        "textCase", "textDecoration", "fills",
        "listOptions", "indentation", "openTypeFeatures", "hyperlink",
      ]);

      // Diagnostic: log full segment details for text with potential bullets
      const hasBulletChars = node.characters.includes("•") || node.characters.includes("·");
      const hasListSegs = segments.some((s: any) => s.listOptions && s.listOptions.type && s.listOptions.type !== "NONE");
      if (hasBulletChars || hasListSegs) {
        console.log(`[serializeText] FULL SEGMENT DIAG node="${node.name}" totalSegs=${segments.length} hasBulletChars=${hasBulletChars} hasListSegs=${hasListSegs}`);
        for (let si = 0; si < Math.min(segments.length, 8); si++) {
          const s = segments[si];
          console.log(`  fullSeg[${si}] [${s.start}-${s.end}] text="${node.characters.substring(s.start, Math.min(s.end, s.start + 40))}" listOpt=${JSON.stringify(s.listOptions)} indent=${s.indentation} font=${s.fontName?.family}/${s.fontName?.style} size=${s.fontSize}`);
        }
      }

      if (segments.length > 1) {
        const overrides: number[] = new Array(node.characters.length).fill(0);
        const table: Record<string, any> = {};
        let nextId = 1;
        const styleKeyMap = new Map<string, number>();

        // First segment is the "root" style (id=0)
        const rootKey = segmentKey(segments[0]);

        for (const seg of segments) {
          const key = segmentKey(seg);
          if (key === rootKey) continue; // matches root style

          if (!styleKeyMap.has(key)) {
            const id = nextId++;
            styleKeyMap.set(key, id);
            table[String(id)] = segmentToStyle(seg);
          }

          const id = styleKeyMap.get(key)!;
          for (let i = seg.start; i < seg.end; i++) {
            overrides[i] = id;
          }
        }

        if (Object.keys(table).length > 0) {
          json.characterStyleOverrides = overrides;
          json.styleOverrideTable = table;
        }
      }
    } catch (err) {
      console.warn("[serializeText] getStyledTextSegments failed:", err);
    }
  }

  // Text fills (at node level for REST API compatibility)
  try {
    const fills = node.fills;
    if (fills && fills !== figma.mixed && Array.isArray(fills) && fills.length > 0) {
      json.fills = serializePaints(fills);
    }
  } catch {}
}

function segmentKey(seg: any): string {
  return JSON.stringify({
    fn: seg.fontName ? `${seg.fontName.family}:${seg.fontName.style}` : "",
    fs: seg.fontSize,
    lh: seg.lineHeight,
    ls: seg.letterSpacing,
    tc: seg.textCase,
    td: seg.textDecoration,
    fl: seg.fills ? JSON.stringify(seg.fills) : "[]",
    lo: seg.listOptions ? seg.listOptions.type : "NONE",
    ind: seg.indentation ?? 0,
    otf: seg.openTypeFeatures ? JSON.stringify(seg.openTypeFeatures) : "{}",
    hl: seg.hyperlink ? JSON.stringify(seg.hyperlink) : "null",
  });
}

function segmentToStyle(seg: any): any {
  const s: any = {};
  if (seg.fontName) {
    s.fontFamily = seg.fontName.family;
    s.fontStyle = seg.fontName.style;
  }
  if (seg.fontSize !== undefined) s.fontSize = seg.fontSize;
  if (seg.lineHeight) {
    if (seg.lineHeight.unit === "AUTO") {
      s.lineHeightUnit = "AUTO";
    } else if (seg.lineHeight.unit === "PIXELS") {
      s.lineHeightPx = seg.lineHeight.value;
    } else if (seg.lineHeight.unit === "PERCENT") {
      s.lineHeightPercent = seg.lineHeight.value;
    }
  }
  if (seg.letterSpacing) {
    s.letterSpacing = seg.letterSpacing.value;
    s.letterSpacingUnit = seg.letterSpacing.unit;
  }
  if (seg.textCase) s.textCase = seg.textCase;
  if (seg.textDecoration) s.textDecoration = seg.textDecoration;
  if (seg.fills && Array.isArray(seg.fills) && seg.fills.length > 0) {
    s.fills = serializePaints(seg.fills);
  }
  // List options (bullet/numbered lists)
  if (seg.listOptions && seg.listOptions.type && seg.listOptions.type !== "NONE") {
    s.listOptions = { type: seg.listOptions.type };
  }
  // Indentation level
  if (seg.indentation !== undefined && seg.indentation > 0) {
    s.indentation = seg.indentation;
  }
  // OpenType features
  if (seg.openTypeFeatures && typeof seg.openTypeFeatures === "object" && Object.keys(seg.openTypeFeatures).length > 0) {
    s.openTypeFeatures = { ...seg.openTypeFeatures };
  }
  // Hyperlinks
  if (seg.hyperlink) {
    s.hyperlink = { type: seg.hyperlink.type, value: seg.hyperlink.value };
  }
  return s;
}

/** Recursively serialize a SceneNode to JSON_REST_V1-compatible format */
function serializeNode(node: any): any {
  // Prefer sourceId (set on import) over the live plugin id so the exported
  // JSON's id matches the input JSON's id — stable identity across import
  // sessions, enables id-based diff matching downstream.
  let exportId: string = node.id;
  try {
    const sid = (node as any).getPluginData ? (node as any).getPluginData("sourceId") : "";
    if (sid) exportId = sid;
  } catch {}
  const json: any = {
    id: exportId,
    name: node.name ?? node.type,
    type: node.type,
    visible: node.visible ?? true,
    scrollBehavior: "SCROLLS",
  };

  // Size
  if ("width" in node && "height" in node) {
    json.size = { x: node.width, y: node.height };
    const bbox = computeBBox(node);
    if (bbox) {
      json.absoluteBoundingBox = bbox;
      json.absoluteRenderBounds = { ...bbox };
    }
  }

  // relativeTransform
  if ("relativeTransform" in node) {
    try {
      const rt = node.relativeTransform;
      if (rt) {
        json.relativeTransform = [
          [rt[0][0], rt[0][1], rt[0][2]],
          [rt[1][0], rt[1][1], rt[1][2]],
        ];
      }
    } catch {}
  }

  // Rotation
  if ("rotation" in node) {
    try { json.rotation = node.rotation; } catch {}
  }

  // Fills & strokes (non-TEXT nodes; TEXT fills handled in serializeText)
  if (node.type !== "TEXT" && "fills" in node) {
    try {
      const fills = node.fills;
      if (fills && fills !== figma.mixed) {
        json.fills = serializePaints(fills);
      }
    } catch {}
  }
  if ("strokes" in node) {
    try {
      const strokes = node.strokes;
      if (strokes && strokes !== figma.mixed) {
        json.strokes = serializePaints(strokes);
      }
    } catch {}
  }

  // Stroke props
  if ("strokeWeight" in node) {
    try {
      const sw = node.strokeWeight;
      if (sw !== figma.mixed) json.strokeWeight = sw;
    } catch {}
  }
  if ("strokeAlign" in node) try { json.strokeAlign = node.strokeAlign; } catch {}
  if ("strokeCap" in node) {
    try {
      const sc = node.strokeCap;
      if (sc !== figma.mixed) json.strokeCap = sc;
    } catch {}
  }
  if ("strokeJoin" in node) {
    try {
      const sj = node.strokeJoin;
      if (sj !== figma.mixed) json.strokeJoin = sj;
    } catch {}
  }
  if ("dashPattern" in node) {
    try { json.dashPattern = [...node.dashPattern]; } catch {}
  }
  if ("strokeMiterLimit" in node) {
    try { json.strokeMiterLimit = node.strokeMiterLimit; } catch {}
  }

  // Individual stroke weights
  if ("strokeTopWeight" in node) {
    try {
      json.individualStrokeWeights = {
        top: node.strokeTopWeight,
        right: node.strokeRightWeight,
        bottom: node.strokeBottomWeight,
        left: node.strokeLeftWeight,
      };
    } catch {}
  }

  // Corner radius
  if ("cornerRadius" in node) {
    try {
      const cr = node.cornerRadius;
      if (cr !== figma.mixed) json.cornerRadius = cr;
    } catch {}
  }
  if ("topLeftRadius" in node) {
    try {
      json.rectangleCornerRadii = [
        node.topLeftRadius, node.topRightRadius,
        node.bottomRightRadius, node.bottomLeftRadius,
      ];
      json.topLeftRadius = node.topLeftRadius;
      json.topRightRadius = node.topRightRadius;
      json.bottomRightRadius = node.bottomRightRadius;
      json.bottomLeftRadius = node.bottomLeftRadius;
    } catch {}
  }
  if ("cornerSmoothing" in node) {
    try { json.cornerSmoothing = node.cornerSmoothing; } catch {}
  }

  // Effects
  if ("effects" in node) {
    try { json.effects = serializeEffects(node.effects); } catch {}
  }

  // Opacity & blend
  if ("opacity" in node) try { json.opacity = node.opacity; } catch {}
  if ("blendMode" in node) try { json.blendMode = node.blendMode; } catch {}
  if ("isMask" in node) try { json.isMask = node.isMask; } catch {}
  if ("maskType" in node) try { json.maskType = node.maskType; } catch {}

  // Constraints
  if ("constraints" in node) {
    try { json.constraints = cloneJSON(node.constraints); } catch {}
  }

  // Clips content
  if ("clipsContent" in node) {
    try { json.clipsContent = node.clipsContent; } catch {}
  }

  // Auto-layout
  if ("layoutMode" in node) {
    try {
      json.layoutMode = node.layoutMode;
      if (node.layoutMode !== "NONE") {
        json.layoutSizingHorizontal = node.layoutSizingHorizontal;
        json.layoutSizingVertical = node.layoutSizingVertical;
        json.primaryAxisSizingMode = node.primaryAxisSizingMode;
        json.counterAxisSizingMode = node.counterAxisSizingMode;
        json.primaryAxisAlignItems = node.primaryAxisAlignItems;
        json.counterAxisAlignItems = node.counterAxisAlignItems;
        if (node.layoutWrap !== undefined) json.layoutWrap = node.layoutWrap;
        if (node.counterAxisSpacing !== undefined) json.counterAxisSpacing = node.counterAxisSpacing;
        json.itemSpacing = node.itemSpacing ?? 0;
        json.paddingLeft = node.paddingLeft ?? 0;
        json.paddingRight = node.paddingRight ?? 0;
        json.paddingTop = node.paddingTop ?? 0;
        json.paddingBottom = node.paddingBottom ?? 0;
      }
    } catch {}
  }

  // Layout positioning (child in auto-layout parent)
  if ("layoutPositioning" in node) try { json.layoutPositioning = node.layoutPositioning; } catch {}
  if ("layoutAlign" in node) try { json.layoutAlign = node.layoutAlign; } catch {}
  if ("layoutGrow" in node) try { json.layoutGrow = node.layoutGrow; } catch {}

  // Background (for frames/sections)
  if ("backgrounds" in node) {
    try { json.background = serializePaints(node.backgrounds); } catch {}
  }

  // TEXT
  if (node.type === "TEXT") {
    serializeText(node, json);
  }

  // VECTOR
  if (node.type === "VECTOR") {
    try {
      const vp = node.vectorPaths;
      if (vp && vp.length > 0) {
        json.fillGeometry = vp.map((v: any) => ({
          path: v.data,
          windingRule: v.windingRule ?? "NONZERO",
        }));
      }
    } catch {}
  }

  // Shape-specific
  switch (node.type) {
    case "ELLIPSE":
      try { if (node.arcData) json.arcData = cloneJSON(node.arcData); } catch {}
      break;
    case "POLYGON":
      try { if (node.pointCount) json.pointCount = node.pointCount; } catch {}
      break;
    case "STAR":
      try {
        if (node.pointCount) json.pointCount = node.pointCount;
        if (node.innerRadius !== undefined) json.innerRadius = node.innerRadius;
      } catch {}
      break;
    case "BOOLEAN_OPERATION":
      try { json.booleanOperation = node.booleanOperation; } catch {}
      break;
    case "SHAPE_WITH_TEXT":
      try {
        if ((node as ShapeWithTextNode).shapeType) json.shapeType = (node as ShapeWithTextNode).shapeType;
      } catch {}
      break;
  }

  // Children (recursive)
  if ("children" in node && Array.isArray(node.children)) {
    json.children = [];
    for (const child of node.children) {
      try {
        const childJson = serializeNode(child);
        if (childJson) json.children.push(childJson);
      } catch (err) {
        console.warn(`[serializeNode] failed to serialize "${child.name}":`, err);
      }
    }
  }

  return json;
}

/* ------------------------------------------------------------------ */
/*  exportJson – main export function                                  */
/* ------------------------------------------------------------------ */

/**
 * Export the current Figma Slides document as JSON_REST_V1.
 *
 * Strategy:
 *   1차: figma.root exportAsync (works for Design files)
 *   2차: page exportAsync (works for Design files)
 *   3차: Manual node-tree serialization (works for Slides!)
 *        Reads every node property directly from the Figma Plugin API
 *        and builds a JSON_REST_V1-compatible structure.
 */
// Build a {liveId → sourceId} map by walking the current page's node tree
// (synchronous; nodes are already loaded after loadAllPagesAsync). Used to
// rewrite ids in the exported JSON so output id == input id for imported
// nodes (stable cross-session identity for downstream diffing).
function buildSourceIdMap(): Map<string, string> {
  const map = new Map<string, string>();
  function walk(n: BaseNode): void {
    try {
      const sid = (n as any).getPluginData ? (n as any).getPluginData("sourceId") : "";
      if (sid) map.set(n.id, sid);
    } catch {}
    if ("children" in n && Array.isArray((n as any).children)) {
      for (const c of (n as any).children) walk(c);
    }
  }
  for (const c of figma.currentPage.children) walk(c);
  return map;
}

// Recursively overwrite each node-like dict's `id` with its sourceId (if
// the live node had one set via setPluginData on import). Mutates in place.
function applySourceIdOverride(json: any, map: Map<string, string>): void {
  if (Array.isArray(json)) {
    for (const it of json) applySourceIdOverride(it, map);
    return;
  }
  if (json && typeof json === "object") {
    if (typeof json.id === "string" && map.has(json.id)) {
      json.id = map.get(json.id)!;
    }
    for (const k of Object.keys(json)) {
      const v = json[k];
      if (v && typeof v === "object") applySourceIdOverride(v, map);
    }
  }
}

export async function exportJson() {
  await figma.loadAllPagesAsync();

  // Build map BEFORE export so any post-processing can resolve live id → sourceId.
  const sourceIdMap = buildSourceIdMap();
  console.log(`[exportJson] sourceId map size: ${sourceIdMap.size}`);

  const page = figma.currentPage;
  console.log(`[exportJson] Page: "${page.name}", children: ${page.children.length}`);
  for (let i = 0; i < page.children.length; i++) {
    const c = page.children[i];
    console.log(`  slide[${i}]: type=${c.type}, name="${c.name}", id=${c.id}, children=${"children" in c ? (c as any).children.length : "N/A"}`);
  }

  // File identification metadata
  const fileMeta = {
    fileName: figma.root.name,
    fileKey: (figma as any).fileKey ?? null,
  };

  // 1차: root (DocumentNode) export
  try {
    const rootJson = await (figma.root as any).exportAsync({
      format: "JSON_REST_V1",
    });
    const rootDoc = rootJson?.document;
    if (rootDoc) {
      const pages = rootDoc.children ?? [];
      const hasContent = pages.some((p: any) => (p.children ?? []).length > 0);
      if (hasContent) {
        console.log(`[exportJson] Root-level export succeeded (${pages.length} pages)`);
        applySourceIdOverride(rootJson, sourceIdMap);
        return { ...rootJson, ...fileMeta };
      }
    }
  } catch (err) {
    console.warn("[exportJson] Root-level export failed:", err);
  }

  // 2차: page export
  try {
    const pageJson = await page.exportAsync({ format: "JSON_REST_V1" });
    const pageChildren = pageJson?.document?.children ?? [];
    if (pageChildren.length > 0) {
      console.log(`[exportJson] Page-level export succeeded (${pageChildren.length} children)`);
      applySourceIdOverride(pageJson, sourceIdMap);
      return { ...pageJson, ...fileMeta };
    }
  } catch (err) {
    console.warn("[exportJson] Page-level export failed:", err);
  }

  // 3차: Manual serialization – walk the node tree directly
  console.log(`[exportJson] Using manual node-tree serialization...`);

  // Navigate the Figma Slides hierarchy: Page → SLIDE_GRID → SLIDE_ROW → SLIDE
  // Collect actual SLIDE nodes regardless of nesting depth.
  function collectSlides(node: any): any[] {
    const CONTAINER_TYPES = ['SLIDE_GRID', 'SLIDE_ROW'];
    if (node.type === 'SLIDE') return [node];
    if (CONTAINER_TYPES.includes(node.type) && 'children' in node) {
      const slides: any[] = [];
      for (const child of (node as any).children) {
        slides.push(...collectSlides(child));
      }
      return slides;
    }
    return [node]; // Non-slide top-level nodes (e.g. plain FRAMEs)
  }

  const actualSlides: any[] = [];
  for (const topChild of page.children) {
    actualSlides.push(...collectSlides(topChild));
  }

  console.log(`[exportJson] Found ${actualSlides.length} actual slide(s)`);

  const slideFrames: any[] = [];
  let totalChildren = 0;

  for (const slide of actualSlides) {
    const slideChildren: any[] = ("children" in slide) ? (slide as any).children : [];
    console.log(`  Slide "${slide.name}" (type=${slide.type}): ${slideChildren.length} children`);

    // Serialize each child inside the slide
    const childJsons: any[] = [];
    for (const child of slideChildren) {
      try {
        const childJson = serializeNode(child);
        if (childJson) {
          childJsons.push(childJson);
          totalChildren++;
        }
      } catch (err) {
        console.warn(`  Failed to serialize child "${child.name}":`, err);
      }
    }

    // Strip absoluteBoundingBox / absoluteRenderBounds from children.
    // Models confuse these slide-level absolute coords with the parent-relative
    // coords that move_node expects (relativeTransform).  Removing them forces
    // the model to use relativeTransform for positioning.
    function stripAbsBBox(json: any): void {
      delete json.absoluteBoundingBox;
      delete json.absoluteRenderBounds;
      if (Array.isArray(json.children)) {
        for (const c of json.children) stripAbsBBox(c);
      }
    }
    for (const cj of childJsons) stripAbsBBox(cj);

    // Represent the slide as a FRAME (SlideNode → FRAME conversion).
    // Prefer sourceId so output id matches the input id from import_json.
    let slideExportId: string = slide.id;
    try {
      const sid = (slide as any).getPluginData ? (slide as any).getPluginData("sourceId") : "";
      if (sid) slideExportId = sid;
    } catch {}
    const slideFrame: any = {
      id: slideExportId,
      name: slide.name,
      type: "FRAME",
      scrollBehavior: "SCROLLS",
      children: childJsons,
      absoluteBoundingBox: { x: 0, y: 0, width: 1920, height: 1080 },
      absoluteRenderBounds: { x: 0, y: 0, width: 1920, height: 1080 },
      constraints: { vertical: "TOP", horizontal: "LEFT" },
      clipsContent: true,
      background: [],
      fills: [],
      strokes: [],
      strokeWeight: 0,
      strokeAlign: "INSIDE",
      effects: [],
    };

    // Slide dimensions
    try {
      const w = (slide as any).width;
      const h = (slide as any).height;
      if (w && h) {
        slideFrame.absoluteBoundingBox = { x: 0, y: 0, width: w, height: h };
        slideFrame.absoluteRenderBounds = { x: 0, y: 0, width: w, height: h };
        slideFrame.size = { x: w, y: h };
      }
    } catch {}

    // Slide background fills
    try {
      const fills = (slide as any).fills;
      if (fills && Array.isArray(fills)) {
        slideFrame.fills = serializePaints(fills);
      }
    } catch {}

    // Slide-level strokes (border applied directly on the slide/frame, e.g.
    // via set_stroke). Without this the hardcoded `strokes: []` / `strokeWeight: 0`
    // above silently drop slide borders that DO render, making the export
    // disagree with the rendered image.
    try {
      const strokes = (slide as any).strokes;
      if (strokes && strokes !== figma.mixed && Array.isArray(strokes)) {
        slideFrame.strokes = serializePaints(strokes);
      }
      const sw = (slide as any).strokeWeight;
      if (sw != null && sw !== figma.mixed) slideFrame.strokeWeight = sw;
      const sa = (slide as any).strokeAlign;
      if (sa) slideFrame.strokeAlign = sa;
    } catch {}

    slideFrames.push(slideFrame);
  }

  // Try to get background color from page
  let bgColor = { r: 0.118, g: 0.118, b: 0.118, a: 1 };
  try {
    const pageBg = (page as any).backgrounds;
    if (pageBg && pageBg.length > 0 && pageBg[0].color) {
      bgColor = { r: pageBg[0].color.r, g: pageBg[0].color.g, b: pageBg[0].color.b, a: pageBg[0].opacity ?? 1 };
    }
  } catch {}

  console.log(`[exportJson] Manual serialization: ${slideFrames.length} slides, ${totalChildren} total children`);

  // Produce standard JSON_REST_V1 format: document (DOCUMENT) → page (CANVAS) → slides (FRAMEs)
  return {
    ...fileMeta,
    document: {
      id: figma.root.id,
      name: figma.root.name,
      type: "DOCUMENT",
      children: [
        {
          id: page.id,
          name: page.name,
          type: "CANVAS",
          scrollBehavior: "SCROLLS",
          children: slideFrames,
          backgroundColor: bgColor,
          prototypeStartNodeID: null,
          flowStartingPoints: [],
          prototypeDevice: { type: "NONE", rotation: "NONE" },
        },
      ],
    },
    components: {},
    componentSets: {},
    schemaVersion: 0,
    styles: {},
  };
}

/* ------------------------------------------------------------------ */
/*  importJson – unchanged                                             */
/* ------------------------------------------------------------------ */

/**
 * Import a JSON_REST_V1 document into Figma Slides.
 *
 * The JSON originates from Figma Design export (slides appear as FRAME/SECTION).
 * For each top-level child in the JSON we:
 *   1. Create a new SlideNode
 *   2. Apply basic properties (name, fills/background) from the JSON frame
 *   3. Recursively create all children inside the slide using bridge.createNode()
 */
export async function importJson(params: { jsonString: string; imageData?: Record<string, string>; slideIndicesToImport?: number[] }) {
  // Clear previous ID mapping so subsequent commands resolve fresh IDs
  nodeIdMap.clear();
  imageHashMap.clear();
  imagePaintStats.total = 0;
  imagePaintStats.resolved = 0;
  imagePaintStats.unresolved = 0;
  imagePaintStats.refs = [];
  resetImportLogs();

  const { jsonString, imageData } = params ?? {};
  if (!jsonString) {
    throw new Error('No "jsonString" param supplied');
  }

  // Base64 decoder (atob is NOT available in Figma plugin sandbox)
  function decodeBase64(b64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

    let len = b64.length;
    // Strip padding
    while (len > 0 && b64[len - 1] === '=') len--;

    const outLen = (len * 3) >> 2;
    const bytes = new Uint8Array(outLen);
    let p = 0;
    for (let i = 0; i < len; i += 4) {
      const a = lookup[b64.charCodeAt(i)];
      const b = i + 1 < len ? lookup[b64.charCodeAt(i + 1)] : 0;
      const c = i + 2 < len ? lookup[b64.charCodeAt(i + 2)] : 0;
      const d = i + 3 < len ? lookup[b64.charCodeAt(i + 3)] : 0;
      bytes[p++] = (a << 2) | (b >> 4);
      if (i + 2 < len) bytes[p++] = ((b & 0xf) << 4) | (c >> 2);
      if (i + 3 < len) bytes[p++] = ((c & 0x3) << 6) | d;
    }
    return bytes;
  }

  // Register pre-downloaded images if provided
  // imageData: { [imageRef]: base64_encoded_png_bytes }
  const imageErrors: string[] = [];
  if (imageData && typeof imageData === 'object') {
    for (const [ref, b64] of Object.entries(imageData)) {
      try {
        const b64Str = typeof b64 === 'string' ? b64 : String(b64);
        console.log(`[importJson] Decoding image ${ref}: b64 length=${b64Str.length}`);
        const raw = decodeBase64(b64Str);
        console.log(`[importJson] Decoded ${ref}: ${raw.length} bytes, PNG header=[${raw[0]},${raw[1]},${raw[2]},${raw[3]}]`);
        const img = figma.createImage(raw);
        imageHashMap.set(ref, img.hash);
        console.log(`[importJson] Registered image: ${ref} → ${img.hash}`);
      } catch (err) {
        const errMsg = `${ref}: ${err instanceof Error ? err.message : String(err)}`;
        imageErrors.push(errMsg);
        console.warn(`[importJson] Failed to register image ${ref}:`, err);
      }
    }
    console.log(`[importJson] ${imageHashMap.size}/${Object.keys(imageData).length} images registered`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    throw new Error(
      "[importJson] Invalid JSON – " + getErrorMessage(err)
    );
  }

  // Strip all boundVariables from the parsed JSON tree BEFORE creating nodes.
  // Figma Slides templates bind fills/colors to design-token variables (VARIABLE_ALIAS).
  // These VariableIDs don't exist in the import target, causing
  // "unsupported type in createVMObject: VARIABLE" on any property access/write.
  // The resolved colour values are already present in fills.color, so removing
  // boundVariables has no visual impact.
  function stripBoundVarsFromJson(obj: any): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) stripBoundVarsFromJson(item);
      return;
    }
    delete obj.boundVariables;
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object") stripBoundVarsFromJson(val);
    }
  }
  stripBoundVarsFromJson(parsed);

  // Split VECTOR nodes that use a multi-colour fillOverrideTable into
  // per-path sibling VECTOR nodes. Figma REST API encodes per-region colours
  // by tagging each fillGeometry entry with an `overrideID` that indexes into
  // `fillOverrideTable` for its actual paint. The plugin's VectorNode API
  // only supports a single `fills` array per node, so without this pass every
  // path would be rendered with the default `fills[0]` colour — collapsing
  // multi-colour shapes (e.g. national flags built as a single VECTOR) into a
  // monochrome blob. Case 44's Zambia flag is the canonical failure mode.
  function splitMultiFillVectors(obj: any): void {
    if (!obj || typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const item of obj) splitMultiFillVectors(item);
      return;
    }
    if (Array.isArray(obj.children) && obj.children.length) {
      const newChildren: any[] = [];
      for (const child of obj.children) {
        splitMultiFillVectors(child); // depth-first
        const split = trySplitVectorByOverride(child);
        if (split) newChildren.push(...split);
        else newChildren.push(child);
      }
      obj.children = newChildren;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "children") continue;
      if (v && typeof v === "object") splitMultiFillVectors(v);
    }
  }

  function trySplitVectorByOverride(node: any): any[] | null {
    if (!node || node.type !== "VECTOR") return null;
    const fot = node.fillOverrideTable;
    const fg = node.fillGeometry;
    if (!fot || typeof fot !== "object") return null;
    if (!Array.isArray(fg) || fg.length === 0) return null;

    const defaultFills = Array.isArray(node.fills) && node.fills.length ? node.fills : [];

    // Resolve per-path fills.
    const perPathFills: any[][] = [];
    let distinctOverrides = 0;
    for (const g of fg) {
      const oid = g.overrideID;
      const ovEntry = oid != null ? fot[String(oid)] : null;
      if (ovEntry && Array.isArray(ovEntry.fills) && ovEntry.fills.length) {
        perPathFills.push(ovEntry.fills);
        distinctOverrides++;
      } else {
        perPathFills.push(defaultFills);
      }
    }
    if (distinctOverrides === 0) return null; // nothing to split

    // Parent's bbox in the slide's absolute coordinate system. Each path's
    // local coords (0..size.x, 0..size.y) sit on top of this bbox. When we
    // split into sibling VectorNodes, each child must report its own (smaller)
    // bbox/size so Figma's vector-path normalisation doesn't collapse it.
    const pbb = node.absoluteBoundingBox || {};
    const pSize = node.size || {};
    const pX = typeof pbb.x === "number" ? pbb.x : 0;
    const pY = typeof pbb.y === "number" ? pbb.y : 0;
    const pW = typeof pbb.width === "number" ? pbb.width : pSize.x;
    const pH = typeof pbb.height === "number" ? pbb.height : pSize.y;

    function pathBBox(d: string): { x: number; y: number; w: number; h: number } | null {
      // Extract numeric x,y pairs out of the SVG path. Good enough for
      // axis-aligned bbox; control points of curves are also numbers so the
      // resulting bbox is a slight overestimate which still renders correctly.
      const nums = d.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
      if (!nums || nums.length < 4) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = parseFloat(nums[i]);
        const y = parseFloat(nums[i + 1]);
        if (!isFinite(x) || !isFinite(y)) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      if (!isFinite(minX)) return null;
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function translatePath(d: string, dx: number, dy: number): string {
      // Translate the SVG path by (-dx, -dy). Implemented by walking the
      // command stream and shifting every coordinate pair. Handles standard
      // absolute commands M/L/C/Q/T/S/A/Z and lowercase relative commands
      // (which we leave alone — only absolute coords need translation).
      let out = "";
      let i = 0;
      let cmd = "";
      while (i < d.length) {
        const ch = d[i];
        if (/[a-zA-Z]/.test(ch)) {
          cmd = ch;
          out += ch;
          i++;
          continue;
        }
        if (/[\s,]/.test(ch)) {
          out += ch;
          i++;
          continue;
        }
        // Read a number (and an optional following number for the pair)
        const numRe = /-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/y;
        numRe.lastIndex = i;
        const m1 = numRe.exec(d);
        if (!m1) { out += d[i]; i++; continue; }
        i = numRe.lastIndex;
        // Skip whitespace/comma between coord pair
        while (i < d.length && /[\s,]/.test(d[i])) { out += d[i]; i++; }
        numRe.lastIndex = i;
        const m2 = numRe.exec(d);
        if (!m2) { out += m1[0]; continue; }
        const x = parseFloat(m1[0]);
        const y = parseFloat(m2[0]);
        i = numRe.lastIndex;
        const isAbs = !!cmd && cmd === cmd.toUpperCase() && cmd !== "Z";
        if (isAbs) {
          // For absolute commands, subtract the bbox offset so coords start at 0.
          // Arc commands (A) have 7 numbers per segment where only the last 2 are
          // x,y; we approximate by translating every pair, which is wrong for
          // the radii — but axis-aligned flag paths in this dataset don't use
          // arcs, so this is safe in practice.
          out += `${(x - dx).toFixed(4)} ${(y - dy).toFixed(4)}`;
        } else {
          out += `${m1[0]} ${m2[0]}`;
        }
      }
      return out;
    }

    // Pre-extracted parent metadata to clone selectively (skip per-path props
    // we override below: size / bbox / transform / fills / fillGeometry).
    const baseProps: Record<string, any> = {};
    for (const key of [
      "constraints",
      "blendMode",
      "opacity",
      "visible",
      "effects",
      "strokeWeight",
      "strokeAlign",
      "strokes",
      "strokeGeometry",
      "complexStrokeProperties",
    ]) {
      if (key in node) baseProps[key] = node[key];
    }

    return fg.map((g: any, i: number) => {
      const bb = pathBBox(g.path || "");
      let childX = pX, childY = pY, childW = pW, childH = pH;
      let translatedPath = g.path;
      if (bb && bb.w > 0 && bb.h > 0) {
        childX = pX + bb.x;
        childY = pY + bb.y;
        childW = bb.w;
        childH = bb.h;
        translatedPath = translatePath(g.path, bb.x, bb.y);
      }
      // Important: do NOT set relativeTransform here. The plugin's
      // applyTransform reads relativeTransform AS PARENT-RELATIVE; if we wrote
      // slide-absolute translation we'd offset the child by parent_x/y twice
      // (or it'd disappear off-canvas). Leaving relativeTransform out lets
      // applyTransform fall through to the absoluteBoundingBox branch which
      // correctly subtracts the parent's bbox.x/y to position the child.
      return {
        ...baseProps,
        id: `${node.id ?? "vec"}_split_${i}`,
        name: `${node.name ?? "Vector"}_${i}`,
        type: "VECTOR",
        fills: perPathFills[i],
        fillGeometry: [{
          path: translatedPath,
          windingRule: g.windingRule,
        }],
        absoluteBoundingBox: {
          x: childX,
          y: childY,
          width: childW,
          height: childH,
        },
        size: { x: childW, y: childH },
      };
    });
  }
  splitMultiFillVectors(parsed);

  // Validate structure and find the page node containing slides.
  // Handles both:
  //   1. Standard REST API: document (DOCUMENT) → children[0] (CANVAS/page) → children (slides)
  //   2. Legacy/direct:     document (CANVAS) → children (slides)
  if (!parsed?.document?.children || !Array.isArray(parsed.document.children)) {
    throw new Error("[importJson] document.children not found");
  }

  let pageNode: any;
  if (parsed.document.type === "DOCUMENT") {
    // Standard format: document wraps page(s)
    pageNode = parsed.document.children[0];
  } else {
    // Direct format: document IS the page (type=CANVAS or similar)
    pageNode = parsed.document;
  }

  if (!pageNode?.children || !Array.isArray(pageNode.children)) {
    throw new Error("[importJson] No page children (slides) found in document");
  }

  // Navigate SLIDE_GRID/SLIDE_ROW/SLIDE/SECTION wrappers to find actual slide data.
  // Old plugin exports: CANVAS → FRAME "Presentation" → SLIDE_ROW → SLIDE → content
  // REST API exports:   DOCUMENT → CANVAS → SECTION → FRAME → content
  // New plugin exports: DOCUMENT → CANVAS → FRAME → content (clean)
  function extractSlideFrames(children: any[]): any[] {
    const CONTAINER_TYPES = ['SLIDE_GRID', 'SLIDE_ROW', 'SECTION'];
    const result: any[] = [];
    for (const child of children) {
      if (CONTAINER_TYPES.includes(child.type) && Array.isArray(child.children)) {
        // Known container/wrapper – recurse into children
        result.push(...extractSlideFrames(child.children));
      } else if (child.type === 'SLIDE' && Array.isArray(child.children)) {
        // SLIDE node – treat as a FRAME for import
        result.push({ ...child, type: 'FRAME' });
      } else if (
        child.type === 'FRAME' &&
        Array.isArray(child.children) &&
        child.children.some((c: any) =>
          CONTAINER_TYPES.includes(c.type) || c.type === 'SLIDE'
        )
      ) {
        // FRAME that wraps SLIDE containers (old plugin export) – unwrap
        result.push(...extractSlideFrames(child.children));
      } else {
        result.push(child);
      }
    }
    return result;
  }

  const slideJsons = extractSlideFrames(pageNode.children);

  const page = figma.currentPage;

  // Collect all existing SLIDE nodes for removal.
  // We traverse into SLIDE_GRID/SLIDE_ROW containers to find every SLIDE,
  // but we do NOT remove the containers themselves because figma.createSlide()
  // places new slides into the same SLIDE_GRID.
  // Non-container orphans (FRAME, SECTION, etc.) are handled separately.
  function collectExistingSlides(node: any): SceneNode[] {
    if (node.type === 'SLIDE') return [node];
    const result: SceneNode[] = [];
    if ('children' in node && Array.isArray((node as any).children)) {
      for (const child of (node as any).children) {
        result.push(...collectExistingSlides(child));
      }
    }
    return result;
  }
  const existingSlides: SceneNode[] = [];
  // Also snapshot non-SLIDE, non-container top-level children (orphan FRAMEs, etc.)
  const existingOrphans: SceneNode[] = [];
  const CONTAINER_TYPES_SET = new Set(['SLIDE_GRID', 'SLIDE_ROW']);
  for (const child of page.children) {
    existingSlides.push(...collectExistingSlides(child));
    if (!CONTAINER_TYPES_SET.has(child.type) && child.type !== 'SLIDE') {
      existingOrphans.push(child);
    }
  }

  const slideIds: string[] = [];

  // Selective import mode: only recreate slides at specified indices.
  // IMPORTANT: Selective mode requires existing slides on canvas to preserve.
  // If canvas is empty, fall back to full import.
  const indicesToImport = new Set(params.slideIndicesToImport ?? []);
  const requestedSelective = Array.isArray(params.slideIndicesToImport) && params.slideIndicesToImport.length > 0;
  const selectiveMode = requestedSelective && existingSlides.length > 0;
  if (requestedSelective && !selectiveMode) {
    console.log(`[importJson] Selective import requested but canvas is empty (${existingSlides.length} existing slides). Falling back to full import.`);
  }
  if (selectiveMode) {
    console.log(`[importJson] Selective import mode: importing slides at indices [${[...indicesToImport]}] out of ${slideJsons.length} total (${existingSlides.length} existing slides)`);
  }

  // Helper to recursively map JSON node IDs → live node IDs for skipped slides
  function mapExistingNodeIds(jsonNode: any, liveNode: any): void {
    if (jsonNode.id && liveNode.id) {
      nodeIdMap.set(jsonNode.id, liveNode.id);
    }
    const jc: any[] = jsonNode.children ?? [];
    const lc: any[] = 'children' in liveNode ? Array.from((liveNode as any).children) : [];
    if (jc.length === 0 || lc.length === 0) return;

    if (jc.length === lc.length) {
      for (let i = 0; i < jc.length; i++) {
        mapExistingNodeIds(jc[i], lc[i]);
      }
      return;
    }
    // Fallback: match by name+type, then positional
    const usedLive = new Set<number>();
    const matchedJson = new Set<number>();
    for (let ji = 0; ji < jc.length; ji++) {
      for (let li = 0; li < lc.length; li++) {
        if (usedLive.has(li)) continue;
        if (jc[ji].name && lc[li].name === jc[ji].name && jc[ji].type === lc[li].type) {
          usedLive.add(li); matchedJson.add(ji);
          mapExistingNodeIds(jc[ji], lc[li]);
          break;
        }
      }
    }
    const remJ = jc.map((_: any, i: number) => i).filter((i: number) => !matchedJson.has(i));
    const remL = lc.map((_: any, i: number) => i).filter((i: number) => !usedLive.has(i));
    for (let k = 0; k < Math.min(remJ.length, remL.length); k++) {
      mapExistingNodeIds(jc[remJ[k]], lc[remL[k]]);
    }
  }

  for (let slideIdx = 0; slideIdx < slideJsons.length; slideIdx++) {
    const slideJson = slideJsons[slideIdx];

    // In selective mode, skip slides not in the import list — keep existing live node
    if (selectiveMode && !indicesToImport.has(slideIdx)) {
      if (slideIdx < existingSlides.length) {
        const existingSlide = existingSlides[slideIdx];
        console.log(`[importJson] Keeping existing slide ${slideIdx} (id=${existingSlide.id}, name="${existingSlide.name}")`);
        // Map JSON IDs → existing live node IDs so subsequent commands work
        mapExistingNodeIds(slideJson, existingSlide);
        slideIds.push(existingSlide.id);
      } else {
        console.warn(`[importJson] Selective skip slide ${slideIdx} but no existing slide at that index`);
      }
      continue;
    }

    // Create a new SlideNode for each top-level FRAME/SECTION in the JSON
    const slide = figma.createSlide();
    slide.name = slideJson.name ?? "Imported Slide";

    // Newly created slides inherit the file's default design-token variable
    // bindings (fills/strokes/effects bound to VARIABLE_ALIAS), which cause
    // "unsupported type in createVMObject: VARIABLE" on subsequent property
    // reads (focus_slide, replace_color, etc.). Strip them up-front so all
    // downstream commands operate on resolved values. (Case 98 motivation.)
    try {
      const bv = (slide as any).boundVariables;
      if (bv) {
        for (const field of Object.keys(bv)) {
          try { (slide as any).setBoundVariable(field, null); } catch {}
        }
      }
    } catch {
      // boundVariables itself can throw on slides — fall back to overwriting
      // fills/strokes/effects with cloned plain values to break the binding.
      try {
        const fills = (slide as any).fills;
        if (fills && fills !== figma.mixed && Array.isArray(fills)) {
          (slide as any).fills = fills.map((f: any) => ({ ...f }));
        }
      } catch {}
      try {
        const strokes = (slide as any).strokes;
        if (strokes && Array.isArray(strokes)) {
          (slide as any).strokes = strokes.map((s: any) => ({ ...s }));
        }
      } catch {}
      try {
        const effects = (slide as any).effects;
        if (effects && Array.isArray(effects)) {
          (slide as any).effects = effects.map((e: any) => ({ ...e }));
        }
      } catch {}
    }

    // Track old→new slide ID mapping (slides bypass createNode, so map manually)
    if (slideJson.id) {
      nodeIdMap.set(slideJson.id, slide.id);
      // Persist input id as sourceId on the SLIDE so export can report it
      // (same pattern as createNode in bridge.ts).
      try { (slide as any).setPluginData("sourceId", String(slideJson.id)); } catch {}
    }

    // Ensure the SlideNode has no auto-layout so children can be freely positioned.
    // figma.createSlide() may default to auto-layout which overrides child positions.
    try {
      if ('layoutMode' in slide) {
        (slide as any).layoutMode = slideJson.layoutMode ?? 'NONE';
      }
    } catch (err) {
      console.warn("[importJson] Could not set slide layoutMode:", err);
    }

    // Apply clipsContent from JSON
    try {
      if ('clipsContent' in slide && slideJson.clipsContent !== undefined) {
        (slide as any).clipsContent = slideJson.clipsContent;
      }
    } catch {}

    // Apply background/fills if present (supports SOLID, GRADIENT_*, and IMAGE)
    try {
      if (Array.isArray(slideJson.fills) && slideJson.fills.length > 0) {
        const paints = slideJson.fills
          .map((f: any) => formatPaint(f))
          .filter(Boolean) as Paint[];
        if (paints.length > 0) {
          (slide as any).fills = paints;
        }
      } else if (slideJson.backgroundColor) {
        const { r, g, b, a } = slideJson.backgroundColor;
        (slide as any).fills = [
          { type: "SOLID", color: { r, g, b }, opacity: a ?? 1 },
        ];
      }
    } catch (err) {
      console.warn("[importJson] Could not apply slide background:", err);
    }

    // Create children inside the slide
    if (Array.isArray(slideJson.children)) {
      for (const childJson of slideJson.children) {
        try {
          const childNode = await createNode(childJson, slide, slideJson);
          if (childNode) {
            slide.appendChild(childNode);

            // Re-apply position after appending (auto-layout may override during appendChild)
            if (
              Array.isArray(childJson.relativeTransform) &&
              childJson.relativeTransform.length === 2 &&
              'relativeTransform' in childNode
            ) {
              try {
                const M = childJson.relativeTransform;
                const target: Transform = [
                  [M[0][0], M[0][1], M[0][2]],
                  [M[1][0], M[1][1], M[1][2]],
                ];
                const hasRotation = Math.abs(M[0][1]) > 0.001 || Math.abs(M[1][0]) > 0.001;
                if (hasRotation) {
                  console.log(`[importJson] Re-applying ROTATED transform for "${childJson.name}" (${childJson.type}): tx=${M[0][2].toFixed(1)} ty=${M[1][2].toFixed(1)} cos=${M[0][0].toFixed(4)} sin=${M[0][1].toFixed(4)}`);
                }
                (childNode as any).relativeTransform = target;
                if (hasRotation) {
                  // Verify the transform was applied
                  const actual = (childNode as any).relativeTransform;
                  console.log(`[importJson] After re-apply: tx=${actual[0][2].toFixed(1)} ty=${actual[1][2].toFixed(1)} cos=${actual[0][0].toFixed(4)} sin=${actual[0][1].toFixed(4)}`);
                }
              } catch (e) {
                console.warn(`[importJson] ⚠️ Re-apply relativeTransform FAILED for "${childJson.name}" (${childJson.type}): ${e instanceof Error ? e.message : e}`);
              }
            }
          }
        } catch (err) {
          console.warn(
            `[importJson] Failed to create child "${childJson.name}":`,
            getErrorMessage(err)
          );
        }
      }
    }

    slideIds.push(slide.id);
  }

  // Remove old SLIDE nodes (safe because new slides exist).
  const newSlideIdSetPreStab = new Set(slideIds);
  for (const oldSlide of existingSlides) {
    if (newSlideIdSetPreStab.has(oldSlide.id)) continue;
    try {
      oldSlide.remove();
    } catch (err) {
      console.warn("[importJson] Could not remove old slide:", getErrorMessage(err));
    }
  }
  // Remove orphan top-level nodes (FRAME, SECTION, etc.) that are not containers
  // In selective mode, skip orphan removal to preserve unrelated content
  if (!selectiveMode) {
    for (const orphan of existingOrphans) {
      try {
        orphan.remove();
      } catch (err) {
        console.warn("[importJson] Could not remove orphan:", getErrorMessage(err));
      }
    }
  }

  // ====================================================================
  // POST-IMPORT STABILIZATION
  // Figma Slides may restructure the node tree after creation, assigning
  // new IDs to all nodes. We (1) yield to let restructuring complete,
  // (2) rebuild nodeIdMap from the live tree, (3) re-apply IMAGE fills
  // to restore bitmap linkage.
  // ====================================================================

  // Step 1: Yield to Figma to let internal restructuring complete
  await figma.loadAllPagesAsync();

  // Step 2: Find fresh slides and rebuild nodeIdMap by parallel tree walk
  const freshSlides: any[] = [];
  function findFreshSlides(node: any) {
    if (node.type === 'SLIDE') { freshSlides.push(node); return; }
    if ('children' in node) {
      for (const child of (node as any).children) findFreshSlides(child);
    }
  }
  findFreshSlides(page);

  let remapCount = 0;
  function rebuildMapping(jsonNode: any, liveNode: any): void {
    if (jsonNode.id) {
      const prev = nodeIdMap.get(jsonNode.id);
      nodeIdMap.set(jsonNode.id, liveNode.id);
      if (prev && prev !== liveNode.id) remapCount++;
    }
    const jc: any[] = jsonNode.children ?? [];
    const lc: any[] = 'children' in liveNode ? Array.from((liveNode as any).children) : [];

    if (jc.length === 0 || lc.length === 0) return;

    // Fast path: if counts match, use direct index alignment
    if (jc.length === lc.length) {
      for (let i = 0; i < jc.length; i++) {
        rebuildMapping(jc[i], lc[i]);
      }
      return;
    }

    // Slow path: counts differ (Figma restructured children).
    // Match by name+type first, then by name only, then leftover by position.
    const usedLive = new Set<number>();
    const matchedJson = new Set<number>();

    // Pass 1: exact name+type match
    for (let ji = 0; ji < jc.length; ji++) {
      for (let li = 0; li < lc.length; li++) {
        if (usedLive.has(li)) continue;
        if (jc[ji].name && lc[li].name === jc[ji].name && jc[ji].type === lc[li].type) {
          usedLive.add(li);
          matchedJson.add(ji);
          rebuildMapping(jc[ji], lc[li]);
          break;
        }
      }
    }

    // Pass 2: name-only match for remaining
    for (let ji = 0; ji < jc.length; ji++) {
      if (matchedJson.has(ji)) continue;
      for (let li = 0; li < lc.length; li++) {
        if (usedLive.has(li)) continue;
        if (jc[ji].name && lc[li].name === jc[ji].name) {
          usedLive.add(li);
          matchedJson.add(ji);
          rebuildMapping(jc[ji], lc[li]);
          break;
        }
      }
    }

    // Pass 3: positional fallback for remaining unmatched
    const remainingJson = jc.map((_: any, i: number) => i).filter((i: number) => !matchedJson.has(i));
    const remainingLive = lc.map((_: any, i: number) => i).filter((i: number) => !usedLive.has(i));
    for (let k = 0; k < Math.min(remainingJson.length, remainingLive.length); k++) {
      rebuildMapping(jc[remainingJson[k]], lc[remainingLive[k]]);
    }
  }

  slideIds.length = 0;
  for (let i = 0; i < Math.min(slideJsons.length, freshSlides.length); i++) {
    rebuildMapping(slideJsons[i], freshSlides[i]);
    slideIds.push(freshSlides[i].id);
  }

  if (remapCount > 0) {
    console.log(`[importJson] Stabilization: remapped ${remapCount} stale node ID(s)`);
  }

  // Remove surplus slides that Figma may have auto-created during stabilization.
  // We only keep the first slideJsons.length slides; anything beyond is a ghost.
  if (freshSlides.length > slideJsons.length) {
    const surplus = freshSlides.slice(slideJsons.length);
    console.warn(`[importJson] Removing ${surplus.length} surplus slide(s) created during stabilization`);
    for (const extra of surplus) {
      try {
        extra.remove();
      } catch (err) {
        console.warn(`[importJson] Could not remove surplus slide "${extra.name}":`, getErrorMessage(err));
      }
    }
  }

  // Step 3: Re-apply IMAGE fills from JSON source data.
  // IMAGE fills set on orphan nodes (before appendChild) are silently dropped
  // by Figma Slides. Now that nodes are in the document tree, re-apply from
  // the original JSON using formatPaint + imageHashMap.
  let imgFixCount = 0;
  let imgFixFailed = 0;
  function reapplyImagesFromJson(jsonNode: any, liveNode: any): void {
    // Re-apply fills from JSON if the JSON has IMAGE fills
    if (jsonNode.type !== 'TEXT' && Array.isArray(jsonNode.fills) && 'fills' in liveNode) {
      const hasJsonImage = jsonNode.fills.some((f: any) => f.type === 'IMAGE');
      if (hasJsonImage) {
        try {
          const paints = jsonNode.fills
            .map((f: any) => formatPaint(f))
            .filter((p: any) => p !== undefined);
          if (paints.length > 0) {
            console.log(`[reapplyImages] Applying ${paints.length} paint(s) to "${liveNode.name}" (${liveNode.type}, id=${liveNode.id}) — JSON: "${jsonNode.name}" (${jsonNode.type}, id=${jsonNode.id})`);
            (liveNode as any).fills = paints;
            // Verify readback
            const readBack = (liveNode as any).fills;
            const imgAfter = Array.isArray(readBack) ? readBack.filter((p: any) => p.type === 'IMAGE') : [];
            if (imgAfter.length > 0) {
              imgFixCount++;
              console.log(`[reapplyImages] OK: "${liveNode.name}" now has ${imgAfter.length} IMAGE fill(s), hash=${imgAfter.map((p: any) => p.imageHash).join(',')}`);
            } else {
              imgFixFailed++;
              console.warn(`[reapplyImages] FAILED: "${liveNode.name}" (${liveNode.type}, id=${liveNode.id}) — readback has 0 IMAGE fills (paints set: ${paints.length})`);
              imagePaintStats.refs.push(`REAPPLY_FAIL:${liveNode.name}(${liveNode.type})`);
            }
          }
        } catch (err) {
          imgFixFailed++;
          console.warn(`[reapplyImages] ERROR for "${jsonNode.name}":`, getErrorMessage(err));
          imagePaintStats.refs.push(`REAPPLY_ERR:${jsonNode.name}:${getErrorMessage(err)}`);
        }
      }
    }
    // Also re-apply existing IMAGE fills that may have survived (for bitmap re-linkage)
    if ('fills' in liveNode) {
      try {
        const fills = (liveNode as any).fills;
        if (fills && fills !== figma.mixed && Array.isArray(fills)) {
          if (fills.some((f: any) => f.type === 'IMAGE')) {
            (liveNode as any).fills = fills.map((f: any) => ({ ...f }));
          }
        }
      } catch {}
    }
    // Recurse into children — walk JSON and live trees in parallel
    const jc: any[] = jsonNode.children ?? [];
    const lc: any[] = 'children' in liveNode ? Array.from((liveNode as any).children) : [];
    if (jc.length > 0 && lc.length > 0) {
      if (jc.length === lc.length) {
        // Direct index alignment
        for (let i = 0; i < jc.length; i++) {
          reapplyImagesFromJson(jc[i], lc[i]);
        }
      } else {
        // Match by name+type, then positional fallback
        const usedLive = new Set<number>();
        const matchedJson = new Set<number>();
        for (let ji = 0; ji < jc.length; ji++) {
          for (let li = 0; li < lc.length; li++) {
            if (usedLive.has(li)) continue;
            if (jc[ji].name && lc[li].name === jc[ji].name && jc[ji].type === lc[li].type) {
              usedLive.add(li);
              matchedJson.add(ji);
              reapplyImagesFromJson(jc[ji], lc[li]);
              break;
            }
          }
        }
        const remJ = jc.map((_: any, i: number) => i).filter((i: number) => !matchedJson.has(i));
        const remL = lc.map((_: any, i: number) => i).filter((i: number) => !usedLive.has(i));
        for (let k = 0; k < Math.min(remJ.length, remL.length); k++) {
          reapplyImagesFromJson(jc[remJ[k]], lc[remL[k]]);
        }
      }
    }
  }
  // Walk each slide and its JSON counterpart in parallel
  const keptSlideIdSet = new Set(slideIds);
  for (let i = 0; i < Math.min(slideJsons.length, freshSlides.length); i++) {
    if (keptSlideIdSet.has(freshSlides[i].id)) {
      reapplyImagesFromJson(slideJsons[i], freshSlides[i]);
    }
  }

  if (imgFixCount > 0 || imgFixFailed > 0) {
    console.log(`[importJson] Stabilization: re-applied IMAGE fills on ${imgFixCount} node(s)${imgFixFailed > 0 ? `, ${imgFixFailed} failed` : ''}`);
  }

  // Step 4: Re-apply TEXT properties that Figma Slides restructuring may reset.
  // Known issues:
  //   - textAutoResize: WIDTH_AND_HEIGHT → HEIGHT (causes text wrapping on font changes)
  //   - listOptions / lineTypes: ORDERED/UNORDERED → lost (bullet/number markers disappear)
  // We walk JSON + live trees in parallel and re-apply these properties.
  let textFixCount = 0;
  function collectTextProps(jsonNode: any): Map<string, {
    lineTypes?: string[];
    lineIndentations?: number[];
    characters?: string;
  }> {
    const map = new Map<string, any>();
    function walk(node: any) {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'TEXT' && node.id) {
        const props: any = {};
        if (Array.isArray(node.lineTypes)) props.lineTypes = node.lineTypes;
        if (Array.isArray(node.lineIndentations)) props.lineIndentations = node.lineIndentations;
        if (node.characters) props.characters = node.characters;
        if (Object.keys(props).length > 0) map.set(node.id, props);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child);
      }
    }
    walk(jsonNode);
    return map;
  }
  // Build a combined map from all slide JSONs
  const textPropsMap = new Map<string, any>();
  for (const sj of slideJsons) {
    const m = collectTextProps(sj);
    for (const [id, props] of m) textPropsMap.set(id, props);
  }

  // Pre-compute sibling ORDERED list groups from the JSON structure.
  // After stabilization, the live tree may be restructured (nodes wrapped in
  // new containers), so we cannot rely on live sibling relationships.
  // Instead, detect groups in the original JSON where parent-child structure
  // is known, then map jsonId → 1-based ordinal number.
  const orderedNumberMap = new Map<string, number>(); // jsonId → 1-based number
  function findOrderedGroups(jsonNode: any) {
    if (!jsonNode || typeof jsonNode !== 'object') return;
    if (Array.isArray(jsonNode.children)) {
      const orderedKids: string[] = [];
      for (const child of jsonNode.children) {
        if (child.type !== 'TEXT' || !child.id) continue;
        if (!Array.isArray(child.lineTypes) || child.lineTypes.length === 0) continue;
        if (child.lineTypes[0] !== 'ORDERED') continue;
        const chars = child.characters ?? '';
        if (chars.length === 0 || chars.includes('\n')) continue;
        orderedKids.push(child.id);
      }
      if (orderedKids.length > 1) {
        for (let i = 0; i < orderedKids.length; i++) {
          orderedNumberMap.set(orderedKids[i], i + 1);
        }
      }
      for (const child of jsonNode.children) findOrderedGroups(child);
    }
  }
  for (const sj of slideJsons) findOrderedGroups(sj);
  if (orderedNumberMap.size > 0) {
    console.log(`[importJson] Found ${orderedNumberMap.size} ORDERED list items in ${Math.ceil(orderedNumberMap.size / 2)}+ sibling groups`);
  }

  async function reapplyTextProps(node: any): Promise<void> {
    if (node.type === 'TEXT') {
      // Find matching JSON props via nodeIdMap (reverse lookup: live id → json id)
      let jsonId: string | undefined;
      for (const [oldId, newId] of nodeIdMap) {
        if (newId === node.id) { jsonId = oldId; break; }
      }
      if (jsonId && textPropsMap.has(jsonId)) {
        const props = textPropsMap.get(jsonId)!;
        try {
          // Handle ORDERED list items that were siblings in the JSON.
          // Figma Plugin API cannot set a list start number, so when multiple
          // single-line ORDERED text nodes were siblings, each would show "1."
          // after re-applying ORDERED.  Instead, prepend literal "N. " text.
          if (orderedNumberMap.has(jsonId)) {
            const num = orderedNumberMap.get(jsonId)!;
            try {
              const fontAtStart = (node as TextNode).getRangeFontName(0, 1);
              if (fontAtStart && fontAtStart !== figma.mixed) {
                await figma.loadFontAsync(fontAtStart as FontName);
              } else if ((node as any).fontName && (node as any).fontName !== figma.mixed) {
                await figma.loadFontAsync((node as any).fontName as FontName);
              }
            } catch {}
            (node as TextNode).insertCharacters(0, `${num}. `);
            // Clear the ORDERED list formatting that was applied during initial
            // applyText and survived stabilization — otherwise Figma renders
            // both the auto-generated "1." AND our literal "N. ".
            const totalLen = (node as TextNode).characters.length;
            if (totalLen > 0) {
              try {
                (node as TextNode).setRangeListOptions(0, totalLen, { type: 'NONE' as any });
              } catch {}
            }
            textFixCount++;
            console.log(`[importJson] Prepended "${num}. " to "${node.name}" (jsonId=${jsonId})`);
          }
          // Regular list options re-application (for non-grouped ORDERED or UNORDERED)
          else if (Array.isArray(props.lineTypes) && props.lineTypes.some((t: string) => t !== 'NONE')) {
            const chars: string = (node as any).characters ?? '';
            if (chars.length > 0) {
              try {
                const fontName = (node as any).fontName;
                if (fontName && fontName !== figma.mixed) {
                  await figma.loadFontAsync(fontName);
                }
              } catch {}
              const lines = chars.split('\n');
              let charOffset = 0;
              for (let li = 0; li < lines.length && li < props.lineTypes.length; li++) {
                const lineStart = charOffset;
                const lineEnd = charOffset + lines[li].length;
                charOffset = lineEnd + 1;
                if (lineEnd <= lineStart) continue;
                const lt = props.lineTypes[li];
                if (lt && lt !== 'NONE') {
                  try {
                    (node as any).setRangeListOptions(lineStart, lineEnd, { type: lt });
                    textFixCount++;
                  } catch {}
                }
                const indent = props.lineIndentations?.[li] ?? 0;
                if (indent > 0) {
                  try {
                    (node as any).setRangeIndentation(lineStart, lineEnd, indent);
                  } catch {}
                }
              }
            }
          }
        } catch (e) {
          console.warn(`[importJson] reapplyTextProps failed for "${node.name}":`, e);
        }
      }
    }

    // --- Phase 3: Recurse into children ---
    if ('children' in node) {
      for (const child of (node as any).children) {
        await reapplyTextProps(child);
      }
    }
  }
  for (const slide of freshSlides) {
    if (keptSlideIdSet.has(slide.id)) await reapplyTextProps(slide);
  }
  if (textFixCount > 0) {
    console.log(`[importJson] Stabilization: re-applied ${textFixCount} TEXT property fix(es)`);
  }

  // Safety net: remove ANY page-root node that is not one of our imported
  // slides or their direct SLIDE_GRID/SLIDE_ROW container.  Previously we
  // kept SLIDE_CONTAINER_TYPES unconditionally, which let stale containers
  // (and the slides inside them) survive across imports.
  const newSlideIdSet = new Set(slideIds);
  // Also whitelist the immediate SLIDE_GRID / SLIDE_ROW parents of our slides
  const containerWhitelist = new Set<string>();
  for (const child of page.children) {
    if (['SLIDE_GRID', 'SLIDE_ROW'].includes(child.type) && 'children' in child) {
      const hasOurSlide = Array.from((child as any).children).some(
        (c: any) => newSlideIdSet.has(c.id) ||
          ('children' in c && Array.from((c as any).children).some((sc: any) => newSlideIdSet.has(sc.id)))
      );
      if (hasOurSlide) containerWhitelist.add(child.id);
    }
  }
  const orphans: SceneNode[] = [];
  for (const child of page.children) {
    if (!newSlideIdSet.has(child.id) && !containerWhitelist.has(child.id)) {
      orphans.push(child);
    }
  }
  if (orphans.length > 0) {
    console.warn(`[importJson] Removing ${orphans.length} orphan node(s) from page root`);
    for (const orphan of orphans) {
      try {
        orphan.remove();
      } catch (err) {
        console.warn(`[importJson] Could not remove orphan "${orphan.name}":`, getErrorMessage(err));
      }
    }
  }

  // Final diagnostic: dump state of all IMAGE-fill nodes across slides
  const imageDiag: any[] = [];
  function dumpImageNodes(node: any, slideIdx: number, depth: number) {
    if ('fills' in node) {
      try {
        const fills = (node as any).fills;
        if (fills && fills !== figma.mixed && Array.isArray(fills)) {
          const imgFills = fills.filter((f: any) => f.type === 'IMAGE');
          if (imgFills.length > 0) {
            const entry = {
              slide: slideIdx,
              depth,
              name: node.name,
              type: node.type,
              id: node.id,
              width: node.width,
              height: node.height,
              visible: node.visible,
              opacity: ('opacity' in node) ? (node as any).opacity : 'N/A',
              x: node.x,
              y: node.y,
              fillsCount: fills.length,
              imgFillsCount: imgFills.length,
              imgHashes: imgFills.map((f: any) => f.imageHash ?? 'null'),
              imgScaleModes: imgFills.map((f: any) => f.scaleMode ?? 'null'),
              imgOpacities: imgFills.map((f: any) => f.opacity ?? 'null'),
              imgVisible: imgFills.map((f: any) => f.visible ?? 'null'),
              parentName: node.parent?.name ?? 'null',
              parentType: node.parent?.type ?? 'null',
            };
            imageDiag.push(entry);
            console.log(`[imageDiag] slide=${slideIdx} depth=${depth} "${node.name}" (${node.type}, id=${node.id}) ${node.width}x${node.height} at (${node.x},${node.y}) visible=${node.visible} opacity=${('opacity' in node) ? (node as any).opacity : '?'} fills=${fills.length} imgFills=${imgFills.length} hashes=[${imgFills.map((f: any) => (f.imageHash ?? 'null').substring(0, 12)).join(',')}] parent="${node.parent?.name}" (${node.parent?.type})`);
          }
        }
      } catch {}
    }
    if ('children' in node) {
      try {
        for (const child of (node as any).children) {
          dumpImageNodes(child, slideIdx, depth + 1);
        }
      } catch {}
    }
  }
  for (let si = 0; si < freshSlides.length; si++) {
    dumpImageNodes(freshSlides[si], si, 0);
  }

  // Build serialisable ID mapping for debugging / external use
  const idMapping: Record<string, string> = {};
  for (const [oldId, newId] of nodeIdMap) {
    idMapping[oldId] = newId;
  }
  console.log(`[importJson] ID mapping: ${nodeIdMap.size} entries`);

  return {
    success: true,
    slideIds,
    slideCount: slideIds.length,
    nodeIdMap: idMapping,
    imagesRegistered: imageHashMap.size,
    imageHashMapEntries: Object.fromEntries(imageHashMap),
    imageDataReceived: !!(imageData && Object.keys(imageData).length > 0),
    imageDataKeys: imageData ? Object.keys(imageData).length : 0,
    imageErrors: imageErrors.length > 0 ? imageErrors : undefined,
    imagePaintStats: { ...imagePaintStats, refs: imagePaintStats.refs.slice(0, 30) },
    imgFixCount,
    imgFixFailed,
    imageDiag,
    importLogs: importLogs.slice(0, 2000),
    message: `Imported ${slideIds.length} slide(s) successfully, ${nodeIdMap.size} node IDs mapped, ${imageHashMap.size} images registered, IMAGE fills: ${imagePaintStats.total} total (${imagePaintStats.resolved} resolved, ${imagePaintStats.unresolved} unresolved), reapply: ${imgFixCount} ok / ${imgFixFailed} failed`,
  };
}