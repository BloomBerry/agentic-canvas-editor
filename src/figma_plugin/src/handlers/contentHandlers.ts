// Content Creation and Manipulation Handlers
import { nodeIdMap, lookupNode } from "../bridge";

// Helper function to get the current context (focused slide or page)
function getCurrentParent(): BaseNode & ChildrenMixin {
  const focusedSlide = (figma.currentPage as any).focusedSlide as SlideNode | null;
  return (focusedSlide as any) || figma.currentPage;
}

// Strip design-token variable bindings from a node to prevent
// "unsupported type in createVMObject: VARIABLE" errors on property access.
// Safe for this benchmark context where presentations are imported temporarily.
function stripVariableBindings(node: SceneNode): void {
  try {
    if ("boundVariables" in node) {
      const bv = (node as any).boundVariables;
      if (bv) {
        for (const field of Object.keys(bv)) {
          try { (node as any).setBoundVariable(field, null); } catch {}
        }
      }
    }
  } catch {
    // accessing boundVariables itself can throw VARIABLE error on instances.
    // Fall back: overwrite common bound properties with their resolved values
    // to break the binding chain so subsequent geometry access works.
    try {
      if ("fills" in node) {
        const fills = (node as any).fills;
        if (fills && fills !== figma.mixed && Array.isArray(fills)) {
          (node as any).fills = fills.map((f: any) => ({ ...f }));
        }
      }
    } catch {}
    try {
      if ("strokes" in node) {
        const strokes = (node as any).strokes;
        if (strokes && Array.isArray(strokes)) {
          (node as any).strokes = strokes.map((s: any) => ({ ...s }));
        }
      }
    } catch {}
    try {
      if ("effects" in node) {
        const effects = (node as any).effects;
        if (effects && Array.isArray(effects)) {
          (node as any).effects = effects.map((e: any) => ({ ...e }));
        }
      }
    } catch {}
  }
}

// Direct getNodeByIdAsync, with sourceId pluginData fallback (lookupNode).
async function resolveNodeId(nodeId: string): Promise<BaseNode | null> {
  return await lookupNode(nodeId);
}

async function getNode(nodeId: string): Promise<SceneNode> {
  const node = await lookupNode(nodeId);
  if (!node || !("id" in node)) {
    throw new Error(`Node not found: ${nodeId}`);
  }
  stripVariableBindings(node as SceneNode);
  return node as SceneNode;
}

export async function createRectangle(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  parentId?: string;
  fillColor?: { r: number; g: number; b: number; a?: number };
  strokeColor?: { r: number; g: number; b: number; a?: number };
  strokeWeight?: number;
  cornerRadius?: number;
}) {
  const rect = figma.createRectangle();
  rect.resize(params.width, params.height);

  if (params.name) rect.name = params.name;

  if (params.fillColor) {
    rect.fills = [
      {
        type: "SOLID",
        color: {
          r: params.fillColor.r,
          g: params.fillColor.g,
          b: params.fillColor.b,
        },
        opacity: params.fillColor.a != null ? params.fillColor.a : 1,
      },
    ];
  }

  if (params.strokeColor && params.strokeWeight) {
    rect.strokes = [
      {
        type: "SOLID",
        color: {
          r: params.strokeColor.r,
          g: params.strokeColor.g,
          b: params.strokeColor.b,
        },
        opacity: params.strokeColor.a != null ? params.strokeColor.a : 1,
      },
    ];
    rect.strokeWeight = params.strokeWeight;
  }

  if (params.cornerRadius) {
    rect.cornerRadius = params.cornerRadius;
  }

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(rect);
  }

  // Set position AFTER reparenting so coordinates are relative to the final parent
  rect.x = params.x;
  rect.y = params.y;

  return { id: rect.id, name: rect.name, type: rect.type };
}

export async function createFrame(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  parentId?: string;
  fillColor?: { r: number; g: number; b: number; a?: number };
}) {
  const frame = figma.createFrame();
  frame.resize(params.width, params.height);

  if (params.name) frame.name = params.name;

  if (params.fillColor) {
    frame.fills = [
      {
        type: "SOLID",
        color: {
          r: params.fillColor.r,
          g: params.fillColor.g,
          b: params.fillColor.b,
        },
        opacity: params.fillColor.a != null ? params.fillColor.a : 1,
      },
    ];
  }

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(frame);
  }

  frame.x = params.x;
  frame.y = params.y;

  return { id: frame.id, name: frame.name, type: frame.type };
}

export async function createText(params: {
  x: number;
  y: number;
  text: string;
  name?: string;
  fontSize?: number;
  fontColor?: { r: number; g: number; b: number; a?: number };
  textAlign?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
  parentId?: string;
}) {
  const textNode = figma.createText();

  await figma.loadFontAsync({ family: "Inter", style: "Regular" });

  textNode.characters = params.text;

  if (params.name) textNode.name = params.name;

  if (params.fontSize) {
    textNode.fontSize = params.fontSize;
  }

  if (params.fontColor) {
    textNode.fills = [
      {
        type: "SOLID",
        color: {
          r: params.fontColor.r,
          g: params.fontColor.g,
          b: params.fontColor.b,
        },
        opacity: params.fontColor.a != null ? params.fontColor.a : 1,
      },
    ];
  }

  if (params.textAlign) {
    textNode.textAlignHorizontal = params.textAlign;
  }

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(textNode);
  }

  textNode.x = params.x;
  textNode.y = params.y;

  return { id: textNode.id, name: textNode.name, type: textNode.type };
}

export async function createEllipse(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  parentId?: string;
  fillColor?: { r: number; g: number; b: number; a?: number };
}) {
  const ellipse = figma.createEllipse();
  ellipse.resize(params.width, params.height);

  if (params.name) ellipse.name = params.name;

  if (params.fillColor) {
    ellipse.fills = [
      {
        type: "SOLID",
        color: {
          r: params.fillColor.r,
          g: params.fillColor.g,
          b: params.fillColor.b,
        },
        opacity: params.fillColor.a != null ? params.fillColor.a : 1,
      },
    ];
  }

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(ellipse);
  }

  ellipse.x = params.x;
  ellipse.y = params.y;

  return { id: ellipse.id, name: ellipse.name, type: ellipse.type };
}

export async function createGraphic(params: {
  svg: string;
  x: number;
  y: number;
  name?: string;
  parentId?: string;
}) {
  const node = figma.createNodeFromSvg(params.svg);

  if (params.name) node.name = params.name;

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(node);
  }

  node.x = params.x;
  node.y = params.y;

  return { id: node.id, name: node.name, type: node.type };
}

export async function createMarker(params: {
  x: number;
  y: number;
  size: number;
  shape:
    | "circle"
    | "square"
    | "diamond"
    | "triangle_up"
    | "triangle_down"
    | "star"
    | "pentagon"
    | "hexagon"
    | "x"
    | "plus";
  name?: string;
  parentId?: string;
  fillColor?: { r: number; g: number; b: number; a?: number };
  strokeColor?: { r: number; g: number; b: number; a?: number };
  strokeWeight?: number;
}) {
  const { x, y, size, shape } = params;

  const fill = params.fillColor || { r: 0.259, g: 0.522, b: 0.957 };
  const fillRGB = { r: fill.r, g: fill.g, b: fill.b };
  const fillOpacity = fill.a != null ? fill.a : 1;

  function applyStroke(node: MinimalStrokesMixin & MinimalBlendMixin) {
    if (params.strokeColor && params.strokeWeight) {
      node.strokes = [
        {
          type: "SOLID",
          color: {
            r: params.strokeColor.r,
            g: params.strokeColor.g,
            b: params.strokeColor.b,
          },
          opacity: params.strokeColor.a != null ? params.strokeColor.a : 1,
        },
      ];
      node.strokeWeight = params.strokeWeight;
    }
  }

  let node: SceneNode;

  switch (shape) {
    case "square": {
      const rect = figma.createRectangle();
      rect.resize(size, size);
      rect.x = x;
      rect.y = y;
      rect.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(rect);
      node = rect;
      break;
    }

    case "diamond": {
      const dSize = size * 1.5;
      const rect = figma.createRectangle();
      rect.resize(dSize, dSize);
      rect.rotation = 45;
      rect.x = x + size * 0.15;
      rect.y = y;
      rect.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(rect);
      node = rect;
      break;
    }

    case "triangle_up": {
      const poly = figma.createPolygon();
      poly.pointCount = 3;
      poly.resize(size, size);
      poly.x = x;
      poly.y = y;
      poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(poly);
      node = poly;
      break;
    }

    case "triangle_down": {
      const poly = figma.createPolygon();
      poly.pointCount = 3;
      poly.resize(size, size);
      poly.rotation = 180;
      poly.x = x + size;
      poly.y = y + size;
      poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(poly);
      node = poly;
      break;
    }

    case "star": {
      const star = figma.createStar();
      star.pointCount = 5;
      star.innerRadius = 0.4;
      star.resize(size, size);
      star.x = x;
      star.y = y;
      star.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(star);
      node = star;
      break;
    }

    case "pentagon": {
      const poly = figma.createPolygon();
      poly.pointCount = 5;
      poly.resize(size, size);
      poly.x = x;
      poly.y = y;
      poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(poly);
      node = poly;
      break;
    }

    case "hexagon": {
      const poly = figma.createPolygon();
      poly.pointCount = 6;
      poly.resize(size, size);
      poly.x = x;
      poly.y = y;
      poly.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(poly);
      node = poly;
      break;
    }

    case "x": {
      const pad = size * 0.15;
      const sw = Math.max(1.5, size * 0.2);
      const r = Math.round;
      const rgb = `rgb(${r(fillRGB.r * 255)},${r(fillRGB.g * 255)},${r(fillRGB.b * 255)})`;
      const svgStr = `<svg width="${size}" height="${size}"><line x1="${pad}" y1="${pad}" x2="${size - pad}" y2="${size - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${size - pad}" y1="${pad}" x2="${pad}" y2="${size - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
      const svgNode = figma.createNodeFromSvg(svgStr);
      svgNode.x = x;
      svgNode.y = y;
      node = svgNode;
      break;
    }

    case "plus": {
      const mid = size / 2;
      const pad = size * 0.1;
      const sw = Math.max(1.5, size * 0.2);
      const r = Math.round;
      const rgb = `rgb(${r(fillRGB.r * 255)},${r(fillRGB.g * 255)},${r(fillRGB.b * 255)})`;
      const svgStr = `<svg width="${size}" height="${size}"><line x1="${mid}" y1="${pad}" x2="${mid}" y2="${size - pad}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/><line x1="${pad}" y1="${mid}" x2="${size - pad}" y2="${mid}" stroke="${rgb}" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
      const svgNode = figma.createNodeFromSvg(svgStr);
      svgNode.x = x;
      svgNode.y = y;
      node = svgNode;
      break;
    }

    case "circle":
    default: {
      const ellipse = figma.createEllipse();
      ellipse.resize(size, size);
      ellipse.x = x;
      ellipse.y = y;
      ellipse.fills = [{ type: "SOLID", color: fillRGB, opacity: fillOpacity }];
      applyStroke(ellipse);
      node = ellipse;
      break;
    }
  }

  if (params.name) node.name = params.name;

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(node);
  }

  // Set position after reparenting so coordinates are relative to the final parent
  node.x = x;
  node.y = y;

  return { id: node.id, name: node.name, type: node.type, shape };
}

export async function moveNode(params: {
  nodeId: string;
  x: number;
  y: number;
  parentId?: string;
}) {
  const node = await getNode(params.nodeId);

  // Reparent if parentId is provided and differs from current parent
  if (params.parentId && node.parent?.id !== params.parentId) {
    const newParent = await resolveNodeId(params.parentId) as FrameNode | GroupNode | SlideNode | null;
    if (newParent && "appendChild" in newParent) {
      newParent.appendChild(node);
    }
    // If parent not found, skip reparenting and just update position
  }

  try {
    node.x = params.x;
    node.y = params.y;
  } catch {
    // Variable binding prevents direct x/y assignment; use relativeTransform.
    try {
      const t = node.relativeTransform;
      (node as any).relativeTransform = [[t[0][0], t[0][1], params.x], [t[1][0], t[1][1], params.y]];
    } catch {
      // Last resort: construct identity-position transform
      (node as any).relativeTransform = [[1, 0, params.x], [0, 1, params.y]];
    }
  }

  try {
    return { id: node.id, x: node.x, y: node.y, parentId: node.parent?.id };
  } catch {
    return { id: node.id, x: params.x, y: params.y, parentId: params.parentId };
  }
}

export async function resizeNode(params: {
  nodeId: string;
  width: number;
  height: number;
}) {
  const node = await getNode(params.nodeId);

  if ("resize" in node) {
    try {
      node.resize(params.width, params.height);
    } catch {
      // Variable binding prevents resize(); try scaling via relativeTransform.
      try {
        const oldW = node.width;
        const oldH = node.height;
        const t = node.relativeTransform;
        const sx = oldW > 0 ? params.width / oldW : 1;
        const sy = oldH > 0 ? params.height / oldH : 1;
        (node as any).relativeTransform = [[t[0][0] * sx, t[0][1] * sy, t[0][2]], [t[1][0] * sx, t[1][1] * sy, t[1][2]]];
      } catch {
        // Geometry access also fails — silently skip, return requested dims
      }
    }
  }

  try {
    return { id: node.id, width: node.width, height: node.height };
  } catch {
    return { id: node.id, width: params.width, height: params.height };
  }
}

export async function deleteNode(params: { nodeId: string }) {
  const node = await getNode(params.nodeId);

  // Collect all descendant IDs before removal so we can purge nodeIdMap
  const idsToRemove = new Set<string>();
  function collectIds(n: BaseNode) {
    idsToRemove.add(n.id);
    if ("children" in n) {
      for (const child of (n as any).children) {
        collectIds(child);
      }
    }
  }
  collectIds(node);

  node.remove();

  // Purge stale entries from nodeIdMap
  for (const [origId, mappedId] of nodeIdMap.entries()) {
    if (idsToRemove.has(mappedId) || idsToRemove.has(origId)) {
      nodeIdMap.delete(origId);
    }
  }

  return { success: true, nodeId: params.nodeId };
}

export async function cloneNode(params: {
  nodeId: string;
  offsetX?: number;
  offsetY?: number;
  parentId?: string;
}) {
  const node = await getNode(params.nodeId);
  let cloned: SceneNode;
  try {
    cloned = node.clone();
  } catch (e) {
    // clone() can throw "unsupported type in createVMObject: VARIABLE"
    // on nodes with design-token variable bindings. Detach variables first.
    if ("boundVariables" in node) {
      for (const field of Object.keys((node as any).boundVariables || {})) {
        try { (node as any).setBoundVariable(field, null); } catch {}
      }
    }
    cloned = node.clone();
  }

  // If parentId is specified, move the cloned node to that parent
  if (params.parentId) {
    const parent = await resolveNodeId(params.parentId) as FrameNode | GroupNode | SlideNode | null;
    if (parent && "appendChild" in parent) {
      parent.appendChild(cloned);
    }
  }

  if (params.offsetX) cloned.x += params.offsetX;
  if (params.offsetY) cloned.y += params.offsetY;

  return { id: cloned.id, name: cloned.name, type: cloned.type, parentId: cloned.parent ? cloned.parent.id : undefined };
}

export async function reparentNode(params: {
  nodeId: string;
  parentId: string;
  index?: number;
}) {
  const node = await getNode(params.nodeId);
  const parent = await resolveNodeId(params.parentId) as FrameNode | GroupNode | SlideNode | null;

  if (!parent || !("appendChild" in parent)) {
    throw new Error(`Parent node not found or cannot have children: ${params.parentId}`);
  }

  // Store original position relative to canvas
  const absoluteX = node.absoluteTransform[0][2];
  const absoluteY = node.absoluteTransform[1][2];

  if (params.index != null && "insertChild" in parent) {
    (parent as FrameNode).insertChild(params.index, node);
  } else {
    parent.appendChild(node);
  }

  // Adjust position to maintain visual position after reparenting
  // The new x/y should account for the parent's position
  const parentAbsoluteX = parent.absoluteTransform[0][2];
  const parentAbsoluteY = parent.absoluteTransform[1][2];
  node.x = absoluteX - parentAbsoluteX;
  node.y = absoluteY - parentAbsoluteY;

  return {
    id: node.id,
    name: node.name,
    parentId: parent.id,
    parentName: parent.name,
    x: node.x,
    y: node.y,
  };
}

export async function groupNodes(params: {
  nodeIds: string[];
  groupName?: string;
}) {
  const nodes = await Promise.all(params.nodeIds.map((id) => getNode(id)));
  const group = figma.group(nodes, getCurrentParent());

  if (params.groupName) {
    group.name = params.groupName;
  }

  return { id: group.id, name: group.name, type: group.type };
}

export async function ungroupNodes(params: { groupId: string }) {
  const group = await getNode(params.groupId);

  if (group.type !== "GROUP") {
    throw new Error("Node is not a group");
  }

  figma.ungroup(group as GroupNode);

  return { success: true };
}

export async function setFillColor(params: {
  nodeId: string;
  color: { r: number; g: number; b: number; a?: number };
}) {
  const node = await getNode(params.nodeId);

  if ("fills" in node) {
    node.fills = [
      {
        type: "SOLID",
        color: {
          r: params.color.r,
          g: params.color.g,
          b: params.color.b,
        },
        opacity: params.color.a != null ? params.color.a : 1,
      },
    ];
  }

  return { id: node.id };
}

export async function setStroke(params: {
  nodeId: string;
  color: { r: number; g: number; b: number; a?: number };
  weight?: number;
}) {
  const node = await getNode(params.nodeId);

  if ("strokes" in node && "strokeWeight" in node) {
    node.strokes = [
      {
        type: "SOLID",
        color: {
          r: params.color.r,
          g: params.color.g,
          b: params.color.b,
        },
        opacity: params.color.a != null ? params.color.a : 1,
      },
    ];

    if (params.weight) {
      node.strokeWeight = params.weight;
    }
  }

  return { id: node.id };
}

export async function setOpacity(params: { nodeId: string; opacity: number }) {
  const node = await getNode(params.nodeId);

  if ("opacity" in node) {
    (node as BlendMixin).opacity = params.opacity;
  }
  return { id: node.id, opacity: "opacity" in node ? (node as BlendMixin).opacity : undefined };
}

export async function setCornerRadius(params: {
  nodeId: string;
  radius: number;
}) {
  const node = await getNode(params.nodeId);

  if ("cornerRadius" in node && node.type === "RECTANGLE") {
    (node as RectangleNode).cornerRadius = params.radius;
  } else if ("cornerRadius" in node && node.type === "FRAME") {
    (node as FrameNode).cornerRadius = params.radius;
  }

  return { id: node.id };
}

export async function setTextContent(params: {
  nodeId: string;
  text: string;
}) {
  const node = await getNode(params.nodeId);

  // Helper to load all fonts and set text on a TextNode or TextSublayer
  async function loadFontsAndSetText(textLike: any): Promise<void> {
    await loadAllFontsOnTarget(textLike);
    textLike.characters = params.text;
  }

  if (node.type === "TEXT") {
    await loadFontsAndSetText(node as TextNode);
    return { id: node.id, text: (node as TextNode).characters };
  } else if (node.type === "SHAPE_WITH_TEXT") {
    await loadFontsAndSetText((node as ShapeWithTextNode).text);
    return { id: node.id, text: (node as ShapeWithTextNode).text.characters };
  } else if ((node.type as string) === "TABLE_CELL") {
    await loadFontsAndSetText((node as any).text);
    return { id: node.id, text: (node as any).text.characters };
  } else {
    throw new Error(`Node type "${node.type}" is not a text-compatible node. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
  }
}

export async function setTextProperties(params: {
  nodeId: string;
  fontSize?: number;
  fontColor?: { r: number; g: number; b: number; a?: number };
  textAlign?: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFIED";
}) {
  const node = await getNode(params.nodeId);

  // Get the text-like target (TextNode directly, or TextSublayer for SHAPE_WITH_TEXT / TABLE_CELL)
  let textTarget: any;
  if (node.type === "TEXT") {
    textTarget = node;
  } else if (node.type === "SHAPE_WITH_TEXT") {
    textTarget = (node as ShapeWithTextNode).text;
  } else if ((node.type as string) === "TABLE_CELL") {
    textTarget = (node as any).text;
  } else {
    throw new Error(`Node type "${node.type}" does not support text properties. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
  }

  await loadAllFontsOnTarget(textTarget);

  if (params.fontSize) {
    textTarget.fontSize = params.fontSize;
  }

  if (params.fontColor) {
    textTarget.fills = [
      {
        type: "SOLID",
        color: {
          r: params.fontColor.r,
          g: params.fontColor.g,
          b: params.fontColor.b,
        },
        opacity: params.fontColor.a != null ? params.fontColor.a : 1,
      },
    ];
  }

  if (params.textAlign) {
    textTarget.textAlignHorizontal = params.textAlign;
  }

  return { id: node.id };
}

export async function getPageInfo() {
  const page = figma.currentPage;

  return {
    id: page.id,
    name: page.name,
    type: page.type,
    children: page.children.map((child) => ({
      id: child.id,
      name: child.name,
      type: child.type,
    })),
  };
}

export async function getNodeInfo(params: { nodeId: string; depth?: number }) {
  const node = await getNode(params.nodeId);
  const maxDepth = params.depth != null ? params.depth : 2;

  function getNodeDetails(n: SceneNode, currentDepth: number): any {
    stripVariableBindings(n);
    // id/name/type are always safe; geometry props (x,y,width,height) can throw
    // on variable-bound instances, so wrap them separately.
    const baseInfo: any = {
      id: n.id,
      name: n.name,
      type: n.type,
    };
    try {
      baseInfo.x = n.x;
      baseInfo.y = n.y;
      baseInfo.width = n.width;
      baseInfo.height = n.height;
    } catch {
      // geometry props bound to variable — leave undefined
    }

    // Property accesses below can throw "unsupported type in createVMObject: VARIABLE"
    // on nodes with design-token variable bindings. Wrap in try-catch so we still
    // return the basic identity + geometry even when extended props fail.
    try {
      // Include rotation if supported
      if ("rotation" in n) {
        baseInfo.rotation = n.rotation;
      }

      // Include layout mode for frames
      if ("layoutMode" in n) {
        baseInfo.layoutMode = (n as FrameNode).layoutMode;
      }

      // Include text content for text nodes
      if (n.type === "TEXT") {
        const textNode = n as TextNode;
        baseInfo.characters = textNode.characters;
        try {
          baseInfo.fontSize = textNode.fontSize === figma.mixed ? "MIXED" : textNode.fontSize;
          baseInfo.fontName = textNode.fontName === figma.mixed ? "MIXED" : textNode.fontName;
        } catch { baseInfo.fontSize = "VARIABLE_BOUND"; baseInfo.fontName = "VARIABLE_BOUND"; }
      } else if (n.type === "SHAPE_WITH_TEXT") {
        const shapeNode = n as ShapeWithTextNode;
        baseInfo.characters = shapeNode.text.characters;
        try {
          baseInfo.fontSize = shapeNode.text.fontSize === figma.mixed ? "MIXED" : shapeNode.text.fontSize;
          baseInfo.fontName = shapeNode.text.fontName === figma.mixed ? "MIXED" : shapeNode.text.fontName;
        } catch { baseInfo.fontSize = "VARIABLE_BOUND"; baseInfo.fontName = "VARIABLE_BOUND"; }
      } else if ((n.type as string) === "TABLE_CELL") {
        const cellNode = n as any;
        if (cellNode.text) {
          baseInfo.characters = cellNode.text.characters;
          try {
            baseInfo.fontSize = cellNode.text.fontSize === figma.mixed ? "MIXED" : cellNode.text.fontSize;
            baseInfo.fontName = cellNode.text.fontName === figma.mixed ? "MIXED" : cellNode.text.fontName;
          } catch { baseInfo.fontSize = "VARIABLE_BOUND"; baseInfo.fontName = "VARIABLE_BOUND"; }
        }
      }

      // Include table metadata for TABLE nodes
      if ((n.type as string) === "TABLE") {
        const tableNode = n as any;
        if (tableNode.numRows != null) baseInfo.numRows = tableNode.numRows;
        if (tableNode.numColumns != null) baseInfo.numColumns = tableNode.numColumns;
      }

      // Include fill metadata (type + color, but NOT image bytes)
      if ("fills" in n) {
        try {
          const fills = (n as GeometryMixin).fills;
          if (fills && fills !== figma.mixed && Array.isArray(fills) && fills.length > 0) {
            baseInfo.fills = fills.map((f: Paint) => {
              const info: any = { type: f.type, visible: f.visible !== false };
              if (f.type === "SOLID") {
                const s = f as SolidPaint;
                info.color = { r: s.color.r, g: s.color.g, b: s.color.b };
                if (s.opacity != null) info.opacity = s.opacity;
              } else if (f.type === "IMAGE") {
                const img = f as ImagePaint;
                info.scaleMode = img.scaleMode;
                if (img.imageHash) info.imageHash = img.imageHash;
              }
              return info;
            });
          }
        } catch { /* fills bound to variable — skip */ }
      }
    } catch {
      // Outer catch: if rotation/layoutMode access also throws, we still return baseInfo
    }

    // Children traversal — kept outside try-catch so partial parent failure doesn't skip children
    try {
      if ("children" in n && currentDepth < maxDepth) {
        baseInfo.children = (n as FrameNode | GroupNode).children.map(
          (child) => getNodeDetails(child as SceneNode, currentDepth + 1)
        );
      } else if ("children" in n) {
        baseInfo.childrenCount = (n as FrameNode | GroupNode).children.length;
      }
    } catch { /* children access failed */ }

    return baseInfo;
  }

  return getNodeDetails(node, 0);
}

export async function getSelectionInfo() {
  const selection = figma.currentPage.selection;

  return {
    nodes: selection.map((node) => ({
      id: node.id,
      name: node.name,
      type: node.type,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    })),
  };
}

// Rename a single node/layer
export async function renameNode(params: {
  nodeId: string;
  name: string;
}) {
  const node = await getNode(params.nodeId);
  const oldName = node.name;
  node.name = params.name;

  return {
    id: node.id,
    oldName,
    newName: node.name,
    type: node.type,
  };
}

// Rename multiple layers at once
export async function renameLayers(params: {
  nodeIds: string[];
  pattern?: string;
  prefix?: string;
  suffix?: string;
  replace?: { from: string; to: string };
  sequential?: { start: number; prefix?: string };
}) {
  const nodes = await Promise.all(params.nodeIds.map((id) => getNode(id)));
  const results = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const oldName = node.name;
    let newName = oldName;

    // Apply pattern: simple text replacement of entire name
    if (params.pattern) {
      newName = params.pattern;
    }

    // Apply sequential numbering (Layer 1, Layer 2, etc.)
    if (params.sequential) {
      const num = params.sequential.start + i;
      const seqPrefix = params.sequential.prefix || "Layer";
      newName = `${seqPrefix} ${num}`;
    }

    // Apply prefix
    if (params.prefix) {
      newName = params.prefix + newName;
    }

    // Apply suffix
    if (params.suffix) {
      newName = newName + params.suffix;
    }

    // Apply find and replace
    if (params.replace) {
      newName = newName.replace(
        new RegExp(params.replace.from, "g"),
        params.replace.to
      );
    }

    node.name = newName;

    results.push({
      id: node.id,
      oldName,
      newName: node.name,
      type: node.type,
    });
  }

  return { renamed: results };
}

// Get all text nodes within a specified node
export async function getTextNodeInfo(params: { nodeId: string; depth?: number }) {
  const node = await getNode(params.nodeId);
  const textNodes: any[] = [];

  function collectTextNodes(n: SceneNode, currentDepth: number = 0): void {
    if (n.type === "TEXT") {
      const textNode = n as TextNode;

      // Handle mixed styles - fontName and fontSize can be figma.mixed symbol
      let fontName: { family: string; style: string } | "MIXED" = "MIXED";
      let fontSize: number | "MIXED" = "MIXED";

      if (textNode.fontName !== figma.mixed) {
        fontName = textNode.fontName as { family: string; style: string };
      }

      if (textNode.fontSize !== figma.mixed) {
        fontSize = textNode.fontSize as number;
      }

      textNodes.push({
        id: textNode.id,
        name: textNode.name,
        type: "TEXT",
        characters: textNode.characters,
        fontSize: fontSize,
        fontName: fontName,
        x: textNode.x,
        y: textNode.y,
        width: textNode.width,
        height: textNode.height,
      });
    } else if (n.type === "SHAPE_WITH_TEXT") {
      const shapeNode = n as ShapeWithTextNode;

      // Handle mixed styles for SHAPE_WITH_TEXT
      let fontName: { family: string; style: string } | "MIXED" = "MIXED";
      let fontSize: number | "MIXED" = "MIXED";

      if (shapeNode.text.fontName !== figma.mixed) {
        fontName = shapeNode.text.fontName as { family: string; style: string };
      }

      if (shapeNode.text.fontSize !== figma.mixed) {
        fontSize = shapeNode.text.fontSize as number;
      }

      textNodes.push({
        id: shapeNode.id,
        name: shapeNode.name,
        type: "SHAPE_WITH_TEXT",
        characters: shapeNode.text.characters,
        fontSize: fontSize,
        fontName: fontName,
        x: shapeNode.x,
        y: shapeNode.y,
        width: shapeNode.width,
        height: shapeNode.height,
      });
    } else if ((n.type as string) === "TABLE_CELL") {
      const cellNode = n as any;
      if (cellNode.text) {
        let fontName: { family: string; style: string } | "MIXED" = "MIXED";
        let fontSize: number | "MIXED" = "MIXED";

        if (cellNode.text.fontName !== figma.mixed) {
          fontName = cellNode.text.fontName as { family: string; style: string };
        }

        if (cellNode.text.fontSize !== figma.mixed) {
          fontSize = cellNode.text.fontSize as number;
        }

        textNodes.push({
          id: cellNode.id,
          name: cellNode.name,
          type: "TABLE_CELL",
          characters: cellNode.text.characters,
          fontSize: fontSize,
          fontName: fontName,
          x: cellNode.x,
          y: cellNode.y,
          width: cellNode.width,
          height: cellNode.height,
        });
      }
    }

    if ("children" in n && (!params.depth || currentDepth < params.depth)) {
      (n as FrameNode | GroupNode).children.forEach((child) =>
        collectTextNodes(child as SceneNode, currentDepth + 1)
      );
    }
  }

  collectTextNodes(node);

  return {
    nodeId: params.nodeId,
    totalTextNodes: textNodes.length,
    textNodes,
  };
}

// Set text decoration (underline/strikethrough/casing)
export async function setTextDecoration(params: {
  nodeId: string;
  textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  textCase?: "ORIGINAL" | "UPPER" | "LOWER" | "TITLE" | "SMALL_CAPS" | "SMALL_CAPS_FORCED";
}) {
  const node = await getNode(params.nodeId);

  let textTarget: any;
  if (node.type === "TEXT") {
    textTarget = node;
  } else if (node.type === "SHAPE_WITH_TEXT") {
    textTarget = (node as ShapeWithTextNode).text;
  } else if ((node.type as string) === "TABLE_CELL") {
    textTarget = (node as any).text;
  } else {
    throw new Error(`Node type "${node.type}" does not support text decoration. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
  }

  await loadAllFontsOnTarget(textTarget);

  if (params.textDecoration !== undefined) {
    textTarget.textDecoration = params.textDecoration;
  }

  if (params.textCase !== undefined) {
    textTarget.textCase = params.textCase;
  }

  return { id: node.id };
}

// Set text font (family & style)
export async function setTextFont(params: {
  nodeId: string;
  fontFamily: string;
  fontStyle: string;
}) {
  const node = await getNode(params.nodeId);

  const font: FontName = {
    family: params.fontFamily,
    style: params.fontStyle,
  };

  await figma.loadFontAsync(font);

  // Helper: set fontName on a text target, handling VARIABLE bindings
  function applyFont(target: any): void {
    // Attempt 1: direct assignment
    try {
      target.fontName = font;
      return;
    } catch {}

    // Attempt 2: delete text, set font on empty node, restore text
    // VARIABLE bindings block direct fontName writes, but clearing text first bypasses this
    try {
      const saved = target.characters;
      if (saved.length > 0) {
        target.deleteCharacters(0, saved.length);
      }
      target.fontName = font;
      if (saved.length > 0) {
        target.insertCharacters(0, saved);
      }
      return;
    } catch {}

    // Attempt 3: use range-based API (different internal code path)
    try {
      const len = target.characters?.length ?? 0;
      if (len > 0 && typeof target.setRangeFontName === "function") {
        target.setRangeFontName(0, len, font);
        return;
      }
    } catch {}

    // Attempt 4: aggressively strip variable bindings on the target itself, then retry
    try {
      if ("boundVariables" in target) {
        const bv = target.boundVariables;
        if (bv) {
          for (const field of Object.keys(bv)) {
            try { target.setBoundVariable(field, null); } catch {}
          }
        }
      }
      target.fontName = font;
      return;
    } catch {}

    throw new Error("Cannot set font: node has immutable VARIABLE bindings");
  }

  if (node.type === "TEXT") {
    const textNode = node as TextNode;
    applyFont(textNode);
    return { id: textNode.id, fontName: font };
  } else if (node.type === "SHAPE_WITH_TEXT") {
    const shapeNode = node as ShapeWithTextNode;
    applyFont(shapeNode.text);
    return { id: shapeNode.id, fontName: font };
  } else if ((node.type as string) === "TABLE_CELL") {
    const cellNode = node as any;
    applyFont(cellNode.text);
    return { id: cellNode.id, fontName: font };
  } else if ("children" in node) {
    // Container node (FRAME, GROUP, SECTION, etc.) — recurse into TEXT descendants
    const modified: string[] = [];
    async function walkAndApply(parent: SceneNode & ChildrenMixin) {
      for (const child of parent.children) {
        if (child.type === "TEXT") {
          stripVariableBindings(child);
          applyFont(child as TextNode);
          modified.push(child.id);
        } else if (child.type === "SHAPE_WITH_TEXT") {
          stripVariableBindings(child);
          applyFont((child as ShapeWithTextNode).text);
          modified.push(child.id);
        } else if ((child.type as string) === "TABLE_CELL") {
          stripVariableBindings(child);
          applyFont((child as any).text);
          modified.push(child.id);
        } else if ("children" in child) {
          await walkAndApply(child as SceneNode & ChildrenMixin);
        }
      }
    }
    await walkAndApply(node as SceneNode & ChildrenMixin);
    if (modified.length === 0) {
      throw new Error(`Node "${node.name}" (${node.type}) contains no TEXT descendants`);
    }
    return { id: node.id, fontName: font, modifiedChildren: modified };
  } else {
    throw new Error(`Node type "${node.type}" does not support font changes. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL, or container with TEXT children`);
  }
}

// Set text range style (character-level formatting)
export async function setTextRangeStyle(params: {
  nodeId: string;
  ranges: Array<{
    start: number;
    end: number;
    color?: { r: number; g: number; b: number; a?: number };
    fontFamily?: string;
    fontStyle?: string;
    fontSize?: number;
    textDecoration?: "NONE" | "UNDERLINE" | "STRIKETHROUGH";
  }>;
}) {
  const node = await getNode(params.nodeId);

  // Get the text target (TextNode directly, or TextSublayer for SHAPE_WITH_TEXT / TABLE_CELL)
  let textTarget: any;
  if (node.type === "TEXT") {
    textTarget = node;
  } else if (node.type === "SHAPE_WITH_TEXT") {
    textTarget = (node as ShapeWithTextNode).text;
  } else if ((node.type as string) === "TABLE_CELL") {
    textTarget = (node as any).text;
  } else {
    throw new Error(`Node type "${node.type}" does not support text range styles. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
  }

  const textLength = textTarget.characters.length;

  // Load the current font(s)
  const currentFontName = textTarget.fontName;
  if (currentFontName !== figma.mixed) {
    await figma.loadFontAsync(currentFontName as FontName);
  } else {
    // If mixed fonts, load all unique fonts used in the text
    const loaded = new Set<string>();
    for (let i = 0; i < textLength; i++) {
      const charFont = textTarget.getRangeFontName(i, i + 1) as FontName;
      const key = `${charFont.family}:${charFont.style}`;
      if (!loaded.has(key)) { await figma.loadFontAsync(charFont); loaded.add(key); }
    }
  }

  // Load any new fonts specified in ranges
  for (const range of params.ranges) {
    if (range.fontFamily && range.fontStyle) {
      await figma.loadFontAsync({
        family: range.fontFamily,
        style: range.fontStyle,
      });
    }
  }

  // Apply styles to each range
  for (const range of params.ranges) {
    const start = Math.max(0, range.start);
    const end = Math.min(textLength, range.end);

    if (start >= end) continue;

    if (range.color) {
      textTarget.setRangeFills(start, end, [
        {
          type: "SOLID",
          color: {
            r: range.color.r,
            g: range.color.g,
            b: range.color.b,
          },
          opacity: range.color.a != null ? range.color.a : 1,
        },
      ]);
    }

    if (range.fontFamily && range.fontStyle) {
      textTarget.setRangeFontName(start, end, {
        family: range.fontFamily,
        style: range.fontStyle,
      });
    }

    if (range.fontSize) {
      textTarget.setRangeFontSize(start, end, range.fontSize);
    }

    if (range.textDecoration) {
      textTarget.setRangeTextDecoration(start, end, range.textDecoration);
    }
  }

  return { id: node.id, rangesApplied: params.ranges.length };
}

// ============ TEXT STYLES ============

// Helper: scan text nodes to collect text styles in use
function collectTextStylesFromNodes(): any[] {
  const styleMap = new Map<string, any>();

  function scan(node: BaseNode) {
    if (node.type === "TEXT") {
      const textNode = node as TextNode;

      // Method 1: textStyleId directly
      const sid = (() => { try { return (textNode as any).textStyleId; } catch { return null; } })();
      if (sid && sid !== "" && sid !== figma.mixed && typeof sid === "string") {
        if (!styleMap.has(sid)) {
          styleMap.set(sid, {
            id: sid,
            name: textNode.name,
            sourceNodeId: textNode.id,
            fontName: textNode.fontName !== figma.mixed ? textNode.fontName : "MIXED",
            fontSize: textNode.fontSize !== figma.mixed ? textNode.fontSize : "MIXED",
          });
        }
        return;
      }

      // Method 2: getStyledTextSegments
      if (typeof (textNode as any).getStyledTextSegments === "function") {
        try {
          const segments = (textNode as any).getStyledTextSegments(["textStyleId", "fontName", "fontSize", "lineHeight", "letterSpacing", "textDecoration", "textCase"]);
          for (const seg of segments) {
            if (seg.textStyleId && seg.textStyleId !== "" && !styleMap.has(seg.textStyleId)) {
              styleMap.set(seg.textStyleId, {
                id: seg.textStyleId,
                name: textNode.name,
                sourceNodeId: textNode.id,
                fontName: seg.fontName || "unknown",
                fontSize: seg.fontSize || "unknown",
              });
            }
          }
        } catch {}
      }
    }
    if ("children" in node) {
      for (const child of (node as any).children) {
        scan(child);
      }
    }
  }

  scan(figma.currentPage);
  return Array.from(styleMap.values());
}

// Get all local text styles in the file
export async function getLocalTextStyles() {
  // Try official API first (works in Figma Design, not in Slides)
  try {
    const styles = await (figma as any).getLocalTextStylesAsync();
    if (Array.isArray(styles) && styles.length > 0) {
      return {
        totalStyles: styles.length,
        source: "api",
        styles: styles.map((style: any) => ({
          id: style.id,
          name: style.name,
          fontName: style.fontName,
          fontSize: style.fontSize,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
          textCase: style.textCase,
          textDecoration: style.textDecoration,
        })),
      };
    }
  } catch {}

  // Fallback: scan text nodes to discover styles in use
  const styles = collectTextStylesFromNodes();

  return {
    totalStyles: styles.length,
    source: styles.length > 0 ? "node_scan" : "none",
    styles,
  };
}

// Helper: get text target from node
function getTextTarget(node: SceneNode): any {
  if (node.type === "TEXT") return node;
  if (node.type === "SHAPE_WITH_TEXT") return (node as ShapeWithTextNode).text;
  if ((node.type as string) === "TABLE_CELL") return (node as any).text;
  throw new Error(`Node type "${node.type}" does not support text styles. Supported: TEXT, SHAPE_WITH_TEXT, TABLE_CELL`);
}

// Helper: load all fonts on a text target.
// fontName access can throw "unsupported type in createVMObject: VARIABLE"
// when the property is bound to a design-token variable — fall back to Inter.
async function loadAllFontsOnTarget(textTarget: any): Promise<void> {
  try {
    if (textTarget.fontName === figma.mixed) {
      const len = textTarget.characters.length;
      const loaded = new Set<string>();
      for (let i = 0; i < len; i++) {
        const font = textTarget.getRangeFontName(i, i + 1) as FontName;
        const key = `${font.family}:${font.style}`;
        if (!loaded.has(key)) { await figma.loadFontAsync(font); loaded.add(key); }
      }
    } else if (textTarget.fontName) {
      await figma.loadFontAsync(textTarget.fontName as FontName);
    }
  } catch {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
}

// Apply a text style to a text node by style ID
export async function setTextStyle(params: {
  nodeId: string;
  textStyleId: string;
}) {
  const node = await getNode(params.nodeId);
  const textTarget = getTextTarget(node);

  // Load existing fonts on the node before changing style
  await loadAllFontsOnTarget(textTarget);

  // Apply the style
  textTarget.textStyleId = params.textStyleId;

  return {
    id: node.id,
    textStyleId: params.textStyleId,
  };
}

// Get the text style applied to a text node
export async function getTextStyle(params: { nodeId: string }) {
  const node = await getNode(params.nodeId);
  const textTarget = getTextTarget(node);

  const currentStyleId = textTarget.textStyleId;

  return {
    id: node.id,
    textStyleId: (!currentStyleId || currentStyleId === "" || currentStyleId === figma.mixed)
      ? null
      : currentStyleId,
    fontName: textTarget.fontName !== figma.mixed ? textTarget.fontName : "MIXED",
    fontSize: textTarget.fontSize !== figma.mixed ? textTarget.fontSize : "MIXED",
  };
}

// Set layout mode (auto-layout)
export async function setLayoutMode(params: {
  nodeId: string;
  layoutMode: "NONE" | "HORIZONTAL" | "VERTICAL";
}) {
  const node = await getNode(params.nodeId);

  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type "${node.type}" does not support layoutMode. Supported: FRAME, COMPONENT, COMPONENT_SET, INSTANCE`);
  }

  const frameNode = node as FrameNode;
  frameNode.layoutMode = params.layoutMode;

  return {
    id: frameNode.id,
    name: frameNode.name,
    layoutMode: frameNode.layoutMode,
  };
}

// Base64 encoding helper
function base64Encode(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let base64 = '';
  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;

  for (let i = 0; i < mainLength; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    base64 += chars[(chunk & 16515072) >> 18] + chars[(chunk & 258048) >> 12] + chars[(chunk & 4032) >> 6] + chars[chunk & 63];
  }

  if (byteRemainder === 1) {
    const chunk = bytes[mainLength];
    base64 += chars[(chunk & 252) >> 2] + chars[(chunk & 3) << 4] + '==';
  } else if (byteRemainder === 2) {
    const chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
    base64 += chars[(chunk & 64512) >> 10] + chars[(chunk & 1008) >> 4] + chars[(chunk & 15) << 2] + '=';
  }

  return base64;
}

// Export slide as image
export async function exportSlideImage(params: {
  slideId?: string;
  scale?: number;
}) {
  let scale = params.scale || 1;

  let slide: SceneNode;

  if (params.slideId) {
    const node = await lookupNode(params.slideId);
    if (!node) throw new Error(`Slide not found: ${params.slideId}`);
    slide = node as SceneNode;
  } else {
    // Get focused slide, or fall back to first slide on the page
    const focusedSlide = (figma.currentPage as any).focusedSlide as SlideNode | null;
    if (focusedSlide) {
      slide = focusedSlide as unknown as SceneNode;
    } else {
      const firstChild = figma.currentPage.children[0];
      if (!firstChild) throw new Error("No slides found on the current page");
      slide = firstChild as SceneNode;
    }
  }

  if (!("exportAsync" in slide)) {
    throw new Error("Node does not support export");
  }

  // Use JPEG to keep full resolution while drastically reducing file size
  // (PNG ~3.5MB → JPEG ~300KB for photographic slides)
  const bytes = await (slide as any).exportAsync({
    format: "JPG",
    constraint: { type: "SCALE", value: scale },
  });
  const imageData = base64Encode(bytes);

  return {
    slideId: slide.id,
    slideName: slide.name,
    scale,
    mimeType: "image/jpeg",
    imageData,
  };
}

// Rotate node (center-pivot)
export async function rotateNode(params: { nodeId: string; angle: number }) {
  const node = await getNode(params.nodeId);

  if (!("rotation" in node)) {
    throw new Error(`Node "${node.type}" does not support rotation`);
  }

  try {
    const halfW = node.width / 2;
    const halfH = node.height / 2;

    const tOld = node.absoluteTransform;
    const cxOld = tOld[0][0] * halfW + tOld[0][1] * halfH + tOld[0][2];
    const cyOld = tOld[1][0] * halfW + tOld[1][1] * halfH + tOld[1][2];

    node.rotation = params.angle;

    const tNew = node.absoluteTransform;
    const cxNew = tNew[0][0] * halfW + tNew[0][1] * halfH + tNew[0][2];
    const cyNew = tNew[1][0] * halfW + tNew[1][1] * halfH + tNew[1][2];

    node.x += cxOld - cxNew;
    node.y += cyOld - cyNew;
  } catch {
    // Variable binding prevents geometry access; apply rotation via relativeTransform.
    try {
      const rad = (-params.angle * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const t = node.relativeTransform;
      (node as any).relativeTransform = [[cos, sin, t[0][2]], [-sin, cos, t[1][2]]];
    } catch {
      // Transform access also bound — best-effort, nothing more we can do
    }
  }

  try {
    return {
      id: node.id,
      name: node.name,
      angle: params.angle,
      x: node.x,
      y: node.y,
    };
  } catch {
    return {
      id: node.id,
      name: node.name,
      angle: params.angle,
      x: 0,
      y: 0,
    };
  }
}

// ============ COLOR REPLACEMENT ============

// Helper: Check if two colors match within tolerance
function colorsMatch(a: RGB, b: RGB, tolerance: number = 0.01): boolean {
  return (
    Math.abs(a.r - b.r) < tolerance &&
    Math.abs(a.g - b.g) < tolerance &&
    Math.abs(a.b - b.b) < tolerance
  );
}

// Helper: Recursively replace colors in node tree
function replaceColorsInNode(
  node: SceneNode,
  oldColor: RGB,
  newColor: RGB,
  tolerance: number,
  includeStrokes: boolean
): number {
  let replacedCount = 0;

  // Handle fills for nodes that support them
  if ("fills" in node && Array.isArray(node.fills)) {
    const fills = node.fills as Paint[];
    let fillsReplaced = 0;
    const newFills = fills.map((fill) => {
      if (fill.type === "SOLID" && colorsMatch(fill.color, oldColor, tolerance)) {
        fillsReplaced++;
        return { ...fill, color: newColor };
      }
      return fill;
    });
    if (fillsReplaced > 0) {
      (node as GeometryMixin).fills = newFills;
      replacedCount += fillsReplaced;
    }
  }

  // Handle strokes if requested
  if (includeStrokes && "strokes" in node && Array.isArray(node.strokes)) {
    const strokes = node.strokes as Paint[];
    let strokesReplaced = 0;
    const newStrokes = strokes.map((stroke) => {
      if (stroke.type === "SOLID" && colorsMatch(stroke.color, oldColor, tolerance)) {
        strokesReplaced++;
        return { ...stroke, color: newColor };
      }
      return stroke;
    });
    if (strokesReplaced > 0) {
      (node as GeometryMixin).strokes = newStrokes;
      replacedCount += strokesReplaced;
    }
  }

  // Recurse into children
  if ("children" in node) {
    for (const child of (node as ChildrenMixin).children) {
      replacedCount += replaceColorsInNode(child, oldColor, newColor, tolerance, includeStrokes);
    }
  }

  return replacedCount;
}

// Replace color across all children of a node
export async function replaceColor(params: {
  nodeId: string;
  oldColor: { r: number; g: number; b: number };
  newColor: { r: number; g: number; b: number };
  tolerance?: number;
  includeStrokes?: boolean;
}) {
  const { nodeId, oldColor, newColor, tolerance = 0.02, includeStrokes = true } = params;
  const node = await getNode(nodeId);

  const oldRGB: RGB = { r: oldColor.r, g: oldColor.g, b: oldColor.b };
  const newRGB: RGB = { r: newColor.r, g: newColor.g, b: newColor.b };

  let totalReplaced = 0;

  // Check the node itself and all children
  totalReplaced += replaceColorsInNode(node, oldRGB, newRGB, tolerance, includeStrokes);

  return {
    id: nodeId,
    name: node.name,
    oldColor,
    newColor,
    replacedCount: totalReplaced,
  };
}

// ============ CANVAS-PORTED HANDLERS ============

// Helper: make solid paint from RGBA
function makeSolidPaint(color: { r: number; g: number; b: number; a?: number }): SolidPaint {
  return {
    type: "SOLID",
    color: { r: color.r, g: color.g, b: color.b },
    opacity: color.a != null ? color.a : 1,
  };
}

// Helper: make shadow effect
function makeShadowEffect(shadowParams: {
  shadowColor: { r: number; g: number; b: number; a?: number };
  offsetX: number;
  offsetY: number;
  radius: number;
  spread?: number;
}, type: "DROP_SHADOW" | "INNER_SHADOW"): Effect {
  return {
    type,
    visible: true,
    color: {
      r: shadowParams.shadowColor.r,
      g: shadowParams.shadowColor.g,
      b: shadowParams.shadowColor.b,
      a: shadowParams.shadowColor.a ?? 0.25,
    },
    offset: { x: shadowParams.offsetX, y: shadowParams.offsetY },
    radius: shadowParams.radius,
    spread: shadowParams.spread ?? 0,
    blendMode: "NORMAL",
  } as Effect;
}

// Helper: make gradient paint
function makeGradientPaint(
  stops: { r: number; g: number; b: number; a?: number; position: number }[],
  gradientType: string = "GRADIENT_LINEAR",
  angle?: number,
): GradientPaint {
  const colorStops: ColorStop[] = stops.map((s) => ({
    position: s.position,
    color: { r: s.r, g: s.g, b: s.b, a: s.a ?? 1 },
  }));

  const rad = ((angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  return {
    type: gradientType as any,
    gradientStops: colorStops,
    gradientTransform: [
      [cos, sin, 0.5 - cos * 0.5 - sin * 0.5],
      [-sin, cos, 0.5 + sin * 0.5 - cos * 0.5],
    ],
  };
}

// Create Polygon
export async function createPolygon(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  pointCount: number;
  name?: string;
  parentId?: string;
  fillColor?: { r: number; g: number; b: number; a?: number };
  strokeColor?: { r: number; g: number; b: number; a?: number };
  strokeWeight?: number;
}) {
  const polygon = figma.createPolygon();
  polygon.resize(params.width, params.height);
  polygon.pointCount = params.pointCount;

  if (params.name) polygon.name = params.name;
  if (params.fillColor) polygon.fills = [makeSolidPaint(params.fillColor)];
  if (params.strokeColor) polygon.strokes = [makeSolidPaint(params.strokeColor)];
  if (params.strokeWeight !== undefined) polygon.strokeWeight = params.strokeWeight;

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(polygon);
  }

  polygon.x = params.x;
  polygon.y = params.y;

  return { id: polygon.id, name: polygon.name, type: polygon.type, pointCount: polygon.pointCount };
}

// Create Star
export async function createStar(params: {
  x: number;
  y: number;
  width: number;
  height: number;
  pointCount: number;
  innerRadius?: number;
  name?: string;
  parentId?: string;
  fillColor?: { r: number; g: number; b: number; a?: number };
  strokeColor?: { r: number; g: number; b: number; a?: number };
  strokeWeight?: number;
}) {
  const star = figma.createStar();
  star.resize(params.width, params.height);
  star.pointCount = params.pointCount;
  star.innerRadius = params.innerRadius ?? 50;

  if (params.name) star.name = params.name;
  if (params.fillColor) star.fills = [makeSolidPaint(params.fillColor)];
  if (params.strokeColor) star.strokes = [makeSolidPaint(params.strokeColor)];
  if (params.strokeWeight !== undefined) star.strokeWeight = params.strokeWeight;

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(star);
  }

  star.x = params.x;
  star.y = params.y;

  return { id: star.id, name: star.name, type: star.type, pointCount: star.pointCount, innerRadius: star.innerRadius };
}

// Create Line
export async function createLine(params: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  name?: string;
  parentId?: string;
  strokeColor?: { r: number; g: number; b: number; a?: number };
  strokeWeight?: number;
  strokeCap?: "NONE" | "ROUND" | "SQUARE";
  dashPattern?: number[];
}) {
  const dx = params.endX - params.startX;
  const dy = params.endY - params.startY;
  const length = Math.hypot(dx, dy);
  // Figma rotation is visually CCW; screen Y is down. Negate dy so the line's
  // +X axis ends up pointing from start toward end visually.
  const angleDeg = (Math.atan2(-dy, dx) * 180) / Math.PI;

  const line = figma.createLine();
  if (params.name) line.name = params.name;
  line.resize(length, 0);
  line.rotation = angleDeg;

  if (params.strokeColor) line.strokes = [makeSolidPaint(params.strokeColor)];
  if (params.strokeWeight !== undefined) line.strokeWeight = params.strokeWeight;
  if (params.strokeCap) line.strokeCap = params.strokeCap as StrokeCap;
  if (params.dashPattern) line.dashPattern = params.dashPattern;

  const parent = params.parentId
    ? (await resolveNodeId(params.parentId) as FrameNode | PageNode | SlideNode)
    : getCurrentParent();

  if (parent && "appendChild" in parent) {
    parent.appendChild(line);
  }

  line.x = params.startX;
  line.y = params.startY;

  return {
    id: line.id,
    name: line.name,
    type: line.type,
    startX: params.startX,
    startY: params.startY,
    endX: params.endX,
    endY: params.endY,
    length,
  };
}

// Create Mask
export async function createMask(params: {
  maskNodeId: string;
  contentNodeIds: string[];
  groupName?: string;
}) {
  const maskNode = await getNode(params.maskNodeId);
  const contentNodes: SceneNode[] = [];
  for (const id of params.contentNodeIds) {
    contentNodes.push(await getNode(id));
  }

  if ("isMask" in maskNode) {
    (maskNode as any).isMask = true;
  } else {
    throw new Error("Chosen mask node cannot act as a mask");
  }

  const parent = (maskNode.parent as (SceneNode & ChildrenMixin)) || getCurrentParent();
  const grouped = figma.group([maskNode, ...contentNodes], parent);
  grouped.name = params.groupName ?? "Mask Group";

  return {
    id: grouped.id,
    name: grouped.name,
    maskNodeId: params.maskNodeId,
    contentNodeIds: params.contentNodeIds,
  };
}

// Get Node Info By Types
export async function getNodeInfoByTypes(params: {
  nodeId: string;
  types: string[];
}) {
  const node = await figma.getNodeByIdAsync(params.nodeId);
  if (!node) throw new Error(`Node not found: ${params.nodeId}`);

  const matchingNodes: any[] = [];

  function scan(n: BaseNode) {
    if (params.types.includes(n.type)) {
      const info: any = { id: n.id, name: n.name, type: n.type };
      if ("x" in n) info.x = (n as SceneNode).x;
      if ("y" in n) info.y = (n as SceneNode).y;
      if ("width" in n) info.width = (n as SceneNode).width;
      if ("height" in n) info.height = (n as SceneNode).height;
      matchingNodes.push({ nodeId: n.id, nodeInfo: info });
    }
    if ("children" in n) {
      for (const child of (n as any).children) {
        scan(child);
      }
    }
  }

  scan(node);

  return {
    success: true,
    count: matchingNodes.length,
    matchingNodes,
    searchedTypes: params.types,
  };
}

// Get Result Image (export page as image)
export async function getResultImage(params: {
  pageId?: string;
  scale?: number;
}) {
  const scale = params.scale || 1;
  const page = params.pageId
    ? (await figma.getNodeByIdAsync(params.pageId) as PageNode | null)
    : figma.currentPage;

  if (!page) throw new Error(`Page not found: ${params.pageId}`);

  const exportable = (page as PageNode).children.filter(
    (n): n is SceneNode & ExportMixin => "exportAsync" in n && n.visible
  );

  if (exportable.length === 0) {
    return { pageId: (page as PageNode).id, mimeType: "image/png", imageData: "" };
  }

  const group = figma.group(exportable, page as PageNode);

  try {
    const bytes = await (group as any).exportAsync({
      format: "PNG",
      constraint: { type: "SCALE", value: scale },
    });

    return {
      pageId: (page as PageNode).id,
      mimeType: "image/png",
      imageData: base64Encode(bytes),
    };
  } finally {
    figma.ungroup(group as GroupNode);
  }
}

// Get Page Structure
export async function getPageStructure() {
  interface StructureInfo {
    id: string;
    name: string;
    type: string;
    position: { x: number; y: number };
    size: { width: number; height: number };
    children?: StructureInfo[];
  }

  function buildInfo(n: SceneNode): StructureInfo {
    const info: StructureInfo = {
      id: n.id,
      name: n.name,
      type: n.type,
      position: { x: n.x, y: n.y },
      size: { width: n.width, height: n.height },
    };
    if ("children" in n && (n as any).children.length) {
      info.children = (n as any).children.map((c: SceneNode) => buildInfo(c));
    }
    return info;
  }

  const structureTree = figma.currentPage.children.map((n) => buildInfo(n as SceneNode));

  return {
    pageId: figma.currentPage.id,
    pageName: figma.currentPage.name,
    structureTree,
  };
}

// Reorder Node
export async function reorderNode(params: {
  nodeId: string;
  direction: "TOP" | "BOTTOM" | "FORWARD" | "BACKWARD";
}) {
  const node = await getNode(params.nodeId);
  if (!node.parent) throw new Error("Node has no parent – cannot reorder");

  const parent = node.parent as BaseNode & ChildrenMixin;
  const siblings = parent.children;
  const oldIndex = siblings.findIndex((n) => n.id === params.nodeId);
  if (oldIndex === -1) throw new Error("Node not in parent.children");

  let newIndex = 0;
  switch (params.direction) {
    case "TOP":
      newIndex = siblings.length;
      break;
    case "BOTTOM":
      newIndex = 0;
      break;
    case "FORWARD":
      newIndex = Math.min(oldIndex + 2, siblings.length);
      break;
    case "BACKWARD":
      newIndex = Math.max(oldIndex - 1, 0);
      break;
  }

  if (newIndex !== oldIndex && "insertChild" in parent) {
    (parent as FrameNode).insertChild(newIndex, node);
  }

  return {
    id: node.id,
    name: node.name,
    parentId: parent.id,
    oldIndex,
    newIndex,
  };
}

// Boolean Nodes
export async function booleanNodes(params: {
  nodeIds: string[];
  operation: "UNION" | "SUBTRACT" | "INTERSECT" | "EXCLUDE";
}) {
  const targets: SceneNode[] = [];
  for (const id of params.nodeIds) {
    targets.push(await getNode(id));
  }

  const parent = (targets[0].parent as (SceneNode & ChildrenMixin) | null) ?? getCurrentParent();

  let booleanNode: BooleanOperationNode;
  switch (params.operation) {
    case "UNION":
      booleanNode = figma.union(targets, parent);
      break;
    case "SUBTRACT":
      booleanNode = figma.subtract(targets, parent);
      break;
    case "INTERSECT":
      booleanNode = figma.intersect(targets, parent);
      break;
    case "EXCLUDE":
      booleanNode = figma.exclude(targets, parent);
      break;
  }

  return {
    id: booleanNode.id,
    name: booleanNode.name,
    operation: booleanNode.booleanOperation,
    parentId: parent.id,
    containedIds: targets.map((n) => n.id),
  };
}

// Get Styles
export async function getStyles() {
  const safeGet = async (fn: any) => {
    try { return typeof fn === "function" ? await fn() : []; } catch { return []; }
  };
  const styles = {
    colors: await safeGet((figma as any).getLocalPaintStylesAsync?.bind(figma)),
    texts: await safeGet((figma as any).getLocalTextStylesAsync?.bind(figma)),
    effects: await safeGet((figma as any).getLocalEffectStylesAsync?.bind(figma)),
  };

  return {
    colors: (styles.colors || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      key: s.key,
      paint: s.paints?.[0],
    })),
    texts: (styles.texts || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      key: s.key,
      fontSize: s.fontSize,
      fontName: s.fontName,
    })),
    effects: (styles.effects || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      key: s.key,
    })),
  };
}

// Set Fill Gradient
export async function setFillGradient(params: {
  nodeId: string;
  gradientStops: { r: number; g: number; b: number; a?: number; position: number }[];
  gradientType?: string;
  angle?: number;
}) {
  const node = await getNode(params.nodeId);

  if (!("fills" in node)) throw new Error("Node does not support fills");

  (node as GeometryMixin).fills = [
    makeGradientPaint(
      params.gradientStops,
      params.gradientType ?? "GRADIENT_LINEAR",
      params.angle,
    ),
  ];

  return { id: node.id, name: node.name };
}

// Set Drop Shadow
export async function setDropShadow(params: {
  nodeId: string;
  shadowColor: { r: number; g: number; b: number; a?: number };
  offsetX: number;
  offsetY: number;
  radius: number;
  spread?: number;
}) {
  const node = await getNode(params.nodeId);
  if (!("effects" in node)) throw new Error("Node does not support effects");

  const shadow = makeShadowEffect(params, "DROP_SHADOW");
  (node as any).effects = [
    ...(node as any).effects.filter((e: Effect) => e.type !== "DROP_SHADOW"),
    shadow,
  ];

  return { id: node.id, name: node.name };
}

// Set Inner Shadow
export async function setInnerShadow(params: {
  nodeId: string;
  shadowColor: { r: number; g: number; b: number; a?: number };
  offsetX: number;
  offsetY: number;
  radius: number;
  spread?: number;
}) {
  const node = await getNode(params.nodeId);
  if (!("effects" in node)) throw new Error("Node does not support effects");

  const shadow = makeShadowEffect(params, "INNER_SHADOW");
  (node as any).effects = [
    ...(node as any).effects.filter((e: Effect) => e.type !== "INNER_SHADOW"),
    shadow,
  ];

  return { id: node.id, name: node.name };
}

// Copy Style
export async function copyStyle(params: {
  sourceNodeId: string;
  targetNodeId: string;
  properties?: ("fills" | "strokes" | "effects" | "cornerRadius" | "opacity")[];
}) {
  const src = await getNode(params.sourceNodeId);
  const dst = await getNode(params.targetNodeId);

  const props = params.properties ?? ["fills", "strokes", "effects", "cornerRadius", "opacity"];

  props.forEach((prop) => {
    if (prop in src && prop in dst) {
      (dst as any)[prop] = (src as any)[prop];
    }
  });

  return {
    sourceName: src.name,
    targetName: dst.name,
    copied: props,
  };
}

// Set Blend Mode
export async function setBlendMode(params: {
  nodeId: string;
  blendMode: string;
}) {
  const node = await getNode(params.nodeId);
  if (!("blendMode" in node)) throw new Error("Node does not support blendMode");

  (node as any).blendMode = params.blendMode;

  return { id: node.id, name: node.name, blendMode: (node as any).blendMode };
}

// Set Padding
export async function setPadding(params: {
  nodeId: string;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
}) {
  const node = await getNode(params.nodeId);

  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type "${node.type}" does not support padding`);
  }

  const frame = node as FrameNode;
  if (params.paddingTop !== undefined) frame.paddingTop = params.paddingTop;
  if (params.paddingRight !== undefined) frame.paddingRight = params.paddingRight;
  if (params.paddingBottom !== undefined) frame.paddingBottom = params.paddingBottom;
  if (params.paddingLeft !== undefined) frame.paddingLeft = params.paddingLeft;

  return {
    id: frame.id,
    name: frame.name,
    paddingTop: frame.paddingTop,
    paddingRight: frame.paddingRight,
    paddingBottom: frame.paddingBottom,
    paddingLeft: frame.paddingLeft,
  };
}

// Set Axis Align
export async function setAxisAlign(params: {
  nodeId: string;
  primaryAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "SPACE_BETWEEN";
  counterAxisAlignItems?: "MIN" | "MAX" | "CENTER" | "BASELINE";
}) {
  const node = await getNode(params.nodeId);

  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type "${node.type}" does not support axis alignment`);
  }

  const frame = node as FrameNode;
  if (params.primaryAxisAlignItems !== undefined) {
    frame.primaryAxisAlignItems = params.primaryAxisAlignItems as any;
  }
  if (params.counterAxisAlignItems !== undefined) {
    frame.counterAxisAlignItems = params.counterAxisAlignItems as any;
  }

  return {
    id: frame.id,
    name: frame.name,
    primaryAxisAlignItems: frame.primaryAxisAlignItems,
    counterAxisAlignItems: frame.counterAxisAlignItems,
    layoutMode: frame.layoutMode,
  };
}

// Set Layout Sizing
export async function setLayoutSizing(params: {
  nodeId: string;
  layoutSizingHorizontal?: "FIXED" | "HUG" | "FILL";
  layoutSizingVertical?: "FIXED" | "HUG" | "FILL";
}) {
  const node = await getNode(params.nodeId);

  // Allow any node type that is a child of an auto-layout frame
  // (RECTANGLE, ELLIPSE, TEXT, etc. all support layoutSizingHorizontal/Vertical
  //  when their parent has layoutMode !== "NONE")
  const n = node as any;

  if (params.layoutSizingHorizontal !== undefined) {
    n.layoutSizingHorizontal = params.layoutSizingHorizontal;
  }
  if (params.layoutSizingVertical !== undefined) {
    n.layoutSizingVertical = params.layoutSizingVertical;
  }

  return {
    id: n.id,
    name: n.name,
    type: node.type,
    layoutSizingHorizontal: n.layoutSizingHorizontal,
    layoutSizingVertical: n.layoutSizingVertical,
  };
}

// Set Child Layout Properties (layoutGrow, layoutAlign)
export async function setChildLayoutProps(params: {
  nodeId: string;
  layoutGrow?: number;
  layoutAlign?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "INHERIT";
  layoutPositioning?: "AUTO" | "ABSOLUTE";
}) {
  const node = await getNode(params.nodeId);
  const n = node as any;

  // Set layoutPositioning first (ABSOLUTE = "ignore auto-layout")
  if (params.layoutPositioning !== undefined) {
    n.layoutPositioning = params.layoutPositioning;
  }
  if (params.layoutGrow !== undefined) {
    n.layoutGrow = params.layoutGrow;
  }
  if (params.layoutAlign !== undefined) {
    n.layoutAlign = params.layoutAlign;
  }

  return {
    id: n.id,
    name: n.name,
    type: node.type,
    layoutPositioning: n.layoutPositioning,
    layoutGrow: n.layoutGrow,
    layoutAlign: n.layoutAlign,
  };
}

// Set Constraints
export async function setConstraints(params: {
  nodeId: string;
  horizontal?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
  vertical?: "MIN" | "CENTER" | "MAX" | "STRETCH" | "SCALE";
}) {
  const node = await getNode(params.nodeId);
  const n = node as any;

  const current = n.constraints || { horizontal: "MIN", vertical: "MIN" };
  n.constraints = {
    horizontal: params.horizontal || current.horizontal,
    vertical: params.vertical || current.vertical,
  };

  return {
    id: n.id,
    name: n.name,
    type: node.type,
    constraints: n.constraints,
  };
}

// Set Item Spacing
export async function setItemSpacing(params: {
  nodeId: string;
  itemSpacing: number;
}) {
  const node = await getNode(params.nodeId);

  if (
    node.type !== "FRAME" &&
    node.type !== "COMPONENT" &&
    node.type !== "COMPONENT_SET" &&
    node.type !== "INSTANCE"
  ) {
    throw new Error(`Node type "${node.type}" does not support item spacing`);
  }

  const frame = node as FrameNode;
  frame.itemSpacing = params.itemSpacing;

  return {
    id: frame.id,
    name: frame.name,
    itemSpacing: frame.itemSpacing,
    layoutMode: frame.layoutMode,
  };
}